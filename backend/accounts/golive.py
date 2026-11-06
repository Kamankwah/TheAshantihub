"""May this business submit listings? (self-serve onboarding, phase 2.)

Answered from facts the owner supplies themselves: a confirmed email, a shop pin, a business type and accepted terms.
No staff decision is read. `kyc_status` keeps its own meaning (the Ghana Post address decision, promo and offer
eligibility); the two owners approved under the old rule - a KYC-verified business and the company owner - stay live
with no further checks, so nothing changes for the businesses already trading.
"""
from . import email_confirmation, location_capture
from .models import BusinessOwner

EMAIL_MISSING = "email_missing"
EMAIL_UNCONFIRMED = "email_unconfirmed"
NO_PIN = "no_pin"
NO_BUSINESS_KIND = "no_business_kind"
TERMS_MISSING = "terms_missing"

MESSAGES = {
    EMAIL_MISSING: "Add your email address so we can send you a link to confirm it.",
    EMAIL_UNCONFIRMED: "Open the link we emailed you to confirm your email address.",
    NO_PIN: "Share your shop's location so customers can find you.",
    NO_BUSINESS_KIND: "Choose whether you sell products or offer services.",
    TERMS_MISSING: "Read and accept the terms to finish registering.",
}


def blockers(owner):
    """The codes still stopping this business from submitting listings, in the order the owner should fix them.
    Empty means live."""
    if owner.is_company or owner.kyc_status == BusinessOwner.VERIFIED:
        return []
    profile = getattr(owner, "profile", None)
    found = []
    if not (owner.email or "").strip():
        found.append(EMAIL_MISSING)
    elif not email_confirmation.is_confirmed(owner):
        found.append(EMAIL_UNCONFIRMED)
    if not location_capture.has_pin(profile):
        found.append(NO_PIN)
    if not (profile and profile.business_kind):
        found.append(NO_BUSINESS_KIND)
    if not (profile and profile.terms_accepted_at):
        found.append(TERMS_MISSING)
    return found


def is_live(owner):
    return not blockers(owner)


def payload(owner):
    """The `go_live` object on the owner's `me` payload."""
    codes = blockers(owner)
    return {"live": not codes, "blockers": [{"code": code, "message": MESSAGES[code]} for code in codes]}
