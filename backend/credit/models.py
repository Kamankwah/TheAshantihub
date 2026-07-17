from django.db import models

from accounts.models import BusinessOwner, StaffUser

# Score bounds, mirrored from scoring.py so the model's clamp doesn't have to
# import the scoring module (which imports models — avoids a cycle).
MIN_SCORE = 300
MAX_SCORE = 1000


class CreditScore(models.Model):
    """
    Stores the most recently computed credit score for a business owner.

    IMPORTANT: the number in `score` is produced by the NAIVE PLACEHOLDER
    formula in credit/scoring.py, not the real Phase-3 credit-scoring engine
    described in docs/PROJECT_SCOPE.md §6. It exists only so the CreditDashboard
    frontend stub has a real backend to call. Do not use this for any actual
    lending decision.

    `score` is the recomputed base; `manual_adjustment` is a staff override
    delta (punch-list item 16 — "manage credit score") that is NOT recomputed,
    so a staffer's correction survives the next compute-on-read. The number
    that actually counts is `effective_score` (base + adjustment, clamped).
    """

    business_owner = models.OneToOneField(
        BusinessOwner, on_delete=models.CASCADE, related_name="credit_score"
    )
    score = models.PositiveIntegerField(default=MIN_SCORE)
    factors = models.JSONField(default=dict, blank=True)

    # Staff manual adjustment (item 16). Signed — staff can nudge up or down.
    # Persisted across recomputes; only the base `score` is recomputed on read.
    manual_adjustment = models.IntegerField(default=0)
    adjustment_reason = models.CharField(max_length=500, blank=True)
    adjusted_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="adjusted_credit_scores",
    )
    adjusted_at = models.DateTimeField(null=True, blank=True)

    computed_at = models.DateTimeField(auto_now=True)

    @property
    def effective_score(self):
        return max(MIN_SCORE, min(MAX_SCORE, self.score + self.manual_adjustment))

    def __str__(self):
        return f"CreditScore({self.business_owner_id}) = {self.effective_score}"


class LendingPartner(models.Model):
    """A lending institution that has agreed to lend to businesses on the
    platform (punch-list item 16 — "upload lending partners after they have
    approved to lend"). Replaces the hardcoded frontend LENDING_PARTNERS list
    (frontend/components/dashboard/theme.js). Business owners see only active
    partners; staff manage the full list.

    Fields mirror the shape the business CreditPanel already renders, so
    wiring it to this endpoint needs no UI redesign. `logo` is an emoji (the
    existing partners are emoji-based); a real image-logo upload is a possible
    future extension, deliberately kept out of scope here to avoid a multipart
    CRUD path for a launch-day feature.
    """

    BANK = "bank"
    MICROFINANCE = "microfinance"
    NGO = "ngo"
    GOVERNMENT = "government"
    OTHER = "other"
    TYPE_CHOICES = [
        (BANK, "Bank"),
        (MICROFINANCE, "Microfinance"),
        (NGO, "NGO Lender"),
        (GOVERNMENT, "Government Grant"),
        (OTHER, "Other"),
    ]

    name = models.CharField(max_length=150)
    partner_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=BANK)
    logo = models.CharField(max_length=8, blank=True)  # emoji
    color = models.CharField(max_length=9, blank=True)  # hex, for the UI badge
    # min_score a borrower needs before this partner is matched to them. Uses
    # the same 300–1000 scale as CreditScore.effective_score.
    min_score = models.PositiveIntegerField(default=MIN_SCORE)
    # Free-text so a partner can express a range/units the way they market it
    # ("GHS 50,000", "18–24% p.a.", "3–5 days") — not modelled as numbers,
    # matching how the frontend directory always displayed them.
    max_loan = models.CharField(max_length=50, blank=True)
    interest_rate = models.CharField(max_length=50, blank=True)
    turnaround = models.CharField(max_length=50, blank=True)
    focus = models.CharField(max_length=150, blank=True)
    contact = models.CharField(max_length=100, blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["min_score", "name"]

    def __str__(self):
        return self.name


class LoanApplication(models.Model):
    """A business owner's loan enquiry against a lending partner (punch-list
    item 16 / business item 6). Replaces the CreditPanel's pure-mock submit
    (which was `setLoanSubmitted(true)` with no network call at all), so an
    application actually persists and staff can see it.

    `score_at_application` snapshots the borrower's effective score at submit
    time — the score recomputes continuously, so the figure the decision was
    based on has to be frozen or it drifts out from under the record.
    """

    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    DECLINED = "declined"
    STATUS_CHOICES = [
        (SUBMITTED, "Submitted"),
        (UNDER_REVIEW, "Under Review"),
        (APPROVED, "Approved"),
        (DECLINED, "Declined"),
    ]
    FINAL_STATUSES = (APPROVED, DECLINED)

    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="loan_applications"
    )
    # SET_NULL, not CASCADE: deleting a partner must not erase the borrower's
    # application history.
    lending_partner = models.ForeignKey(
        LendingPartner, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="loan_applications",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    purpose = models.CharField(max_length=500)
    score_at_application = models.PositiveIntegerField()

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=SUBMITTED)
    decision_notes = models.CharField(max_length=500, blank=True)
    reviewed_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_loan_applications",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Loan {self.amount} for {self.business_owner_id} ({self.status})"
