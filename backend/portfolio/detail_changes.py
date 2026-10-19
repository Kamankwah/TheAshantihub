"""A business changes its owner's name, sign-in phone or email itself (plan 7F-C, ruling R3; spec §13 (xxxiv)).

Scouts can no longer change these three (Task 9); instead the business files a BusinessDetailChangeRequest here,
Operations assigns a scout who is not the business's registrar or account manager, the scout verifies it on site, and
two people approve it with the password (approval kind business.detail_change). This module holds the business's side:
`clean`, `request_change` and `withdraw`. It is not ledger-gated (it protects sign-in and identity), except that the
step-up code the view asks for is always required while the ledger is on.

The request row keeps the new value unmasked, because applying needs it. It never goes into a log line, a notice, an
approval title or an activity body: those carry the field name and `shown()` (contacts masked) only. A business cannot
verify its own request: nothing here moves a request past `requested` except withdrawing it."""
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.claims import mask_email
from accounts.models import BusinessOwner, Customer
from accounts.phones import filter_by_phone, mask_phone, normalize_gh_phone, phone_key
from activity.services import record
from notifications.services import notify_staff, notify_staff_role

from .models import BusinessDetailChangeRequest as Request

PROTECTED_FIELDS = ("full_name", "login_phone", "email")
LABELS = {"full_name": "name", "login_phone": "sign-in phone", "email": "email"}
NAME_MAX = 150
EMAIL_MAX = 254
REASON_MAX = 300
OPERATIONS_PERMISSION = "portfolio.manage"

UNKNOWN_FIELD = "Choose the name, sign-in phone or email."
MASKED = "That is a masked value; type the full one."
NO_CHANGE = "That is already your current value."
REASON_REQUIRED = "Say why you need the change."
NOT_CLAIMED = "Set up your sign-in first: this business's details are changed by Operations until then."
CHANGE_PENDING = "A change to this detail is already in progress. Withdraw it first to ask for a different one."
RECOVERY_PHONE = "That number is a recovery phone on another account — ask Support."
RECOVERY_EMAIL = "That email is a recovery email on another account — ask Support."
NOT_FOUND = "We couldn't find that request."
NOT_WITHDRAWABLE = "This request can no longer be withdrawn."


