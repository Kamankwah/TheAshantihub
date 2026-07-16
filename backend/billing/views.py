from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth
from django.utils.dateparse import parse_date
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


def _parse_report_date_params(request):
    """Shared `?date_from=&date_to=` (ISO YYYY-MM-DD) parsing used by both
    TransactionReportListView and TransactionReportView below, so the raw
    paginated list and the aggregate report can be filtered identically by
    a frontend report page. Returns (date_from, date_to, error_response) —
    error_response is None on success, otherwise a ready-to-return 400
    Response.
    """

    date_from = date_to = None
    date_from_raw = request.query_params.get("date_from")
    date_to_raw = request.query_params.get("date_to")
    if date_from_raw:
        date_from = parse_date(date_from_raw)
        if date_from is None:
            return None, None, Response({"date_from": "Must be an ISO date (YYYY-MM-DD)."}, status=400)
    if date_to_raw:
        date_to = parse_date(date_to_raw)
        if date_to is None:
            return None, None, Response({"date_to": "Must be an ISO date (YYYY-MM-DD)."}, status=400)
    return date_from, date_to, None


class TransactionReportListView(generics.ListAPIView):
    """GET /api/billing/transactions/ — staff-only (transactions.report)
    broad, paginated view across every business owner's AND every
    customer's transactions (see TransactionReportView's docstring below for
    what's included). Accepts the same optional `?date_from=&date_to=`
    (ISO dates, inclusive) as TransactionReportView so a frontend report
    page can page through the exact rows behind a given aggregate.
    """

    serializer_class = TransactionReportSerializer
    pagination_class = BillingPagination

    def get_permissions(self):
        return [HasRolePermission("transactions.report")]

    def get_queryset(self):
        queryset = Transaction.objects.all()
        date_from, date_to, error = _parse_report_date_params(self.request)
        if error is not None:
            # generics.ListAPIView has no clean hook to short-circuit with a
            # custom error response from get_queryset — filtering to an
            # impossible queryset here and re-validating (cheaply) in list()
            # would be awkward, so this view instead re-parses in list() to
            # return the 400. get_queryset() itself just applies whatever
            # parses cleanly; see list() below for the actual guard.
            return queryset.none()
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        return queryset

    def list(self, request, *args, **kwargs):
        _, _, error = _parse_report_date_params(request)
        if error is not None:
            return error
        return super().list(request, *args, **kwargs)


class TransactionReportView(APIView):
    """GET /api/billing/transactions/report/?date_from=&date_to= —
    staff-only (transactions.report) AGGREGATE report: summary totals, a
    breakdown by status, and a month-bucketed amount series shaped for the
    frontend's SpendAreaChart component (`[{month:"2026-01", amount:"1234.56"},
    ...]` — "YYYY-MM" strings, oldest first; SpendAreaChart's own docstring
    example uses an abbreviated "Feb" label, but this endpoint returns a
    sortable ISO month key and leaves any display formatting to the caller).

    **What's included — every Transaction row, not just business-owner
    payments:** this already covers business-owner subscription/hero-media/
    promotion payments (business_owner set) AND customer order checkouts
    (orders.views.OrderCheckoutView, customer set) AND customer event-ticket
    purchases (events.views — TicketPurchaseView et al, customer set) — all
    three write a billing.Transaction row today, so this report is a
    complete picture of platform payment volume, not a partial one gap-
    flagged as missing. Ticket *refunds* also book a Transaction with
    status=refunded (events.views.EscrowRefundView), so those net out in the
    refunded bucket of `status_breakdown` rather than silently vanishing —
    `summary.total_amount` is a raw sum across all statuses (including
    refunded/failed/pending rows), not a "net revenue" figure; a caller
    wanting net revenue should compute it from `status_breakdown` (e.g.
    success total minus refunded total) rather than trust `total_amount`
    alone for that purpose.

    Deliberately does NOT embed the underlying transaction list — see
    TransactionReportListView (GET /api/billing/transactions/) for the
    existing paginated raw list, filterable by the same `?date_from=
    &date_to=` params, so a `?date_from=&date_to=` call to *this* aggregate
    endpoint doesn't also need its own pagination envelope.
    """

    def get_permissions(self):
        return [HasRolePermission("transactions.report")]

    def get(self, request):
        date_from, date_to, error = _parse_report_date_params(request)
        if error is not None:
            return error

        queryset = Transaction.objects.all()
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)

        summary = queryset.aggregate(count=Count("id"), total_amount=Sum("amount"))

        status_breakdown = {
            row["status"]: {"count": row["count"], "amount": str(row["amount"] or "0.00")}
            for row in queryset.values("status").annotate(count=Count("id"), amount=Sum("amount"))
        }

        monthly = (
            queryset.annotate(month=TruncMonth("created_at"))
            .values("month")
            .annotate(amount=Sum("amount"))
            .order_by("month")
        )
        series = [
            {"month": row["month"].strftime("%Y-%m"), "amount": str(row["amount"] or "0.00")}
            for row in monthly
        ]

        return Response(
            {
                "summary": {
                    "count": summary["count"] or 0,
                    "total_amount": str(summary["total_amount"] or "0.00"),
                },
                "status_breakdown": status_breakdown,
                "series": series,
            }
        )
