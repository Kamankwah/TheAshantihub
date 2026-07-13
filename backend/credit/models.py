from django.db import models

from accounts.models import BusinessOwner


class CreditScore(models.Model):
    """
    Stores the most recently computed credit score for a business owner.

    IMPORTANT: the number stored here is produced by the NAIVE PLACEHOLDER
    formula in credit/scoring.py, not the real Phase-3 credit-scoring engine
    described in docs/PROJECT_SCOPE.md §6. It exists only so the CreditDashboard
    frontend stub has a real backend to call. Do not use this for any actual
    lending decision.
    """

    business_owner = models.OneToOneField(
        BusinessOwner, on_delete=models.CASCADE, related_name="credit_score"
    )
    score = models.PositiveIntegerField(default=300)
    factors = models.JSONField(default=dict, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"CreditScore({self.business_owner_id}) = {self.score}"
