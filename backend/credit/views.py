from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner

from .models import CreditScore
from .scoring import compute_naive_credit_score
from .serializers import CreditScoreSerializer, CreditScoreStaffListSerializer


class CreditScoreMeView(APIView):
    """Compute-on-read: recomputes the naive placeholder score for the
    current business owner on every GET, persisting the latest result to
    CreditScore. See credit/scoring.py for why this is not real underwriting.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        score, factors = compute_naive_credit_score(request.user)
        credit_score, _ = CreditScore.objects.update_or_create(
            business_owner=request.user,
            defaults={"score": score, "factors": factors},
        )
        return Response(CreditScoreSerializer(credit_score).data)


class CreditScoreStaffListView(APIView):
    """Staff-only aggregate view across every business owner's (naive,
    placeholder) credit score. Computed fresh on every request for
    simplicity — fine at this stub's expected scale.
    """

    def get_permissions(self):
        return [HasRolePermission("analytics.view")]

    def get(self, request):
        results = []
        for owner in BusinessOwner.objects.all().order_by("full_name"):
            score, factors = compute_naive_credit_score(owner)
            credit_score, _ = CreditScore.objects.update_or_create(
                business_owner=owner, defaults={"score": score, "factors": factors}
            )
            results.append(credit_score)
        serializer = CreditScoreStaffListSerializer(results, many=True)
        return Response(serializer.data)
