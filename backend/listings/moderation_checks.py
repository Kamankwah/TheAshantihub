"""Server-side checks shown beside a hero submission or a promotion in the
Marketing queues (canvas 14 and 16). They are computed here, never in the
browser, so the screen and the approve button cannot disagree.

Only two checks stop a decision: a caption that carries contact details (the
no-direct-contact rule: a business is never contacted directly, so a hero
caption must not hand a customer a way round AshantiHub) blocks hero approval,
and an open fraud case on the owner blocks promotion approval. Everything else
is advice for the person deciding.
"""
import os
import re
from datetime import timedelta

from django.utils import timezone

HERO_CAPTION_MAX = 140
PASS, WARN, FAIL = "pass", "warn", "fail"

CONTACT_DETAILS_MESSAGE = (
    "This caption carries contact details (a phone number, email address, web link or WhatsApp). "
    "Businesses are never contacted directly through AshantiHub, so reject it and ask the "
    "business to resubmit without them."
)

_EMAIL = re.compile(r"[\w.+-]+\s*(?:@|\[at\]|\(at\))\s*[\w-]+(?:\s*(?:\.|\[dot\]|\(dot\))\s*[\w-]+)+", re.I)
_URL = re.compile(
    r"(?:https?://|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|gh|me|app|shop|store|biz|info|ly|link)\b(?:/\S*)?",
    re.I,
)
_HANDLE = re.compile(r"\bwhats\s*-?\s*app\b|\bwa\.me\b|\bt\.me\b|\btelegram\b|\bsignal\b", re.I)
_PHONE_RUN = re.compile(r"(?:\+|00)?\d(?:[\s().-]?\d){6,}")


def contact_details_in(text):
    """The kind of contact detail found in `text` ('phone', 'email', 'link',
    'whatsapp') or None. Deliberately strict: a hero caption has no good reason
    to hold a digit string of seven or more, so false alarms cost one edit."""
    value = text or ""
    if _EMAIL.search(value):
        return "email"
    if _HANDLE.search(value):
        return "whatsapp"
    if _URL.search(value):
        return "link"
    if _PHONE_RUN.search(value):
        return "phone"
    return None


def _check(key, label, status, detail, blocking=False):
    return {"key": key, "label": label, "status": status, "detail": detail, "blocking": blocking}


def _stem(path):
    name = os.path.splitext(os.path.basename(path or ""))[0]
    # Django appends _AbCd123 when a copy collides with an existing file name.
    return re.sub(r"_[A-Za-z0-9]{7}$", "", name)


def _photo_check(submission):
    listing = submission.listing
    if listing is None:
        return _check("photo", "Photo is from this listing", FAIL, "The listing this was submitted for no longer exists.")
    stems = {_stem(p.image.name) for p in listing.photos.all() if p.image}
    if _stem(submission.media.name) in stems:
        return _check("photo", "Photo is from this listing", PASS, f"Matches a photo on “{listing.name}”.")
    return _check("photo", "Photo is from this listing", WARN, f"No photo on “{listing.name}” matches this file.")


def _kyc_check(owner):
    if owner.kyc_status == owner.VERIFIED:
        return _check("kyc", "Business verified (KYC)", PASS, "Identity checks are complete.")
    return _check("kyc", "Business verified (KYC)", FAIL, f"KYC is {owner.kyc_status}.")


def _subscription_check(owner):
    from billing.clock import ACTIVE, NONE, OVERDUE, PAUSED, TRIAL, subscription_state

    subscription = getattr(owner, "subscription", None)
    state = subscription_state(subscription)
    end = (state.get("current_period_end") or "")[:10]
    if state["state"] == ACTIVE:
        return _check("subscription", "Subscription paid", PASS, f"Paid through {end}." if end else "Paid.")
    if state["state"] == TRIAL:
        return _check("subscription", "Subscription paid", WARN, f"On a free trial until {end}." if end else "On a free trial.")
    if state["state"] in (OVERDUE, PAUSED):
        return _check("subscription", "Subscription paid", FAIL, f"Overdue since {(state.get('overdue_since') or '')[:10]}.")
    assert state["state"] == NONE
    return _check("subscription", "Subscription paid", FAIL, "No subscription.")


