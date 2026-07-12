from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner

from .models import Subscription, SubscriptionPlan, Transaction
from .serializers import (
    SubscribeSerializer,
    SubscriptionPlanSerializer,
    SubscriptionSerializer,
    TransactionReportSerializer,
    TransactionSerializer,
)


class SubscriptionPlanListView(generics.ListAPIView):
    queryset = SubscriptionPlan.objects.all().order_by("monthly_price")
    serializer_class = SubscriptionPlanSerializer
    permission_classes = [AllowAny]


class SubscriptionMeView(APIView):
    """GET the current business owner's subscription (null if none yet), or
    POST to subscribe / change plan. The simulated MoMoPayment "success"
    callback is expected to POST here to persist the resulting state.
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