class DetailChangeError(Exception):
    """A refusal the view answers as {"detail", "code"} (and "field" for a value refused under its field)."""

    def __init__(self, message, code, status_code=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


def shown(field, value):
    """A value as it may be logged or shown to the business or Operations: contacts masked, a name as it is. Only the
    verifying scout (Task 7) and the apply step read the raw value."""
    if value in (None, ""):
        return value
    if field == "login_phone":
        return mask_phone(value)
    if field == "email":
        return mask_email(value)
    return value


def _clean_value(field, value):
    from .proposals import _Invalid, _text

    if field == "full_name":
        try:
            return _text(value, max_length=NAME_MAX, required=True)
        except _Invalid as exc:
            raise DetailChangeError(str(exc), "invalid")
    if field == "login_phone":
        try:
            return normalize_gh_phone("" if value is None else str(value))
        except ValueError as exc:
            raise DetailChangeError(str(exc), "invalid")
    text = ("" if value is None else str(value)).strip().lower()
    try:
        if not text or len(text) > EMAIL_MAX:
            raise DjangoValidationError("invalid")
        validate_email(text)
    except DjangoValidationError:
        raise DetailChangeError("Enter a valid email address.", "invalid")
    return text


def _unchanged(owner, field, value):
    current = getattr(owner, field) or ""
    if field == "login_phone":
        return bool(phone_key(current)) and phone_key(current) == phone_key(value)
    if field == "email":
        return current.strip().lower() == value
    return current.strip() == value


def _recovery_clash(field, value):
    """A verified recovery contact on a customer account is where that account's codes go (otp.identity.contacts), so
    it cannot become a business's sign-in contact as well."""
    if field == "login_phone":
        customers = Customer.objects.filter(secondary_phone_verified=True)
        return RECOVERY_PHONE if filter_by_phone(customers, "secondary_phone", value).exists() else None
    if field == "email":
        clash = Customer.objects.filter(secondary_email_verified=True, secondary_email__iexact=value).exists()
        return RECOVERY_EMAIL if clash else None
    return None


def clean(owner, field, value):
    """The value to store for `field`, or DetailChangeError (400). Names follow the scout form's 150-character rule,
    phones are stored +233..., emails lower-cased. Refused: a masked value, no change, a value another business, a
    staff member or a customer's recovery contact already uses."""
    if field not in PROTECTED_FIELDS:
        raise DetailChangeError(UNKNOWN_FIELD, "invalid_field")
    if any(mark in str(value or "") for mark in "*•"):
        raise DetailChangeError(MASKED, "invalid")
    cleaned = _clean_value(field, value)
    if _unchanged(owner, field, cleaned):
        raise DetailChangeError(NO_CHANGE, "no_change")
    from .proposals import contact_duplicate_errors

    errors = contact_duplicate_errors(owner, {field: cleaned})
    if errors.get(field):
        raise DetailChangeError(str(errors[field][0]), "taken")
    clash = _recovery_clash(field, cleaned)
    if clash:
        raise DetailChangeError(clash, "taken")
    return cleaned


def _reason(value):
    text = ("" if value is None else str(value)).strip()
    if not text:
        raise DetailChangeError(REASON_REQUIRED, "reason_required")
    from wallets.approval_kinds import mask_numbers

    # Staff read it on the request and the approval: a number typed into it is masked like any staff-facing text.
    return mask_numbers(text)[:REASON_MAX]


def _live(owner, field):
    return Request.objects.filter(business_owner=owner, field=field, status__in=Request.LIVE_STATUSES)


def request_change(owner, field, value, reason, http_request=None):
    """File the business's request. Call inside the view's transaction (after its step-up check). Raises
    DetailChangeError: 400 invalid / no_change / taken / reason_required, 409 not_claimed / change_pending."""
    owner = BusinessOwner.objects.select_for_update().get(pk=owner.pk)  # one request at a time per business
    if owner.needs_claim:
        raise DetailChangeError(NOT_CLAIMED, "not_claimed", status_code=409)
    if field in PROTECTED_FIELDS and _live(owner, field).exists():
        raise DetailChangeError(CHANGE_PENDING, "change_pending", status_code=409)
    new_value = clean(owner, field, value)
    reason = _reason(reason)
    try:
        with transaction.atomic():
            change = Request.objects.create(business_owner=owner, field=field, new_value=new_value, reason=reason)
    except IntegrityError:  # the one-live-request constraint, should two requests race past the check
        raise DetailChangeError(CHANGE_PENDING, "change_pending", status_code=409)
    label = LABELS[field]
    notify_staff_role(
        OPERATIONS_PERMISSION, "detail_change_requested", f"{owner.display_name} asked to change its {label}"[:200],
        body="Assign a scout who is not its registrar or account manager to verify it on site.",
        link="detail-changes", icon="🪪",
    )
    # Last: record() holds the activity chain lock until commit.
    record(
        owner, "business.detail_change_requested", target=owner,
        summary=f"Asked to change the business's {label}; waiting for a scout to verify it",
        after={"request_id": change.pk, "field": field, "new_value": shown(field, new_value)},
        request=http_request,
    )
    return change


def withdraw(owner, request_id, http_request=None):
    """The business withdraws its own request before a scout has verified it. 404 not_found (another business's or
    unknown), 409 not_withdrawable (verified or ended)."""
    change = (
        Request.objects.select_for_update().filter(pk=request_id, business_owner_id=owner.pk).first()
        if str(request_id).isdigit() else None
    )
    if change is None:
        raise DetailChangeError(NOT_FOUND, "not_found", status_code=404)
    if change.status not in Request.WITHDRAWABLE_STATUSES:
        raise DetailChangeError(NOT_WITHDRAWABLE, "not_withdrawable", status_code=409)
    change.status = Request.WITHDRAWN
    change.decided_at = timezone.now()
    change.save(update_fields=["status", "decided_at"])
    label = LABELS[change.field]
    if change.assigned_scout_id:
        notify_staff(
            change.assigned_scout, "detail_change_withdrawn",
            f"{owner.display_name} withdrew its {label} change request"[:200],
            body="No visit is needed for it any more.", link="detail-changes", icon="🪪",
        )
    record(
        owner, "business.detail_change_withdrawn", target=owner,
        summary=f"Withdrew the request to change the business's {label}",
        after={"request_id": change.pk, "field": change.field},
        request=http_request,
    )
    return change


def row(change):
    """What the business sees of one request: the new value masked (a name in full), and the assigned scout's first
    name only once one is assigned."""
    scout = change.assigned_scout if change.status != Request.REQUESTED else None
    return {
        "id": change.pk,
        "field": change.field,
        "field_label": change.get_field_display(),
        "new_value": shown(change.field, change.new_value),
        "reason": change.reason,
        "status": change.status,
        "status_label": change.get_status_display(),
        "requested_at": change.requested_at,
        "assigned_scout_first_name": (scout.full_name.split() or [""])[0] if scout is not None else None,
        "verified_at": change.verified_at,
        "decided_at": change.decided_at,
        "can_withdraw": change.status in Request.WITHDRAWABLE_STATUSES,
    }
