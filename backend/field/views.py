"""Visit endpoints (spec S5). A scout reads their own visits; Operations
(portfolio.manage) can read any scout's with ?scout=. Writes are the scout's
own, on their own open visit."""
from datetime import timedelta

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, ScoutAssignment
from accounts.permissions import HasAnyRolePermission, HasRolePermission

from . import prospects as prospects_module
from . import services
from .models import Prospect, VisitCheckIn
from .serializers import (
    CheckInSerializer,
    CheckOutSerializer,
    VisitPhotoSerializer,
    ProspectSerializer,
    VisitUpdateSerializer,
    prospect_item,
    visit_item,
)
from .services import VisitError

SCOUT_PERMS = ("businesses.manage_portfolio", "scouts.verify")
OPS_PERM = "portfolio.manage"


def _refused(error):
    return Response({"detail": error.message, "code": error.code}, status=error.status_code)


def _invalid(serializer):
    errors = serializer.errors
    detail = errors.get("detail")
    message = detail[0] if detail else next(iter(errors.values()))[0] if errors else "Check the form."
    return Response({"detail": str(message), "errors": errors}, status=status.HTTP_400_BAD_REQUEST)


def _with_related(queryset):
    return queryset.select_related("scout", "business_owner__profile__zone", "prospect__zone").prefetch_related("photos")


class VisitTargetsView(APIView):
    """GET visit-targets/ — the places this scout can check in at. The client
    sorts them by distance from the fix it takes at check-in; no location is
    sent before that."""

    def get_permissions(self):
        return [HasAnyRolePermission(*SCOUT_PERMS)]

    def get(self, request):
        perms = request.user.effective_permission_codenames()
        items = []
        if "businesses.manage_portfolio" in perms:
            owners = BusinessOwner.objects.filter(account_manager=request.user).exclude(
                kyc_status=BusinessOwner.REJECTED).select_related("profile__zone").order_by("pk")
            for owner in owners:
                pin = services.business_pin(owner)
                profile = getattr(owner, "profile", None)
                items.append(_target("business", owner, pin, profile, business_owner=owner.pk))
        if "scouts.verify" in perms:
            assignments = ScoutAssignment.objects.filter(
                scout=request.user, status=ScoutAssignment.ASSIGNED,
            ).select_related("business_owner__profile__zone")
            for assignment in assignments:
                owner = assignment.business_owner
                items.append(_target(
                    "verification", owner, services.business_pin(owner), getattr(owner, "profile", None),
                    scout_assignment=assignment.pk,
                ))
        if "businesses.register" in perms:
            for prospect in Prospect.objects.filter(scout=request.user).exclude(
                status=Prospect.REGISTERED).select_related("zone").order_by("pk"):
                pin = services.prospect_pin(prospect)
                items.append({
                    "kind": "prospect", "business_owner": None, "scout_assignment": None, "prospect": prospect.pk,
                    "business_id": None, "name": prospect.name, "area": prospect.zone.name if prospect.zone_id else None,
                    "lat": float(pin[0]) if pin else None, "lng": float(pin[1]) if pin else None,
                    "has_pin": pin is not None,
                })
        items.sort(key=lambda item: item["name"].lower())
        return Response(items)


def _target(kind, owner, pin, profile, **ids):
    zone = getattr(profile, "zone", None)
    return {
        "kind": kind,
        "business_owner": ids.get("business_owner"),
        "scout_assignment": ids.get("scout_assignment"),
        "business_id": owner.pk,
        "name": owner.display_name,
        "area": zone.name if zone else None,
        "lat": float(pin[0]) if pin else None,
        "lng": float(pin[1]) if pin else None,
        "has_pin": pin is not None,
    }


class VisitPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200

    def __init__(self, summary=None):
        self.summary = summary or {}

    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        response.data["summary"] = self.summary
        # The time of the first visit still hidden, so the screen can say "Show 3 more from Monday".
        end = self.page.end_index()
        rows = list(self.page.paginator.object_list[end:end + 1]) if end < self.page.paginator.count else []
        response.data["next_hidden_at"] = rows[0].checked_in_at if rows else None
        return response


