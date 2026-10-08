from django.http import Http404
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsStaff

from . import services
from .models import ApprovalRequest
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
        return approvals.order_by("due_at", "id") if box == "mine" else approvals.order_by("-created_at", "-id")


class ApprovalCountsView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        user = request.user
        pending = ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING)
        return Response({
            "mine": services.waiting_for(user).count(),
            "made": pending.filter(maker=user).count(),
            "team": pending.filter(maker__manager=user).count(),
            "decided": ApprovalRequest.objects.filter(decided_by=user).count(),
            "can_view_all": services.VIEW_ALL in user.effective_permission_codenames(),
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
