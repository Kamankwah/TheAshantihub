import statistics
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.http import Http404, QueryDict
from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.models import Role, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission, IsStaff, RequiresSudo
from activity.services import record

from . import rules, services
from .models import ApprovalDecision, ApprovalRequest, ApprovalRule
from .registry import all_kinds, get_kind
from .serializers import ApprovalDetailSerializer, ApprovalSerializer

BOXES = ("mine", "made", "team", "decided", "all")


def box_queryset(staff, box):
    if box == "mine":
        return services.waiting_for(staff)
    if box == "made":
        return ApprovalRequest.objects.filter(maker=staff)
    if box == "team":
        return ApprovalRequest.objects.filter(maker__manager=staff)
    if box == "decided":
        return ApprovalRequest.objects.filter(
            Q(decided_by=staff) | Q(pk__in=ApprovalDecision.objects.filter(staff=staff).values("request_id"))
        )
    if box == "all":
        if services.VIEW_ALL not in staff.effective_permission_codenames():
            raise PermissionDenied("Only a Super Admin can see every request.")
        return ApprovalRequest.objects.all()
    raise ValidationError({"box": f"Use one of: {', '.join(BOXES)}."})


class ApprovalPagination(PageNumberPagination):
    page_size = 25


class ApprovalListView(generics.ListAPIView):
    serializer_class = ApprovalSerializer
    pagination_class = ApprovalPagination

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        params = self.request.query_params
        box = params.get("box", "mine")
        approvals = box_queryset(self.request.user, box).select_related("maker__role", "assigned_to__role", "decided_by__role").prefetch_related("decisions__staff__role")
        if params.get("status"):
            approvals = approvals.filter(status__in=[value for value in params["status"].split(",") if value])
        if params.get("team"):
            # The team a request comes from = the maker's role (Operations, Accountant, …).
            approvals = approvals.filter(maker__role__name=params["team"])
        if params.get("level"):
            if not params["level"].isdigit():
                raise ValidationError({"level": "Use an escalation level number."})
            approvals = approvals.filter(escalation_level=int(params["level"]))
        for key, lookup in (("amount_min", "amount__gte"), ("amount_max", "amount__lte")):
            if params.get(key):
                try:
                    approvals = approvals.filter(**{lookup: Decimal(params[key])})
                except InvalidOperation:
                    raise ValidationError({key: "Use an amount in GH₵."})
        if params.get("kind"):
            approvals = approvals.filter(kind=params["kind"])
        if params.get("maker"):
            if not params["maker"].isdigit():
                raise ValidationError({"maker": "Use a staff member's id."})
            approvals = approvals.filter(maker_id=int(params["maker"]))
        if params.get("min_wait_hours"):
            try:
                hours = float(params["min_wait_hours"])
            except ValueError:
                raise ValidationError({"min_wait_hours": "Use a number of hours."})
            approvals = approvals.filter(created_at__lte=timezone.now() - timedelta(hours=hours))
        # Moved up to this person by the engine (no one decided in time).
        if params.get("escalated") in ("1", "true"):
            approvals = approvals.filter(escalation_level__gt=0)
        ordering = params.get("ordering")
        if ordering == "newest":
            return approvals.order_by("-created_at", "-id")
        if ordering == "due":
            return approvals.order_by("due_at", "id")
        if ordering == "decided":
            return approvals.order_by("-decided_at", "-id")
        return approvals.order_by("due_at", "id") if box == "mine" else approvals.order_by("-created_at", "-id")


class ApprovalCountsView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        user = request.user
        pending = ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING)
        waiting = services.waiting_for(user)
        can_view_all = services.VIEW_ALL in user.effective_permission_codenames()
        return Response({
            "mine": waiting.count(),
            "made": pending.filter(maker=user).count(),
            "team": pending.filter(maker__manager=user).count(),
            "decided": box_queryset(user, "decided").count(),
            "escalated_to_me": waiting.filter(escalation_level__gt=0).count(),
            # Who has requests waiting for this person, to fill the "Made by" filter.
            "makers": [
                {"id": maker_id, "full_name": name}
                for maker_id, name in waiting.order_by("maker__full_name").values_list("maker_id", "maker__full_name").distinct()
            ],
            # Every kind a request can be, for the "Kind" filter, with the hours each level gets.
            "kinds": [
                {"key": kind.key, "label": kind.label, "response_hours": kind.response_hours}
                for kind in sorted(all_kinds().values(), key=lambda k: k.label)
            ],
            "can_view_all": can_view_all,
            # The Super Admin's "Everything open" tab and the teams that have made requests (the "Team" filter).
            "all_open": pending.count() if can_view_all else None,
            "teams": sorted(
                {role for role in ApprovalRequest.objects.values_list("maker__role__name", flat=True).distinct()}
            ) if can_view_all else [],
            "levels": sorted(
                {level for level in pending.values_list("escalation_level", flat=True).distinct()}
            ) if can_view_all else [],
        })


