"""Portfolio endpoints (staff phase 2A). A "business" is a BusinessOwner and
its profile. Writes record their own activity events (record() last), so the
activity middleware adds nothing on top."""
import math
from collections import Counter
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError as ApiValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import claims, sessions
from accounts.models import BusinessOwner, Role, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission, IsStaff
from accounts.phones import filter_by_phone, phone_key
from accounts.serializers import staff_brief
from activity.models import ActivityEvent
from activity.services import record
from approvals.services import ApprovalError
from listings.models import Listing
from notifications.services import notify_staff
from staff_tasks.services import create_task

from . import checks, health
from .models import BusinessHealthSnapshot
from .registration import RegistrationError, register_business, resubmit_kyc
from .serializers import (
    FollowUpSerializer,
    ReassignSerializer,
    StagePhotoSerializer,
    business_detail,
    business_review_sheet,
    flag_brief,
    portfolio_item,
    subscription_due_item,
)
from .services import approver_name, assign_account_manager
from .proposals import listing_form_meta, propose_listing, propose_photos, propose_update, stage_photo


def get_managed_business(request, pk, *, allow_portfolio_manage=True):
    """The business at `pk` when the caller is its account manager — or, if
    allowed, holds portfolio.manage. Anything else is a 404, so a scout can't
    learn which other businesses exist."""
    owner = get_object_or_404(BusinessOwner.objects.select_related("profile", "account_manager"), pk=pk)
    user = request.user
    if not isinstance(user, StaffUser):
        raise Http404
    if owner.account_manager_id == user.pk:
        return owner
    if allow_portfolio_manage and "portfolio.manage" in user.effective_permission_codenames():
        return owner
    raise Http404


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _number(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _refused(exc):
    body = {"detail": exc.message, "code": exc.code}
    if exc.code == "duplicate":
        body["matched"] = exc.matched
    return Response(body, status=exc.status_code)


class RegisterCheckView(APIView):
    """POST register/check/ — the Review step's checks. Reads only."""

    activity_exempt = True

    def get_permissions(self):
        return [HasRolePermission("businesses.register")]

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        return Response(checks.registration_checks(
            owner_phone=_text(body.get("owner_phone")),
            business_name=_text(body.get("business_name")),
            gps_address=_text(body.get("gps_address")),
            lat=_number(body.get("lat")),
            lng=_number(body.get("lng")),
            ghana_card_number=_text(body.get("ghana_card_number")),
        ))


class RegisterBusinessView(APIView):
    """POST register/ (multipart) — a scout registers a business for KYC."""

    def get_permissions(self):
        return [HasRolePermission("businesses.register")]

    def post(self, request):
        try:
            result = register_business(request.user, request.data, request.FILES, http_request=request)
        except RegistrationError as exc:
            return _refused(exc)
        owner, approval = result["business_owner"], result["approval"]
        return Response({
            "id": owner.pk,
            "business_name": owner.profile.business_name,
            "approval_id": approval.pk if approval else None,
            "approver_name": approver_name(approval),
            "flags": [flag_brief(flag) for flag in result["flags"]],
            "needs_claim": owner.needs_claim,
        }, status=status.HTTP_201_CREATED)


class KycResubmitView(APIView):
    """POST businesses/<pk>/kyc/ (account manager only) — a fresh
    business.kyc request after the last one was returned."""

    def get_permissions(self):
        return [HasAnyRolePermission("businesses.manage_portfolio", "businesses.register")]

    def post(self, request, pk):
        owner = get_managed_business(request, pk, allow_portfolio_manage=False)
        try:
            approval = resubmit_kyc(owner, request.user, request.data, request.FILES, http_request=request)
        except RegistrationError as exc:
            return _refused(exc)
        return Response(
            {"approval_id": approval.pk if approval else None, "approver_name": approver_name(approval)},
            status=status.HTTP_201_CREATED,
        )


OWNER_TARGET_TYPE = "accounts.businessowner"


def _claim_refused(exc):
    return Response({"detail": exc.message, "code": exc.code}, status=exc.status_code)


class HandoverView(APIView):
    """POST businesses/<pk>/handover/ — a 30-minute hand-over token bound to
    this staff session, for the owner to set a password on this phone. The
    token goes only into the response; the activity log gets its expiry."""

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        owner = get_managed_business(request, pk)
        try:
            with transaction.atomic():
                raw, token = claims.start_handover(owner, request.user, sessions.current(request))
                record(
                    request.user, "business.handover_started", target_type=OWNER_TARGET_TYPE,
                    target_id=str(owner.pk), target_label=owner.display_name,
                    after={"expires_at": token.expires_at.isoformat()}, request=request,
                )
        except claims.ClaimError as exc:
            return _claim_refused(exc)
        return Response({"token": raw, "expires_at": token.expires_at}, status=status.HTTP_201_CREATED)


class ClaimLinkView(APIView):
    """POST businesses/<pk>/claim-link/ — email the owner a 7-day claim link
    (a new link replaces the old). SMS isn't connected, so it needs the
    owner's email on file."""

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        owner = get_managed_business(request, pk)
        try:
            with transaction.atomic():
                token = claims.send_claim_link(owner, request.user)
                sent_to = claims.mask_email(token.sent_to)
                record(
                    request.user, "business.claim_link_sent", target_type=OWNER_TARGET_TYPE,
                    target_id=str(owner.pk), target_label=owner.display_name,
                    after={"sent_to": sent_to, "expires_at": token.expires_at.isoformat()}, request=request,
                )
        except claims.ClaimError as exc:
            return _claim_refused(exc)
        return Response({"sent_to": sent_to, "expires_at": token.expires_at})


# ── Portfolio and health (plan 2A Task 8) ──────────────────────────────────

PORTFOLIO_SCOUT = "businesses.manage_portfolio"
PORTFOLIO_MANAGE = "portfolio.manage"
PORTFOLIO_SCOPES = ("mine", "team", "all")
SUBSCRIPTION_STATES = ("none", "trial", "active", "overdue", "paused")
TEAM_ONLY = "You can reassign only between scouts on your team."
CLEARED_WINDOW = timedelta(days=7)
OWNER_TARGET = BusinessOwner._meta.label_lower


class PortfolioPagination(PageNumberPagination):
    page_size = 25


def portfolio_queryset(user, requested_scope=None):
    """The businesses a portfolio screen may show `user`, before filters.
    Scouts always get their own. A portfolio.manage holder picks `mine`,
    `team` (the default: businesses managed by their direct reports or by
    them, plus businesses with no account manager) or `all`. Rejected
    businesses are left out, as in the nightly snapshot."""
    owners = BusinessOwner.objects.exclude(kyc_status=BusinessOwner.REJECTED)
    if PORTFOLIO_MANAGE not in user.effective_permission_codenames():
        return owners.filter(account_manager=user)
    scope = requested_scope if requested_scope in PORTFOLIO_SCOPES else "team"
    if scope == "mine":
        return owners.filter(account_manager=user)
    if scope == "team":
        return owners.filter(
            Q(account_manager__manager=user) | Q(account_manager=user) | Q(account_manager__isnull=True)
        )
    return owners


def _portfolio_search(text):
    """Business name, owner name, area or phone — a phone matches however it
    was written (0… or +233…)."""
    query = (
        Q(profile__business_name__icontains=text)
        | Q(full_name__icontains=text)
        | Q(profile__zone__name__icontains=text)
        | Q(login_phone__icontains=text)
    )
    if phone_key(text):
        query |= Q(pk__in=filter_by_phone(BusinessOwner.objects.all(), "login_phone", text).values("pk"))
    return query


def _portfolio_id_param(params, name):
    raw = params.get(name)
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise ApiValidationError({name: "Use a number."})


def _portfolio_choice_param(params, name, choices):
    value = params.get(name) or ""
    if value and value not in choices:
        raise ApiValidationError({name: f"Use one of: {', '.join(choices)}."})
    return value


def _portfolio_summary(rows, now):
    counts = Counter(row.rating for row in rows)
    owner_ids = [row.owner.pk for row in rows]
    week_ago = timezone.localdate(now) - timedelta(days=7)
    return {
        "total": len(rows),
        "healthy": counts[health.HEALTHY],
        "needs_attention": counts[health.NEEDS_ATTENTION],
        "at_risk": counts[health.AT_RISK],
        "new": counts[health.NEW],
        "unassigned": sum(1 for row in rows if row.owner.account_manager_id is None),
        "at_risk_week_ago": BusinessHealthSnapshot.objects.filter(
            date=week_ago, rating=health.AT_RISK, business_owner_id__in=owner_ids,
        ).count() if owner_ids else 0,
    }


def _portfolio_sort_key(row):
    return (health.SORT_RANK[row.rating], row.owner.display_name.casefold(), row.owner.pk)


class PortfolioListView(APIView):
    """GET /api/portfolio/businesses/?scope=mine|team|all&health=&subscription=
    &scout=&zone=&unassigned=1&q=&page= — a DRF page of 25 plus `summary`."""

    def get_permissions(self):
        return [HasAnyRolePermission(PORTFOLIO_SCOUT, PORTFOLIO_MANAGE)]

    def get(self, request):
        now = timezone.now()
        params = request.query_params
        health_filter = _portfolio_choice_param(params, "health", health.RATINGS)
        subscription_filter = _portfolio_choice_param(params, "subscription", SUBSCRIPTION_STATES)
        owners = portfolio_queryset(request.user, params.get("scope"))
        scout = _portfolio_id_param(params, "scout")
        if scout is not None:
            owners = owners.filter(account_manager_id=scout)
        zone = _portfolio_id_param(params, "zone")
        if zone is not None:
            owners = owners.filter(profile__zone_id=zone)
        if params.get("unassigned") in ("1", "true"):
            owners = owners.filter(account_manager__isnull=True)
        text = (params.get("q") or "").strip()
        if text:
            owners = owners.filter(_portfolio_search(text))
        # Health is worked out per row, so filtering and sorting by it happen in
        # Python over the whole filtered set before a page is cut: one query
        # whatever the size, fine for thousands of businesses.
        rows = health.rate_all(owners, now)
        if subscription_filter:
            rows = [row for row in rows if row.subscription["state"] == subscription_filter]
        # Counted before the health filter, so every health chip keeps its count.
        summary = _portfolio_summary(rows, now)
        if health_filter:
            rows = [row for row in rows if row.rating == health_filter]
        rows.sort(key=_portfolio_sort_key)
        paginator = PortfolioPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        response = paginator.get_paginated_response([portfolio_item(row) for row in page])
        response.data["summary"] = summary
        return response


class PortfolioBusinessDetailView(APIView):
    """GET /api/portfolio/businesses/<pk>/ — the account manager, or any
    portfolio.manage holder; another scout gets 404."""

    def get_permissions(self):
        return [HasAnyRolePermission(PORTFOLIO_SCOUT, PORTFOLIO_MANAGE)]

    def get(self, request, pk):
        now = timezone.now()
        owner = get_managed_business(request, pk)
        row = health.rate_all(
            BusinessOwner.objects.filter(pk=owner.pk).select_related("profile__business_category", "registered_by"),
            now,
        )[0]
        return Response(business_detail(row, request))


class BusinessReviewView(APIView):
    """GET /api/portfolio/businesses/<pk>/review/ — the KYC review sheet."""

    def get_permissions(self):
        return [HasAnyRolePermission("kyc.approve", PORTFOLIO_MANAGE)]

    def get(self, request, pk):
        owner = generics.get_object_or_404(
            BusinessOwner.objects.select_related(
                "profile__zone", "profile__business_category", "profile__address_verified_by", "registered_by",
            ),
            pk=pk,
        )
        return Response(business_review_sheet(owner, request))


class ReassignBusinessView(APIView):
    """POST /api/portfolio/businesses/<pk>/reassign/ {scout, reason}. Outside
    Super Admin, only to a scout on the caller's team and only from a scout on
    it (or from nobody)."""

    def get_permissions(self):
        return [HasRolePermission(PORTFOLIO_MANAGE)]

    def post(self, request, pk):
        serializer = ReassignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"]
        user = request.user
        # The same set ScoutListView offers: active, unsuspended scouts.
        scout = StaffUser.objects.filter(
            pk=serializer.validated_data["scout"], role__name=Role.SCOUT, is_active=True, is_suspended=False,
        ).first()
        if scout is None:
            raise ApiValidationError({"scout": ["Choose an active scout."]})
        with transaction.atomic():
            owner = generics.get_object_or_404(BusinessOwner.objects.select_for_update(), pk=pk)
            previous = owner.account_manager
            if user.role.name != Role.SUPER_ADMIN and (
                scout.manager_id != user.pk or (previous is not None and previous.manager_id != user.pk)
            ):
                return Response({"detail": TEAM_ONLY}, status=403)
            if previous is not None and previous.pk == scout.pk:
                raise ApiValidationError({"scout": [f"{scout.full_name} already manages this business."]})
            assign_account_manager(owner, scout, by=user, reason=reason)
            name = owner.display_name
            notify_staff(
                scout, "portfolio_assigned", f"You now manage {name}", body=reason,
                link=f"portfolio/{owner.pk}", icon="🏪",
            )
            if previous is not None:
                notify_staff(
                    previous, "portfolio_unassigned", f"{name} has a new account manager",
                    body=f"Moved to {scout.full_name}: {reason}", link="portfolio", icon="🏪",
                )
            record(
                user, "business.reassigned", target=owner, summary=f"{name} → {scout.full_name}",
                before={"account_manager": staff_brief(previous)},
                after={"account_manager": staff_brief(scout), "reason": reason},
                request=request,
            )
        row = health.rate_all(BusinessOwner.objects.filter(pk=owner.pk), timezone.now())[0]
        return Response(portfolio_item(row))


class BusinessFollowUpView(APIView):
    """POST /api/portfolio/businesses/<pk>/follow-up/ {owner, title, due_at, notes}
    — a task for the caller or one of their direct reports."""

    def get_permissions(self):
        return [HasRolePermission(PORTFOLIO_MANAGE)]

    def post(self, request, pk):
        business = generics.get_object_or_404(BusinessOwner.objects.select_related("profile"), pk=pk)
        serializer = FollowUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = request.user
        assignee = StaffUser.objects.filter(
            Q(pk=user.pk) | Q(manager=user), pk=data["owner"], is_active=True, is_suspended=False,
        ).first()
        if assignee is None:
            raise ApiValidationError({"owner": ["Choose yourself or someone on your team."]})
        name = business.display_name
        with transaction.atomic():
            task = create_task(
                assignee, data["title"], data["due_at"], notes=data["notes"], source=business, created_by=user,
            )
            if assignee.pk != user.pk:
                notify_staff(
                    assignee, "follow_up_assigned", f"Follow-up: {task.title}",
                    body=f"{name} · from {user.full_name}", link="tasks", icon="📌",
                )
            record(
                user, "business.follow_up_created", target=business,
                summary=f"Follow-up for {assignee.full_name}: {task.title}",
                after={
                    "task_id": task.pk,
                    "owner": {"id": assignee.pk, "full_name": assignee.full_name},
                    "title": task.title,
                    "due_at": task.due_at.isoformat(),
                },
                request=request,
            )
        return Response(
            {
                "id": task.pk,
                "title": task.title,
                "notes": task.notes,
                "due_at": task.due_at,
                "owner": {"id": assignee.pk, "full_name": assignee.full_name},
            },
            status=201,
        )


def _cleared_this_week(owners, now):
    """subscription.resumed events of the last 7 days for businesses in
    `owners`, newest first. billing.clock.clear_after_payment records them
    against the BusinessOwner, with after["paid_on_day"]."""
    events = list(
        ActivityEvent.objects.filter(
            verb="subscription.resumed", target_type=OWNER_TARGET, occurred_at__gte=now - CLEARED_WINDOW,
        ).order_by("-occurred_at", "-id")
    )
    wanted = {int(event.target_id) for event in events if event.target_id.isdigit()}
    in_scope = {owner.pk: owner for owner in owners.filter(pk__in=wanted).select_related("profile")}
    cleared = []
    for event in events:
        owner = in_scope.get(int(event.target_id)) if event.target_id.isdigit() else None
        if owner is None:
            continue
        after = event.after if isinstance(event.after, dict) else {}
        cleared.append({
            "id": owner.pk,
            "business_name": owner.display_name,
            "paid_on_day": after.get("paid_on_day"),
            "at": event.occurred_at,
        })
    return cleared


class SubscriptionsDueView(APIView):
    """GET /api/portfolio/subscriptions-due/?scope=team|all — overdue (most
    urgent first), paused, and cleared this week."""

    def get_permissions(self):
        return [HasRolePermission(PORTFOLIO_MANAGE)]

    def get(self, request):
        now = timezone.now()
        scope = request.query_params.get("scope")
        owners = portfolio_queryset(request.user, scope if scope in ("team", "all") else "team")
        lapsed = owners.filter(
            Q(subscription__current_period_end__lt=now)
            | Q(subscription__overdue_since__isnull=False)
            | Q(subscription__paused_at__isnull=False)
        )
        overdue, paused = [], []
        for row in health.rate_all(lapsed, now):
            if row.subscription["state"] == "overdue":
                overdue.append(row)
            elif row.subscription["state"] == "paused":
                paused.append(row)
        # The longest overdue is the closest to its pause.
        overdue.sort(key=lambda row: (
            row.owner.subscription.overdue_since or row.owner.subscription.current_period_end, row.owner.pk,
        ))
        paused.sort(key=lambda row: (row.owner.subscription.paused_at, row.owner.pk))
        return Response({
            "overdue": [subscription_due_item(row) for row in overdue],
            "paused": [subscription_due_item(row) for row in paused],
            "cleared": _cleared_this_week(owners, now),
        })


def _proposal_body(request):
    return request.data if isinstance(request.data, dict) else None


def _proposal_sent(approval):
    # `status` is "pending" normally and "approved" when a Super Admin's own
    # proposal applied at once, so the form can say "Applied" instead of "Sent to …".
    return Response(
        {"approval_id": approval.pk, "approver_name": approver_name(approval), "status": approval.status},
        status=201,
    )


class PhotoStageView(APIView):
    """POST businesses/<pk>/photos/ — the account manager uploads one photo
    for a later proposal; it reaches the listing only when that is approved."""

    def get_permissions(self):
        return [HasRolePermission("businesses.manage_portfolio")]

    def post(self, request, pk):
        owner = get_managed_business(request, pk, allow_portfolio_manage=False)
        serializer = StagePhotoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            staged = stage_photo(
                owner, request.user, data["image"],
                lat=data.get("lat"), lng=data.get("lng"), accuracy_m=data.get("accuracy_m"),
            )
            record(request.user, "portfolio.photo_staged", target=owner,
                   after={"photo_id": staged.pk, "located": staged.taken_lat is not None}, request=request)
        return Response(
            {"id": staged.pk, "url": request.build_absolute_uri(staged.image.url), "created_at": staged.created_at},
            status=201,
        )


class ProposeChangeView(APIView):
    """POST businesses/<pk>/changes/ {fields, reason} — a business.update request."""

    def get_permissions(self):
        return [HasRolePermission("businesses.manage_portfolio")]

    def post(self, request, pk):
        owner = get_managed_business(request, pk, allow_portfolio_manage=False)
        body = _proposal_body(request)
        if body is None:
            return Response({"detail": "Send a JSON object."}, status=400)
        try:
            approval = propose_update(
                request.user, owner, body.get("fields"), reason=body.get("reason"), http_request=request,
            )
        except ApprovalError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return _proposal_sent(approval)


class ProposeListingView(APIView):
    """POST businesses/<pk>/listings/ {listing, main_photo_id, photo_ids, reason} — a listing.create request."""

    def get_permissions(self):
        return [HasRolePermission("businesses.manage_portfolio")]

    def post(self, request, pk):
        owner = get_managed_business(request, pk, allow_portfolio_manage=False)
        body = _proposal_body(request)
        if body is None:
            return Response({"detail": "Send a JSON object."}, status=400)
        try:
            approval = propose_listing(
                request.user, owner, body.get("listing"), main_photo_id=body.get("main_photo_id"),
                photo_ids=body.get("photo_ids"), reason=body.get("reason"), http_request=request,
            )
        except ApprovalError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return _proposal_sent(approval)


class ProposeListingPhotosView(APIView):
    """POST listings/<pk>/photos/ {photo_ids, reason} — a listing.photos request."""

    def get_permissions(self):
        return [HasRolePermission("businesses.manage_portfolio")]

    def post(self, request, pk):
        listing = generics.get_object_or_404(Listing, pk=pk)
        get_managed_business(request, listing.business_owner_id, allow_portfolio_manage=False)
        body = _proposal_body(request)
        if body is None:
            return Response({"detail": "Send a JSON object."}, status=400)
        try:
            approval = propose_photos(
                request.user, listing, photo_ids=body.get("photo_ids"), reason=body.get("reason"),
                http_request=request,
            )
        except ApprovalError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return _proposal_sent(approval)


class ListingFormMetaView(APIView):
    """GET meta/listing-form/?business=<pk> — the Add-a-product form's choices."""

    def get_permissions(self):
        return [HasAnyRolePermission("businesses.manage_portfolio", "portfolio.manage")]

    def get(self, request):
        raw = request.query_params.get("business", "")
        if not raw.isdigit():
            return Response({"detail": "Choose a business."}, status=400)
        owner = get_managed_business(request, int(raw))
        return Response(listing_form_meta(owner))
