"""
NAIVE PLACEHOLDER CREDIT SCORING.

This module is explicitly NOT the real Phase-3 credit-scoring engine described
in docs/PROJECT_SCOPE.md §6 ("AI/data-driven credit scoring"). That real engine
is separate, future, and out of scope for this stub. This formula exists only
to give the CreditDashboard frontend a real (if simplistic and cheap-to-compute)
backend to call instead of hardcoded mock data.

The score is derived purely from data already cheaply available on the
BusinessOwner/Listing models today: how many listings are published, how long
the account has existed, whether KYC is verified, and whether payout details
are verified. It intentionally does NOT use ratings, reviews, response rate,
or payment history the way the frontend's old SCORE_FACTORS mock implied,
because AshantiHub does not yet collect that data anywhere in the backend.

DO NOT use this output for any real lending/underwriting decision.
"""
from django.utils import timezone

from accounts.models import BusinessOwner
from listings.models import Listing

MIN_SCORE = 300
MAX_SCORE = 1000
LOAN_ELIGIBLE_THRESHOLD = 600

_WEIGHTS = {
    "listings_published": 0.25,
    "account_tenure": 0.20,
    "kyc_verified": 0.30,
    "payout_verified": 0.25,
}

_GRADE_BANDS = [
    (850, "A+", "Exceptional"),
    (800, "A", "Excellent"),
    (750, "A-", "Very Good"),
    (700, "B+", "Good"),
    (650, "B", "Above Average"),
    (600, "B-", "Average"),
    (550, "C+", "Below Average"),
    (500, "C", "Poor"),
]


def grade_for_score(score):
    for threshold, grade, label in _GRADE_BANDS:
        if score >= threshold:
            return grade, label
    return "D", "Very Poor"


def compute_naive_credit_score(business_owner: BusinessOwner):
    """Return (score, factors_dict) for `business_owner`."""
    published_listings = business_owner.listings.filter(status=Listing.PUBLISHED).count()
    account_age_days = max((timezone.now() - business_owner.created_at).days, 0)
    account_age_months = account_age_days / 30
    kyc_verified = business_owner.kyc_status == BusinessOwner.VERIFIED
    profile = getattr(business_owner, "profile", None)
    payout_verified = bool(profile and profile.payout_verification_status == "verified")

    listings_pct = min(published_listings, 10) / 10 * 100
    tenure_pct = min(account_age_months, 24) / 24 * 100
    kyc_pct = 100.0 if kyc_verified else 0.0
    payout_pct = 100.0 if payout_verified else 0.0

    weighted_pct = (
        listings_pct * _WEIGHTS["listings_published"]
        + tenure_pct * _WEIGHTS["account_tenure"]
        + kyc_pct * _WEIGHTS["kyc_verified"]
        + payout_pct * _WEIGHTS["payout_verified"]
    )
    score = round(MIN_SCORE + (weighted_pct / 100) * (MAX_SCORE - MIN_SCORE))

    factors = {
        "listings_published": {
            "value": published_listings, "score_pct": round(listings_pct, 1),
            "weight": _WEIGHTS["listings_published"],
        },
        "account_tenure_months": {
            "value": round(account_age_months, 1), "score_pct": round(tenure_pct, 1),
            "weight": _WEIGHTS["account_tenure"],
        },
        "kyc_verified": {
            "value": kyc_verified, "score_pct": kyc_pct, "weight": _WEIGHTS["kyc_verified"],
        },
        "payout_verified": {
            "value": payout_verified, "score_pct": payout_pct, "weight": _WEIGHTS["payout_verified"],
        },
    }
    return score, factors