def hero_checks(submission):
    """The canvas 14 checklist for one submission. `blocking` marks a failed
    check that HeroApproveView refuses on."""
    from .models import HeroMediaSubmission

    owner = submission.business_owner
    if owner is None:  # a slide Marketing made itself is never checked
        return []
    now = timezone.now()
    caption = submission.caption or ""
    dated = submission.starts_at is not None  # a slide with its own dates (free slider)
    checks = [_kyc_check(owner), _subscription_check(owner)]
    if not dated:
        checks.insert(0, _photo_check(submission))

    length = len(caption)
    checks.append(_check(
        "caption_length", f"Caption within {HERO_CAPTION_MAX} characters",
        PASS if length <= HERO_CAPTION_MAX else FAIL, f"{length} of {HERO_CAPTION_MAX} characters.",
    ))

    found = contact_details_in(caption) or contact_details_in(submission.title)
    checks.append(_check(
        "contact_details", "No contact details in the caption",
        FAIL if found else PASS,
        CONTACT_DETAILS_MESSAGE if found else "No phone number, email, link or WhatsApp found.",
        blocking=bool(found),
    ))

    if dated:  # the free slider has no per-plan slot limit
        return checks

    from .views import _hero_slots_for

    slots = _hero_slots_for(owner)
    live = (
        HeroMediaSubmission.objects.filter(business_owner=owner, status=HeroMediaSubmission.APPROVED, expires_at__gt=now, starts_at__isnull=True)
        .exclude(pk=submission.pk).count()
    )
    word = "slot" if slots == 1 else "slots"
    checks.append(_check(
        "hero_slots", "Hero slot available on their plan",
        PASS if live < slots else FAIL, f"{live} of {slots} hero {word} in use.",
    ))
    return checks


def blocking_failures(checks):
    return [c for c in checks if c["blocking"] and c["status"] == FAIL]


def promotion_checks(promotion):
    """The canvas 16 check line: verified business, subscription paid, listing live."""
    from .models import Listing

    listing = promotion.listing
    owner = listing.business_owner
    live = listing.status == Listing.PUBLISHED and not owner.is_suspended
    return [
        _kyc_check(owner),
        _subscription_check(owner),
        _check(
            "listing_live", "Listing live",
            PASS if live else FAIL,
            "Published and visible." if live else ("The business is suspended." if owner.is_suspended else f"Listing is {listing.status}."),
        ),
    ]


def open_fraud_flag(owner_id, cache=None):
    """The newest open FraudFlag on a business, or None. `cache` is an optional
    {owner_id: flag} built by open_fraud_flags() so a list costs one query."""
    if cache is not None:
        return cache.get(owner_id)
    from fraud.models import FraudFlag

    return (
        FraudFlag.objects.filter(business_owner_id=owner_id, status=FraudFlag.OPEN)
        .select_related("raised_by", "business_owner__account_manager").order_by("-created_at").first()
    )


def open_fraud_flags(owner_ids):
    from fraud.models import FraudFlag

    flags = (
        FraudFlag.objects.filter(business_owner_id__in=list(owner_ids), status=FraudFlag.OPEN)
        .select_related("raised_by", "business_owner__account_manager").order_by("created_at")
    )
    return {flag.business_owner_id: flag for flag in flags}  # newest wins


def case_owner_name(flag):
    """Who is looking after the case: the business's account manager, else the
    person who raised it. None when neither is known (a system case)."""
    manager = flag.business_owner.account_manager if flag.business_owner_id else None
    if manager is not None:
        return manager.full_name
    return flag.raised_by.full_name if flag.raised_by_id else None


def fraud_hold(flag):
    if flag is None:
        return None
    return {"case_id": flag.pk, "title": flag.title, "case_owner_name": case_owner_name(flag)}


def fraud_hold_message(flag):
    who = case_owner_name(flag)
    base = "This business has an open fraud case, so its promotion cannot be approved yet."
    return f"{base} Case owner: {who}." if who else f"{base} The case has no owner yet."


def days_left(promotion, now=None):
    """Whole days still to run for an active promotion; None otherwise."""
    from .models import Promotion

    now = now or timezone.now()
    if promotion.status != Promotion.ACTIVE or promotion.ends_at < now:
        return None
    seconds = (promotion.ends_at - now).total_seconds()
    return int(-(-seconds // timedelta(days=1).total_seconds()))
