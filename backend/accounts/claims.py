"""Owner logins for businesses a scout registered (staff phase 2A, S2).

Two single-use ways in, stored only as SHA-256 hashes:
- a hand-over: 30 minutes, usable only from the staff session that started
  it, so the owner sets a password on the scout's phone;
- a claim link: emailed, 7 days, resendable — a newer link revokes the old.
Claiming sets the password, records consent (terms version, device, IP) and
revokes every other open token. The password is never returned, logged or put
in a notification; the activity event carries only the channel."""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from activity.services import client_ip, record
from notifications.services import notify_staff

from . import sessions
from .emails import send_business_claim_email
from .models import BusinessOwner, BusinessOwnerProfile, OwnerClaimToken, OwnerConsent, StaffUser
from .serializers import mask_but_last

HANDOVER_TTL = timedelta(minutes=30)
LINK_TTL = timedelta(days=7)
MIN_PASSWORD_LENGTH = 8

ALREADY_CLAIMED = "This owner already has a login."
NO_EMAIL = "Add the owner's email first — text messages (SMS) aren't connected yet."
USED = (
    "This link has already been used or replaced. Sign in with your phone number and password, "
    "or ask your account manager for a new link."
)
EXPIRED = "This link has expired. Ask your account manager to send a new one."
WRONG_DEVICE = "Finish the hand-over on the phone that started it."
INVALID = "This link isn't valid. Check you opened the whole link, or ask your account manager for a new one."
TERMS_REQUIRED = "Accept the Business Agreement to continue."
EMAIL_TAKEN = "That email already belongs to another account."


