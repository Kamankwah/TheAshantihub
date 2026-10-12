import statistics
from datetime import timedelta

from django.http import Http404, QueryDict
from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsStaff

from . import services
from .models import ApprovalRequest
from .registry import all_kinds
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
        return ApprovalRequest.objects.filter(decided_by=staff)
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
        approvals = box_queryset(self.request.user, box).select_related("maker__role", "assigned_to__role", "decided_by__role")
        if params.get("status"):
            approvals = approvals.filter(status=params["status"])
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
        return Response({
            "mine": waiting.count(),
            "made": pending.filter(maker=user).count(),
            "team": pending.filter(maker__manager=user).count(),
            "decided": ApprovalRequest.objects.filter(decided_by=user).count(),
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
            "can_view_all": services.VIEW_ALL in user.effective_permission_codenames(),
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
        return services.visible_to(self.request.user).select_related("maker__role", "assigned_to__role", "decided_by__role")


class _DecisionView(APIView):
    def get_permissions(self):
        return [IsStaff()]

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
            or services.approvers_for(approval).filter(pk=request.user.pk).exists()
        ):
            raise Http404
        try:
            self.decide(approval, request)
        except services.ApprovalError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        approval.refresh_from_db()
        return Response(ApprovalDetailSerializer(approval, context={"request": request}).data)


class ApprovalApproveView(_DecisionView):
    def decide(self, approval, request):
        services.approve(approval.pk, request.user, note=str(request.data.get("note") or ""), http_request=request)


class ApprovalRejectView(_DecisionView):
    def decide(self, approval, request):
        services.reject(approval.pk, request.user, note=str(request.data.get("note") or ""), http_request=request)


class ApprovalCancelView(_DecisionView):
    def decide(self, approval, request):
        services.cancel(approval.pk, request.user, http_request=request)
