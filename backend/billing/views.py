from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner

from .models import Subscription, SubscriptionPlan, Transaction
from .serializers import (
    StartTrialSerializer,
    SubscribeSerializer,
    SubscriptionPlanAdminSerializer,
    SubscriptionPlanSerializer,
    SubscriptionSerializer,
    TransactionReportSerializer,
    TransactionSerializer,
)


class SubscriptionPlanListView(generics.ListAPIView):
    """Public plan list — only ever shows status="active" plans. A plan
    pending_approval or rejected must never appear here.
    """

    queryset = SubscriptionPlan.objects.filter(status=SubscriptionPlan.ACTIVE_STATUS).order_by(
        "monthly_price"
    )
    serializer_class = SubscriptionPlanSerializer
    permission_classes = [AllowAny]


class SubscriptionPlanAdminListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/billing/plans/manage/ — staff plan authoring
    (subscription_plans.manage: accountant + super_admin). GET lists every
    plan regardless of status, unlike the public SubscriptionPlanListView
    above. POST creates a new plan; SubscriptionPlanAdminSerializer.create()
    forces status="pending_approval" regardless of what's submitted.
    """

    queryset = SubscriptionPlan.objects.all().order_by("monthly_price")
    serializer_class = SubscriptionPlanAdminSerializer

    def get_permissions(self):
        return [HasRolePermission("subscription_plans.manage")]


class SubscriptionPlanAdminUpdateView(generics.UpdateAPIView):
    """PATCH /api/billing/plans/manage/<pk>/ — same permission as the list/
    create view above. SubscriptionPlanAdminSerializer.update() resets an
    already-active plan back to pending_approval as part of this same write
    whenever it's edited.
    """

    queryset = SubscriptionPlan.objects.all()
    serializer_class = SubscriptionPlanAdminSerializer
    http_method_names = ["patch"]

    def get_permissions(self):
        return [HasRolePermission("subscription_plans.manage")]


class SubscriptionPlanPendingQueueView(generics.ListAPIView):
    """Clones listings.HeroPendingQueueView's shape for pending subscription
    plans. SubscriptionPlan has no created_at/submitted_at field, so ordering
    by id (ascending) stands in for "oldest first" — ids are assigned in
    creation order.
    """

    serializer_class = SubscriptionPlanAdminSerializer
    queryset = SubscriptionPlan.objects.filter(status=SubscriptionPlan.PENDING_APPROVAL).order_by("id")

    def get_permissions(self):
        return [HasRolePermission("subscription_plans.approve")]


class SubscriptionPlanApproveView(APIView):
    """Clones listings.HeroApproveView's shape."""

    def get_permissions(self):
        return [HasRolePermission("subscription_plans.approve")]

    def post(self, request, pk):
        plan = generics.get_object_or_404(SubscriptionPlan, pk=pk)
        plan.status = SubscriptionPlan.ACTIVE_STATUS
        plan.rejection_reason = None
        plan.save(update_fields=["status", "rejection_reason"])
        return Response({"id": plan.id, "status": plan.status})


class SubscriptionPlanRejectView(APIView):
    """Clones listings.HeroRejectView's shape, including its exact
    empty-reason validation.
    """

    def get_permissions(self):
        return [HasRolePermission("subscription_plans.approve")]

    def post(self, request, pk):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "A rejection reason is required."}, status=400)
        plan = generics.get_object_or_404(SubscriptionPlan, pk=pk)
        plan.status = SubscriptionPlan.REJECTED_STATUS
        plan.rejection_reason = reason
        plan.save(update_fields=["status", "rejection_reason"])
        return Response({"id": plan.id, "status": plan.status})


class SubscriptionMeView(APIView):
    """GET the current business owner's subscription (null if none yet), or
    POST to subscribe / change plan / renew. The simulated MoMoPayment
    "success" callback is expected to POST here to persist the resulting
    state. Always is_trial=False on this path — see SubscriptionStartTrialView
    below for the registration-time free trial.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        subscription = Subscription.objects.filter(business_owner=request.user).first()
        if subscription is None:
            # NOTE: DRF's JSONRenderer special-cases `Response(None)` into an
            # empty (zero-length) body rather than a JSON `null`, which would
            # break `response.json()` on the frontend. Return `{}` instead —
            # the absence of an `id` field is the "no subscription yet" signal.
            return Response({})
        return Response(SubscriptionSerializer(subscription).data)

    def post(self, request):
        serializer = SubscribeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subscription = serializer.save(business_owner=request.user)
        return Response(SubscriptionSerializer(subscription).data)


class SubscriptionStartTrialView(APIView):
    """POST /api/billing/subscriptions/start-trial/ — the registration-time
    free trial start. Mirrors accounts.views.TermsAcceptView's step-guard
    convention: 400s if the caller isn't currently on the "plan_selection"
    registration step.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request):
        owner = request.user
        if owner.compute_registration_step() != "plan_selection":
            return Response(
                {
                    "registration_step": (
                        "Business information must be complete, with no subscription "
                        "started yet, before selecting a plan."
                    )
                },
                status=400,
            )
        serializer = StartTrialSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subscription = serializer.save(business_owner=owner)
        return Response(
            {
                "registration_step": owner.compute_registration_step(),
                "subscription": SubscriptionSerializer(subscription).data,
            },
            status=201,
        )


class TransactionMineListCreateView(generics.ListCreateAPIView):
    """List/create the current business owner's own transactions.

    Creation is expected to be called by the simulated MoMoPayment success
    flow — there is no real payment gateway verifying these records.
    """

    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get_queryset(self):
        return Transaction.objects.filter(business_owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(business_owner=self.request.user)


class BillingPagination(PageNumberPagination):
    page_size = 20


class TransactionReportListView(generics.ListAPIView):
    """Staff-only broad view across every business owner's transactions."""

    serializer_class = TransactionReportSerializer
    queryset = Transaction.objects.all()
    pagination_class = BillingPagination

    def get_permissions(self):
        return [HasRolePermission("transactions.report")]
