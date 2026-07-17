from django.utils import timezone
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasAnyRolePermission, HasRolePermission
from accounts.views import IsBusinessOwner

from .models import CreditScore, LendingPartner, LoanApplication
from .scoring import compute_naive_credit_score
from .serializers import (
    CreditScoreSerializer,
    CreditScoreStaffListSerializer,
    LendingPartnerSerializer,
    LoanApplicationCreateSerializer,
    LoanApplicationSerializer,
)


def _refresh_base_score(owner):
    """Recompute the naive base score for `owner`, persisting it without
    touching the staff manual_adjustment (which is deliberately not
    recomputed). Returns the CreditScore row.
    """
    score, factors = compute_naive_credit_score(owner)
    credit_score, _ = CreditScore.objects.update_or_create(
        business_owner=owner, defaults={"score": score, "factors": factors}
    )
    return credit_score


class CreditScoreMeView(APIView):
    """Compute-on-read: recomputes the naive placeholder base score for the
    current business owner on every GET, persisting it. Any staff
    manual_adjustment is preserved and folded into the effective score the
    serializer returns. See credit/scoring.py for why this is not real
    underwriting.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        credit_score = _refresh_base_score(request.user)
        return Response(CreditScoreSerializer(credit_score).data)


class CreditScoreStaffListView(APIView):
    """Staff aggregate view across every business owner's (naive, placeholder)
    credit score. Viewable by analytics.view (the historical gate) OR
    credit.manage (the new item-16 gate that also unlocks adjustment). Computed
    fresh on every request for simplicity — fine at this stub's expected scale.
    """

    def get_permissions(self):
        return [HasAnyRolePermission("analytics.view", "credit.manage")]

    def get(self, request):
        results = [
            _refresh_base_score(owner)
            for owner in BusinessOwner.objects.all().order_by("full_name")
        ]
        return Response(CreditScoreStaffListSerializer(results, many=True).data)


class CreditScoreAdjustView(APIView):
    """POST /api/credit/scores/{business_owner_id}/adjust/ — staff manual
    adjustment (item 16, credit.manage). Body: {"adjustment": <signed int>,
    "reason": "..."}. The adjustment is a delta layered on the recomputed base,
    not an absolute override, so the underlying signals still move the score;
    staff only nudge it. A reason is required so an adjustment is never
    unaccountable.
    """

    def get_permissions(self):
        return [HasRolePermission("credit.manage")]

    def post(self, request, pk):
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        try:
            adjustment = int(request.data.get("adjustment"))
        except (TypeError, ValueError):
            return Response({"adjustment": "A whole-number adjustment is required."}, status=400)
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "A reason for the adjustment is required."}, status=400)

        credit_score = _refresh_base_score(owner)
        credit_score.manual_adjustment = adjustment
        credit_score.adjustment_reason = reason
        credit_score.adjusted_by = request.user
        credit_score.adjusted_at = timezone.now()
        credit_score.save(
            update_fields=["manual_adjustment", "adjustment_reason", "adjusted_by", "adjusted_at"]
        )
        return Response(CreditScoreStaffListSerializer(credit_score).data)


# ── Lending partners ───────────────────────────────────────────────────────
class LendingPartnerListCreateView(generics.ListCreateAPIView):
    """GET lists partners; POST creates one (credit.manage).

    GET is open to any authenticated caller but scopes the result: a business
    owner sees only *active* partners (the directory they can actually apply
    to), while a staffer holding credit.manage sees every partner including
    inactive ones, so they can manage the full list.
    """

    serializer_class = LendingPartnerSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission("credit.manage")]
        return [IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        codenames_fn = getattr(user, "effective_permission_codenames", None)
        can_manage = callable(codenames_fn) and "credit.manage" in codenames_fn()
        if can_manage:
            return LendingPartner.objects.all()
        return LendingPartner.objects.filter(is_active=True)


class LendingPartnerDetailView(generics.UpdateAPIView):
    """PATCH /api/credit/partners/{id}/ — edit or (de)activate a partner
    (credit.manage). No DELETE: a partner with loan-application history should
    be deactivated, not erased (LoanApplication.lending_partner is SET_NULL,
    so a delete would orphan those records rather than block).
    """

    queryset = LendingPartner.objects.all()
    serializer_class = LendingPartnerSerializer
    http_method_names = ["patch"]

    def get_permissions(self):
        return [HasRolePermission("credit.manage")]


# ── Loan applications ──────────────────────────────────────────────────────
class LoanApplicationPagination(PageNumberPagination):
    page_size = 20


class LoanApplicationCreateView(generics.CreateAPIView):
    """POST /api/credit/loans/ — a business owner submits an application.
    Replaces the CreditPanel's pure-mock submit. score_at_application is
    snapshotted server-side from the caller's current effective score, never
    trusted from the body.
    """

    serializer_class = LoanApplicationCreateSerializer
    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        credit_score = _refresh_base_score(request.user)
        serializer.save(
            business_owner=request.user,
            score_at_application=credit_score.effective_score,
        )
        # Return the full read shape (with names/status), not the bare input.
        return Response(LoanApplicationSerializer(serializer.instance).data, status=201)


class MyLoanApplicationsView(generics.ListAPIView):
    """GET /api/credit/loans/mine/ — the caller's own applications."""

    serializer_class = LoanApplicationSerializer
    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get_queryset(self):
        return LoanApplication.objects.filter(business_owner=self.request.user)


class LoanApplicationStaffListView(generics.ListAPIView):
    """GET /api/credit/loans/ — the staff loan queue (credit.manage)."""

    serializer_class = LoanApplicationSerializer
    pagination_class = LoanApplicationPagination

    def get_permissions(self):
        return [HasRolePermission("credit.manage")]

    def get_queryset(self):
        return LoanApplication.objects.all().select_related(
            "business_owner", "lending_partner", "reviewed_by"
        )


class LoanApplicationReviewView(APIView):
    """POST /api/credit/loans/{id}/review/ — staff decision (credit.manage).
    Body: {"outcome": "approved"|"declined"|"under_review", "notes": "..."}.
    A terminal (approved/declined) application can't be re-reviewed, matching
    the "final state" convention the disputes/contact queues follow.
    """

    def get_permissions(self):
        return [HasRolePermission("credit.manage")]

    def post(self, request, pk):
        application = generics.get_object_or_404(LoanApplication, pk=pk)
        if application.status in LoanApplication.FINAL_STATUSES:
            return Response(
                {"detail": "This application has already been decided."}, status=400
            )
        outcome = request.data.get("outcome")
        valid = {
            "approved": LoanApplication.APPROVED,
            "declined": LoanApplication.DECLINED,
            "under_review": LoanApplication.UNDER_REVIEW,
        }
        if outcome not in valid:
            return Response(
                {"outcome": "Must be one of: approved, declined, under_review."}, status=400
            )
        application.status = valid[outcome]
        application.decision_notes = (request.data.get("notes") or "").strip()
        # Only a terminal decision records the reviewer/timestamp; moving to
        # under_review is a triage step, not a final call.
        if application.status in LoanApplication.FINAL_STATUSES:
            application.reviewed_by = request.user
            application.reviewed_at = timezone.now()
        application.save(
            update_fields=["status", "decision_notes", "reviewed_by", "reviewed_at"]
        )
        return Response(LoanApplicationSerializer(application).data)