class ApprovalStatsView(APIView):
    """GET /api/approvals/stats/ — this person's decisions today: how many, and the
    median time from the request being made to their decision (the inbox's
    "You decided today" strip)."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        rows = list(
            ApprovalRequest.objects.filter(
                decided_by=request.user, decided_at__gte=start,
                status__in=[ApprovalRequest.APPROVED, ApprovalRequest.REJECTED],
            ).values_list("created_at", "decided_at", "status")
        )
        minutes = [(decided - created).total_seconds() / 60 for created, decided, _ in rows]
        return Response({
            "decided_today": len(rows),
            "approved_today": sum(1 for *_, status in rows if status == ApprovalRequest.APPROVED),
            "returned_today": sum(1 for *_, status in rows if status == ApprovalRequest.REJECTED),
            "median_minutes": round(statistics.median(minutes)) if minutes else None,
        })


class ApprovalDetailView(generics.RetrieveAPIView):
    serializer_class = ApprovalDetailSerializer

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        return (
            services.visible_to(self.request.user)
            .select_related("maker__role", "assigned_to__role", "decided_by__role").prefetch_related("decisions__staff__role")
        )


class _DecisionView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def before_decide(self, approval, request):
        """A hook for checks that must run after visibility but before the decision."""

    def decide(self, approval, request):
        raise NotImplementedError

    def post(self, request, pk):
        if not isinstance(request.data, (dict, QueryDict)):
            return Response({"detail": "Send the decision as a JSON object."}, status=400)
        approval = generics.get_object_or_404(ApprovalRequest, pk=pk)
        # A pool approver who lost a race is no longer in waiting_for, but was
        # an eligible approver: let the service answer "already decided".
        if not (
            services.visible_to(request.user).filter(pk=pk).exists()
            or services.was_eligible(approval, request.user)
        ):
            raise Http404
        self.before_decide(approval, request)
        try:
            self.decide(approval, request)
        except services.ApprovalError as exc:
            body = {"detail": exc.message}
            if exc.code:
                body["code"] = exc.code
            return Response(body, status=exc.status_code)
        approval.refresh_from_db()
        return Response(ApprovalDetailSerializer(approval, context={"request": request}).data)


class ApprovalApproveView(_DecisionView):
    def before_decide(self, approval, request):
        # Money kinds need the password re-entered on this session (staff foundations F9);
        # the frontend turns the sudo_required answer into a password prompt and retries.
        kind = get_kind(approval.kind)
        if kind is not None and kind.requires_sudo and approval.status == ApprovalRequest.PENDING:
            sessions.require_sudo(request)

    def decide(self, approval, request):
        services.approve(approval.pk, request.user, note=str(request.data.get("note") or ""), http_request=request)


class ApprovalRejectView(_DecisionView):
    def decide(self, approval, request):
        services.reject(approval.pk, request.user, note=str(request.data.get("note") or ""), http_request=request)


class ApprovalCancelView(_DecisionView):
    def decide(self, approval, request):
        services.cancel(approval.pk, request.user, http_request=request)


def _money(value):
    return f"{value:.2f}"


def _chain_for_kind(kind):
    """The default chain in words (a kind with its own resolver names it in chain_note)."""
    if kind.chain_note:
        return [kind.chain_note]
    steps = ["The maker's manager"]
    if kind.pool_permission:
        names = list(
            Role.objects.filter(permissions__codename=kind.pool_permission)
            .exclude(name=Role.SUPER_ADMIN).order_by("name").values_list("name", flat=True)
        )
        steps.append(" or ".join(f"Any {Role(name=n).get_name_display()}" for n in names) if names else "Anyone who can approve this")
    steps.append("Super Admin")
    return steps


class ApprovalRulesView(APIView):
    """GET/PATCH /api/approvals/rules/ — Approval rules & timers (Super Admin).
    PATCH needs the password re-entered (sudo) and records one audit event with
    the before and after. Body: any of cosign_threshold, refund_threshold,
    campaign_threshold, remind_fraction, and kinds: {kind_key: hours | null}."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [HasAnyRolePermission(rules.MANAGE_RULES, rules.VIEW_ALL)]
        return [HasRolePermission(rules.MANAGE_RULES), RequiresSudo()]

    def _snapshot(self):
        settings = rules.get_settings()
        overrides = dict(ApprovalRule.objects.values_list("kind", "response_hours"))
        return {
            "cosign_threshold": _money(settings.cosign_threshold),
            "refund_threshold": _money(settings.refund_threshold),
            "campaign_threshold": _money(settings.campaign_threshold),
            "remind_fraction": str(settings.remind_fraction),
            "hours": {key: overrides[key] for key in sorted(overrides)},
        }

    def _payload(self):
        settings = rules.get_settings()
        overrides = dict(ApprovalRule.objects.values_list("kind", "response_hours"))
        kinds = []
        for kind in sorted(all_kinds().values(), key=lambda k: k.label):
            kinds.append({
                "key": kind.key, "label": kind.label, "chain": _chain_for_kind(kind),
                "response_hours": overrides.get(kind.key, kind.response_hours), "default_hours": kind.response_hours,
                "overridden": kind.key in overrides, "requires_sudo": kind.requires_sudo,
                "has_amount": kind.amount_of is not None,
            })
        named = list(rules.cosigners().order_by("full_name").values("id", "full_name", "email"))
        return {
            "settings": {
                "cosign_threshold": _money(settings.cosign_threshold),
                "refund_threshold": _money(settings.refund_threshold),
                "campaign_threshold": _money(settings.campaign_threshold),
                "remind_fraction": str(settings.remind_fraction),
                "updated_at": settings.updated_at,
                "updated_by": settings.updated_by.full_name if settings.updated_by_id else None,
                "defaults": {
                    "cosign_threshold": _money(settings.DEFAULT_COSIGN_THRESHOLD),
                    "refund_threshold": _money(settings.DEFAULT_REFUND_THRESHOLD),
                    "campaign_threshold": _money(settings.DEFAULT_CAMPAIGN_THRESHOLD),
                    "remind_fraction": str(settings.DEFAULT_REMIND_FRACTION),
                },
            },
            "kinds": kinds,
            "cosigners": named,
            "cosigner_named": bool(named),
            "cosigner_invites_pending": StaffUser.objects.filter(
                role__name=Role.COSIGNER, is_active=True, invite_token__isnull=False
            ).count(),
            "waiting_for_cosigner": ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING, required_approvals__gt=1).count(),
        }

    def get(self, request):
        return Response(self._payload())

    def patch(self, request):
        data = request.data
        if not isinstance(data, (dict, QueryDict)):
            return Response({"detail": "Send the changes as a JSON object."}, status=400)
        errors = {}
        changes = {}
        for field, label, minimum in (
            ("cosign_threshold", "The co-sign limit", Decimal("0.01")),
            ("refund_threshold", "The refund limit", Decimal("0")),
            ("campaign_threshold", "The campaign limit", Decimal("0")),
        ):
            if field in data:
                try:
                    value = Decimal(str(data[field]).replace(",", "").strip()).quantize(Decimal("0.01"))
                except (InvalidOperation, ValueError):
                    errors[field] = f"{label} must be an amount in GH₵."
                    continue
                if value < minimum or value > Decimal("9999999999.99"):
                    errors[field] = f"{label} must be at least GH₵ {minimum}."
                    continue
                changes[field] = value
        if "remind_fraction" in data:
            try:
                fraction = Decimal(str(data["remind_fraction"])).quantize(Decimal("0.01"))
            except (InvalidOperation, ValueError):
                fraction = None
            if fraction not in rules.REMIND_CHOICES:
                errors["remind_fraction"] = "Remind at 50% or 75% of the response time."
            else:
                changes["remind_fraction"] = fraction
        hours = {}
        raw_kinds = data.get("kinds", {}) if hasattr(data, "get") else {}
        if not isinstance(raw_kinds, dict):
            errors["kinds"] = "Send kinds as {kind: hours}."
            raw_kinds = {}
        for key, value in raw_kinds.items():
            if get_kind(key) is None:
                errors.setdefault("kinds", {})[key] = "Unknown kind of request."
            elif value in (None, ""):
                hours[key] = None
            elif isinstance(value, bool) or not str(value).isdigit() or not 1 <= int(value) <= rules.MAX_RESPONSE_HOURS:
                errors.setdefault("kinds", {})[key] = f"Use a whole number of hours from 1 to {rules.MAX_RESPONSE_HOURS}."
            else:
                hours[key] = int(value)
        if errors:
            return Response(errors, status=400)
        with transaction.atomic():
            before = self._snapshot()
            settings = rules.get_settings()
            for field, value in changes.items():
                setattr(settings, field, value)
            if changes:
                settings.updated_by, settings.updated_at = request.user, timezone.now()
                settings.save()
            for key, value in hours.items():
                if value is None or value == get_kind(key).response_hours:
                    ApprovalRule.objects.filter(kind=key).delete()
                else:
                    ApprovalRule.objects.update_or_create(
                        kind=key, defaults={"response_hours": value, "updated_by": request.user, "updated_at": timezone.now()},
                    )
            after = self._snapshot()
            if after != before:
                settings.updated_by, settings.updated_at = request.user, timezone.now()
                settings.save()
                record(request.user, "approval.rules_changed", target=settings, before=before, after=after,
                       summary="Changed approval rules and timers", request=request)
        return Response(self._payload())