def _week_start(now):
    local = timezone.localtime(now)
    return (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def _month_start(now):
    return timezone.localtime(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def week_summary(visits, now):
    """This week's numbers for the tiles: visits done, average stay in
    minutes (None with no completed visit) and visits flagged."""
    week = visits.filter(checked_in_at__gte=_week_start(now)).exclude(status=VisitCheckIn.ABANDONED)
    done = week.filter(status=VisitCheckIn.DONE)
    stay = done.aggregate(avg=Avg(ExpressionWrapper(F("checked_out_at") - F("checked_in_at"), output_field=DurationField())))["avg"]
    return {
        "done": done.count(),
        "avg_minutes": round(stay.total_seconds() / 60) if stay is not None else None,
        "flagged": week.filter(outside_radius=True).count(),
    }


class VisitListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [HasAnyRolePermission(*SCOUT_PERMS)]
        return [HasAnyRolePermission(*SCOUT_PERMS, OPS_PERM)]

    def get(self, request):
        user = request.user
        perms = user.effective_permission_codenames()
        scout_param = request.query_params.get("scout")
        visits = VisitCheckIn.objects.exclude(status=VisitCheckIn.ABANDONED)
        if scout_param:
            if OPS_PERM not in perms:
                raise Http404
            if not (scout_param.isdecimal() and scout_param.isascii()):
                return Response({"detail": "Use a staff id."}, status=400)
            visits = visits.filter(scout_id=scout_param)
        elif any(code in perms for code in SCOUT_PERMS):
            visits = visits.filter(scout=user)
        else:
            return Response({"detail": "Pick a scout with ?scout=."}, status=400)
        now = timezone.now()
        summary = week_summary(visits, now)
        window = request.query_params.get("range", "week")
        if window == "flagged":
            listed = visits.filter(outside_radius=True)
        elif window == "month":
            listed = visits.filter(checked_in_at__gte=_month_start(now))
        else:
            listed = visits.filter(checked_in_at__gte=_week_start(now))
        paginator = VisitPagination(summary)
        page = paginator.paginate_queryset(_with_related(listed), request, view=self)
        return paginator.get_paginated_response([visit_item(visit, request) for visit in page])

    def post(self, request):
        serializer = CheckInSerializer(data=request.data if isinstance(request.data, dict) else {})
        if not serializer.is_valid():
            return _invalid(serializer)
        data = serializer.validated_data
        try:
            visit = services.check_in(
                request.user, business_owner_id=data.get("business_owner"),
                scout_assignment_id=data.get("scout_assignment"), prospect_id=data.get("prospect"),
                purpose=data.get("purpose"),
                lat=data.get("lat"), lng=data.get("lng"), accuracy_m=data.get("accuracy_m"), request=request,
            )
        except VisitError as error:
            return _refused(error)
        visit = _with_related(VisitCheckIn.objects.filter(pk=visit.pk)).get()
        return Response(visit_item(visit, request), status=201)


class OpenVisitView(APIView):
    """GET visits/open/ — {visit: …} for the caller's open visit, or null."""

    def get_permissions(self):
        return [HasAnyRolePermission(*SCOUT_PERMS)]

    def get(self, request):
        visit = _with_related(VisitCheckIn.objects.filter(scout=request.user, status=VisitCheckIn.OPEN)).first()
        return Response({"visit": visit_item(visit, request) if visit else None})


def _own_visit(request, pk):
    """The caller's own visit, else 404 — nobody edits another scout's."""
    return get_object_or_404(_with_related(VisitCheckIn.objects.filter(scout=request.user)), pk=pk)


class VisitDetailView(APIView):
    """PATCH visits/<id>/ — purpose and notes while the visit is open."""

    def get_permissions(self):
        return [HasAnyRolePermission(*SCOUT_PERMS)]

    def patch(self, request, pk):
        visit = _own_visit(request, pk)
        serializer = VisitUpdateSerializer(data=request.data if isinstance(request.data, dict) else {})
        if not serializer.is_valid():
            return _invalid(serializer)
        try:
            services.update_open_visit(
                visit, purpose=serializer.validated_data.get("purpose"),
                notes=serializer.validated_data.get("notes"), request=request,
            )
        except VisitError as error:
            return _refused(error)
        return Response(visit_item(_own_visit(request, pk), request))


class VisitCheckOutView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission(*SCOUT_PERMS)]

    def post(self, request, pk):
        visit = _own_visit(request, pk)
        serializer = CheckOutSerializer(data=request.data if isinstance(request.data, dict) else {})
        if not serializer.is_valid():
            return _invalid(serializer)
        data = serializer.validated_data
        try:
            services.check_out(
                visit, lat=data.get("lat"), lng=data.get("lng"), accuracy_m=data.get("accuracy_m"),
                notes=data.get("notes"), request=request,
            )
        except VisitError as error:
            return _refused(error)
        return Response(visit_item(_own_visit(request, pk), request))


class VisitPhotoView(APIView):
    """POST visits/<id>/photos/ — one photo with that capture's location."""

    def get_permissions(self):
        return [HasAnyRolePermission(*SCOUT_PERMS)]

    def post(self, request, pk):
        visit = _own_visit(request, pk)
        if visit.status != VisitCheckIn.OPEN:
            return _refused(VisitError(services.VISIT_CLOSED, 409, "closed"))
        if visit.photos.count() >= services.MAX_PHOTOS:
            return _refused(VisitError(f"A visit holds up to {services.MAX_PHOTOS} photos."))
        serializer = VisitPhotoSerializer(data=request.data)
        if not serializer.is_valid():
            return _invalid(serializer)
        data = serializer.validated_data
        try:
            photo = services.add_photo(
                visit, data["image"], lat=data.get("lat"), lng=data.get("lng"), accuracy_m=data.get("accuracy_m"),
                request=request,
            )
        except VisitError as error:
            return _refused(error)
        return Response(
            {"id": photo.pk, "url": request.build_absolute_uri(photo.image.url), "taken_at": photo.taken_at},
            status=201,
        )


# ── Prospects ──────────────────────────────────────────────────────────────

def _month_start_local(now):
    return timezone.localtime(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _prospect_order(prospect, now):
    """Open prospects first, overdue follow-ups at the top, then the soonest;
    closed ones last."""
    closed = prospect.status == Prospect.NOT_INTERESTED
    due = prospect.next_follow_up_at
    return (closed, due is None, due or now, -prospect.pk)


class ProspectListCreateView(APIView):
    """GET prospects/ — the scout's own, not yet registered (?status= narrows;
    status=registered lists the signed-up ones), with counts per status and
    how many signed up this month. POST adds one: no location is read."""

    def get_permissions(self):
        return [HasRolePermission("businesses.register")]

    def get(self, request):
        now = timezone.now()
        own = Prospect.objects.filter(scout=request.user)
        counts = {code: 0 for code, _ in Prospect.STATUS_CHOICES}
        for row in own.values("status").annotate(n=Count("pk")):
            counts[row["status"]] = row["n"]
        counts["all"] = sum(n for code, n in counts.items() if code != Prospect.REGISTERED)
        wanted = request.query_params.get("status", "all")
        listed = own.filter(status=wanted) if wanted in counts and wanted != "all" else own.exclude(status=Prospect.REGISTERED)
        rows = sorted(prospects_module.with_last_visit(listed)[:500], key=lambda p: _prospect_order(p, now))
        return Response({
            "counts": counts,
            "signed_up_this_month": own.filter(registered_at__gte=_month_start_local(now)).count(),
            "results": [prospect_item(prospect) for prospect in rows],
        })

    def post(self, request):
        serializer = ProspectSerializer(data=request.data if isinstance(request.data, dict) else {})
        if not serializer.is_valid():
            return _invalid(serializer)
        data = serializer.validated_data
        try:
            prospect = prospects_module.create_prospect(request.user, data, request=request)
        except VisitError as error:
            return _refused(error)
        prospect = prospects_module.with_last_visit(Prospect.objects.filter(pk=prospect.pk)).get()
        return Response(prospect_item(prospect), status=201)


class ProspectDetailView(APIView):
    def get_permissions(self):
        return [HasRolePermission("businesses.register")]

    def _own(self, request, pk):
        return get_object_or_404(prospects_module.with_last_visit(Prospect.objects.filter(scout=request.user)), pk=pk)

    def get(self, request, pk):
        return Response(prospect_item(self._own(request, pk)))

    def patch(self, request, pk):
        prospect = self._own(request, pk)
        serializer = ProspectSerializer(data=request.data if isinstance(request.data, dict) else {}, partial=True)
        if not serializer.is_valid():
            return _invalid(serializer)
        try:
            prospects_module.update_prospect(prospect, serializer.validated_data, request=request)
        except VisitError as error:
            return _refused(error)
        return Response(prospect_item(self._own(request, pk)))