class ClaimError(Exception):
    def __init__(self, message, *, code="", status_code=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


def hash_token(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def mask_email(email):
    """gifty.a@example.com → gi•••@example.com."""
    local, _, domain = (email or "").partition("@")
    if not domain:
        return ""
    return f"{local[:2] if len(local) > 2 else local[:1]}•••@{domain}"


def claim_link(raw):
    return f"{settings.FRONTEND_BASE_URL}/business/claim?token={raw}"


def _issue(owner, channel, staff, ttl, *, session=None, sent_to=""):
    with transaction.atomic():
        locked = BusinessOwner.objects.select_for_update().get(pk=owner.pk)
        if not locked.needs_claim:
            raise ClaimError(ALREADY_CLAIMED, code="claimed")
        now = timezone.now()
        OwnerClaimToken.objects.filter(
            business_owner=locked, channel=channel, used_at__isnull=True, revoked_at__isnull=True,
        ).update(revoked_at=now)
        raw = secrets.token_urlsafe(32)
        token = OwnerClaimToken.objects.create(
            business_owner=locked, channel=channel, token_hash=hash_token(raw), created_by=staff,
            staff_session=session, sent_to=sent_to, expires_at=now + ttl,
        )
    return raw, token


def start_handover(owner, staff, session):
    """A 30-minute hand-over token bound to `staff` and their `session`.
    Returns (raw token, row); the raw token exists only in the response."""
    return _issue(owner, OwnerClaimToken.HANDOVER, staff, HANDOVER_TTL, session=session)


def send_claim_link(owner, staff):
    """Email a 7-day claim link (after commit). Replaces any earlier link."""
    if not owner.needs_claim:
        raise ClaimError(ALREADY_CLAIMED, code="claimed")
    if not owner.email:
        raise ClaimError(NO_EMAIL, code="no_email")
    raw, token = _issue(owner, OwnerClaimToken.LINK, staff, LINK_TTL, sent_to=owner.email)
    link = claim_link(raw)
    transaction.on_commit(lambda: send_business_claim_email(owner, link), robust=True)
    return token


def _find(raw, *, lock=False):
    raw = raw.strip() if isinstance(raw, str) else ""
    if not raw:
        raise ClaimError(INVALID, code="invalid")
    tokens = OwnerClaimToken.objects.select_related("business_owner")
    if lock:
        tokens = tokens.select_for_update(of=("self",))
    token = tokens.filter(token_hash=hash_token(raw)).first()
    if token is None:
        raise ClaimError(INVALID, code="invalid")
    return token


def _check_usable(token, request, now):
    if token.used_at is not None or token.revoked_at is not None or not token.business_owner.needs_claim:
        raise ClaimError(USED, code="used")
    if token.expires_at <= now:
        raise ClaimError(EXPIRED, code="expired")
    if token.channel == OwnerClaimToken.HANDOVER:
        user = getattr(request, "user", None)
        session = sessions.current(request)
        same_phone = (
            isinstance(user, StaffUser) and user.pk == token.created_by_id
            and session is not None and session.pk == token.staff_session_id
        )
        if not same_phone:
            raise ClaimError(WRONG_DEVICE, code="wrong_device", status_code=403)


def preview(raw, request):
    """What the owner sees before setting a password. The sign-in phone is
    masked: whoever holds a link may not be the owner yet."""
    token = _find(raw)
    _check_usable(token, request, timezone.now())
    owner = token.business_owner
    profile = BusinessOwnerProfile.objects.select_related("zone").filter(business_owner=owner).first()
    registered_by = owner.registered_by
    return {
        "business_name": owner.display_name,
        "owner_name": owner.full_name,
        "login_phone": mask_but_last(owner.login_phone, keep=3),
        "area": profile.zone.name if profile is not None and profile.zone is not None else "",
        "gps_address": (profile.gps_address or "") if profile is not None else "",
        "registered_by_name": registered_by.full_name if registered_by is not None else "",
        "registered_at": owner.created_at,
        "terms_version": settings.OWNER_TERMS_VERSION,
        "channel": token.channel,
        "expires_at": token.expires_at,
    }


def _clean_fields(owner, password, password_confirm, email, accept_terms):
    errors = {}
    if not accept_terms:
        errors["accept_terms"] = [TERMS_REQUIRED]
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        errors["password"] = ["Use at least 8 characters."]
    elif password != password_confirm:
        errors["password_confirm"] = ["The two passwords don't match."]
    email = email.strip() if isinstance(email, str) else ""
    if email:
        try:
            validate_email(email)
        except DjangoValidationError:
            errors["email"] = ["Enter a valid email address."]
        else:
            if BusinessOwner.objects.filter(email__iexact=email).exclude(pk=owner.pk).exists():
                errors["email"] = [EMAIL_TAKEN]
    if errors:
        raise serializers.ValidationError(errors)
    return email or None


def claim(raw, *, password, password_confirm, email, accept_terms, request):
    """Set the owner's password with a live token. Token problems raise
    ClaimError; form problems raise a DRF ValidationError with field errors
    and change nothing."""
    with transaction.atomic():
        now = timezone.now()
        token = _find(raw, lock=True)
        owner = BusinessOwner.objects.select_for_update().get(pk=token.business_owner_id)
        token.business_owner = owner
        _check_usable(token, request, now)
        email = _clean_fields(owner, password, password_confirm, email, accept_terms)

        owner.password_hash = make_password(password)
        owner.claimed_at = now
        update_fields = ["password_hash", "claimed_at"]
        if email and email != owner.email:
            owner.email = email
            update_fields.append("email")
        owner.save(update_fields=update_fields)
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(terms_accepted_at=now)
        token.used_at = now
        token.save(update_fields=["used_at"])
        OwnerClaimToken.objects.filter(
            business_owner=owner, used_at__isnull=True, revoked_at__isnull=True,
        ).update(revoked_at=now)

        django_request = getattr(request, "_request", request)
        OwnerConsent.objects.create(
            business_owner=owner,
            terms_version=settings.OWNER_TERMS_VERSION,
            accepted_at=now,
            channel=token.channel,
            staff=token.created_by,
            user_agent=django_request.META.get("HTTP_USER_AGENT", "")[:300],
            ip=client_ip(django_request),
        )
        if token.channel == OwnerClaimToken.LINK:
            # On a hand-over the scout is standing there; a link is claimed later.
            notify_staff(
                owner.account_manager, "business_claimed", f"{owner.full_name} set up their login",
                body=owner.display_name, link="portfolio", icon="🔑",
            )
        record(owner, "business.claimed", target=owner, after={"channel": token.channel}, request=request)
    return owner
