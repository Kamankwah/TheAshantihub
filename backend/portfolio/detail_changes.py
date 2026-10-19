"""A business changes its owner's name, sign-in phone or email itself (plan 7F-C, ruling R3; spec §13 (xxxiv)).

Scouts can no longer change these three (Task 9); instead the business files a BusinessDetailChangeRequest here,
Operations assigns a scout who is not the business's registrar or account manager, the scout verifies it on site, and
two people approve it with the password (approval kind business.detail_change). This module holds the business's side:
`clean`, `request_change` and `withdraw`. It is not ledger-gated (it protects sign-in and identity), except that the
step-up code the view asks for is always required while the ledger is on.

The request row keeps the new value unmasked, because applying needs it. It never goes into a log line, a notice, an
approval title or an activity body: those carry the field name and `shown()` (contacts masked) only. A business cannot
verify its own request: nothing here moves a request past `requested` except withdrawing it."""
import hmac
import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils import timezone

from datetime import timedelta

from accounts.claims import mask_email
from accounts.models import BusinessOwner, Customer
from accounts.phones import filter_by_phone, mask_phone, normalize_gh_phone, phone_key
from activity.services import record
from notifications.services import notify_business_owner, notify_staff, notify_staff_role

from .models import BusinessDetailChangeRequest as Request

PROTECTED_FIELDS = ("full_name", "login_phone", "email")
LABELS = {"full_name": "name", "login_phone": "sign-in phone", "email": "email"}
NAME_MAX = 150
EMAIL_MAX = 254
REASON_MAX = 300
OPERATIONS_PERMISSION = "portfolio.manage"

_EMAIL_IN_TEXT = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")

UNKNOWN_FIELD = "Choose the name, sign-in phone or email."
MASKED = "That is a masked value; type the full one."
NO_CHANGE = "That is already your current value."
REASON_REQUIRED = "Say why you need the change."
NOT_CLAIMED = "Set up your sign-in first: this business's details are changed by Operations until then."
CHANGE_PENDING = "A change to this detail is already in progress. Withdraw it first to ask for a different one."
RECOVERY_PHONE = "That number is a recovery phone on another account — ask Support."
RECOVERY_EMAIL = "That email is a recovery email on another account — ask Support."
# What the business itself is told for every "already used" refusal: one message and one code, so it cannot probe
# whether a number or email belongs to another business, a staff member or a customer. Staff (the approval's recheck)
# get the detailed reason through clean(..., detailed=True).
UNAVAILABLE = "That phone number or email cannot be used. Contact AshantiHub Support."
REASON_TOO_LONG = f"Keep the reason to {REASON_MAX} characters or fewer."
NOT_FOUND = "We couldn't find that request."
NOT_WITHDRAWABLE = "This request can no longer be withdrawn."
NOT_A_SCOUT = "That staff member is not an active scout who can verify businesses."
NOT_ASSIGNABLE = "This request is no longer waiting for a scout."
ALREADY_ASSIGNED_TO_THEM = "That scout is already assigned to this request."
NOT_WAITING_FOR_VISIT = "This request is no longer waiting for your visit."
OUTCOME_INVALID = "Say whether the change was verified or not verified."
NOTE_MIN, NOTE_MAX = 10, 500
NOTE_INVALID = f"Write {NOTE_MIN} to {NOTE_MAX} characters about what you checked on site."
NO_VISIT = "Check in at the business for this request first, then record what you found."
OUTSIDE_RADIUS = "Your visit was checked in too far from the business pin. Visit again and check in at the business."
NO_PIN = "The business has no map pin, so your visit can't be measured. Ask Operations to pin it first."

APPROVAL_KIND = "business.detail_change"  # registered by portfolio.approval_kinds (plan 7F-C Task 8)
SCOUT_PERMISSION = "scouts.verify"
VISIT_DUE = timedelta(hours=48)


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


def clean(owner, field, value, *, detailed=False):
    """The value to store for `field`, or DetailChangeError (400). Names follow the scout form's 150-character rule,
    phones are stored +233..., emails lower-cased. Refused: a masked value, no change, a value another business, a
    staff member or a customer's recovery contact already uses. Those last three answer one generic message (code
    "taken") unless `detailed` is set, which only a staff-side caller (the approval's recheck) may pass."""
    if field not in PROTECTED_FIELDS:
        raise DetailChangeError(UNKNOWN_FIELD, "invalid_field")
    if any(mark in str(value or "") for mark in "*•"):
        raise DetailChangeError(MASKED, "invalid")
    cleaned = _clean_value(field, value)
    if _unchanged(owner, field, cleaned):
        raise DetailChangeError(NO_CHANGE, "no_change")
    from .proposals import contact_duplicate_errors

    errors = contact_duplicate_errors(owner, {field: cleaned})
    reason = str(errors[field][0]) if errors.get(field) else _recovery_clash(field, cleaned)
    if reason:
        raise DetailChangeError(reason if detailed else UNAVAILABLE, "taken")
    return cleaned


def _reason(value):
    text = ("" if value is None else str(value)).strip()
    if not text:
        raise DetailChangeError(REASON_REQUIRED, "reason_required")
    if len(text) > REASON_MAX:
        raise DetailChangeError(REASON_TOO_LONG, "reason_too_long")
    from wallets.approval_kinds import mask_numbers

    # Staff read it on the request and the approval: a number or email typed into it is masked like any staff-facing
    # text. A very short email can mask a little longer than it was, so the column's limit is applied after masking.
    return mask_numbers(_EMAIL_IN_TEXT.sub(lambda match: mask_email(match.group()), text))[:REASON_MAX]


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
    _close_visit_tasks(change, cancelled=True)
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


# ── Operations assigns a scout; the scout verifies on site (plan 7F-C Task 7) ────────────────────────────────────


def _visit_tasks(change):
    from staff_tasks.models import Task

    return Task.objects.filter(
        source_type=Request._meta.label_lower, source_id=str(change.pk), status=Task.OPEN,
    )


def _close_visit_tasks(change, *, cancelled):
    """Close the open visit task(s) made for this request: cancelled when the visit is no longer needed (withdrawn,
    reassigned), done when the scout recorded the outcome."""
    from staff_tasks.models import Task

    # staff_tasks has no close service: this follows its own close door (staff_tasks.views._TaskStatusView), which
    # stamps done_at only on a task marked done.
    if cancelled:
        return _visit_tasks(change).update(status=Task.CANCELLED, done_at=None)
    return _visit_tasks(change).update(status=Task.DONE, done_at=timezone.now())


def _locked(request_id):
    if not str(request_id).isdigit():
        return None
    return Request.objects.select_for_update().select_related("business_owner").filter(pk=request_id).first()


def assign(staff, request_id, scout_id, http_request=None):
    """Operations (scouts.assign, checked by the view) assigns a scout to verify the request on site. The scout must be
    an active, unsuspended scout who holds scouts.verify, and must not be one who put the business's details forward
    (accounts.kyc.is_kyc_submitter: its registrar, account manager, address corrector, ...). A request still waiting
    for its visit can be reassigned; the first scout's task is cancelled and they are told. The scout gets a task due
    in 48 hours. Raises DetailChangeError: 404 not_found, 400 not_a_scout / kyc_submitter / already_assigned,
    409 not_assignable."""
    from accounts import kyc
    from accounts.permissions import staff_holding
    from staff_tasks.models import Task
    from staff_tasks.services import create_task

    change = _locked(request_id)
    if change is None:
        raise DetailChangeError(NOT_FOUND, "not_found", status_code=404)
    if change.status not in (Request.REQUESTED, Request.ASSIGNED):
        raise DetailChangeError(NOT_ASSIGNABLE, "not_assignable", status_code=409)
    scout = (
        staff_holding(SCOUT_PERMISSION).filter(pk=scout_id, role__name="scout").select_related("role").first()
        if str(scout_id).isdigit() else None
    )
    if scout is None:
        raise DetailChangeError(NOT_A_SCOUT, "not_a_scout")
    owner = change.business_owner
    if kyc.is_kyc_submitter(owner, scout):
        # The assign door's wording (accounts.views.ScoutAssignmentListCreateView).
        raise DetailChangeError(
            f"{scout.full_name} registered or manages this business — assign another scout.", "kyc_submitter",
        )
    previous = change.assigned_scout if change.status == Request.ASSIGNED else None
    if previous is not None and previous.pk == scout.pk:
        raise DetailChangeError(ALREADY_ASSIGNED_TO_THEM, "already_assigned")
    now = timezone.now()
    if previous is not None:
        _close_visit_tasks(change, cancelled=True)
    change.status = Request.ASSIGNED
    change.assigned_scout, change.assigned_by, change.assigned_at = scout, staff, now
    change.save(update_fields=["status", "assigned_scout", "assigned_by", "assigned_at"])
    label = LABELS[change.field]
    create_task(
        scout, f"Visit {owner.display_name} to verify its new {label}", now + VISIT_DUE,
        notes="Check in at the business for this request, confirm the change with the owner in person, then record "
              "whether it is verified.",
        source=change, created_by=staff, kind=Task.OPS_FOLLOW_UP, business=owner,
    )
    notify_staff(
        scout, "detail_change_assigned", f"Verify {owner.display_name}'s new {label} on site"[:200],
        body="Visit within 48 hours.", link="detail-changes", icon="🪪",
    )
    if previous is not None:
        notify_staff(
            previous, "detail_change_reassigned", f"{owner.display_name}'s {label} change went to another scout"[:200],
            body="No visit is needed from you for it.", link="detail-changes", icon="🪪",
        )
    record(
        staff, "business.detail_change_assigned", target=owner,
        summary=f"Assigned {scout.full_name} to verify the business's new {label} on site",
        after={"request_id": change.pk, "field": change.field, "scout_id": scout.pk,
               "previous_scout_id": previous.pk if previous is not None else None},
        request=http_request,
    )
    return change


def _note(value):
    text = ("" if value is None else str(value)).strip()
    if not NOTE_MIN <= len(text) <= NOTE_MAX:
        raise DetailChangeError(NOTE_INVALID, "note_invalid")
    from wallets.approval_kinds import mask_numbers

    # The note is staff-facing text kept for good (the request and the approval's maker note): a number or email the
    # scout types into it is masked as the business's reason is.
    return mask_numbers(_EMAIL_IN_TEXT.sub(lambda match: mask_email(match.group()), text))[:NOTE_MAX]


def _verifying_visit(change, scout):
    """The scout's visit for this request that proves they were there: done or still open (never abandoned), made
    since this assignment (a scout reassigned away and back cannot reuse a visit from the first time), and measured
    inside the radius of the business pin. 409 no_visit / outside_radius / no_pin otherwise."""
    from field.models import VisitCheckIn

    visits = list(
        VisitCheckIn.objects.filter(
            change_request=change, scout=scout, purpose=VisitCheckIn.CHANGE_VERIFICATION,
            status__in=(VisitCheckIn.DONE, VisitCheckIn.OPEN), checked_in_at__gte=change.assigned_at,
        ).order_by("-checked_in_at", "-id")
    )
    if not visits:
        raise DetailChangeError(NO_VISIT, "no_visit", status_code=409)
    for visit in visits:
        if visit.distance_m is not None and not visit.outside_radius:
            return visit
    if all(visit.distance_m is None for visit in visits):
        raise DetailChangeError(NO_PIN, "no_pin", status_code=409)
    raise DetailChangeError(OUTSIDE_RADIUS, "outside_radius", status_code=409)


def submit_for_approval(change, scout, note, http_request=None):
    """Stage the verified change for two people with the password (kind business.detail_change). The verifying scout
    is the maker, so approvals never lets them decide it, and accounts.kyc.is_kyc_submitter (Task 8 adds the kind)
    keeps them off the business's KYC too. The payload holds the raw value because applying needs it; the kind's
    public_payload masks it wherever it is shown or logged. Returns the approval, or None while the kind is not
    registered (before Task 8 lands), in which case the request stays verified and waiting."""
    from approvals.registry import get_kind
    from approvals.services import submit

    from .proposals import _owner_target_type

    if get_kind(APPROVAL_KIND) is None:
        return None
    owner = change.business_owner
    approval = submit(
        scout, APPROVAL_KIND, title=f"Change the {LABELS[change.field]} of {owner.display_name}",
        payload={
            "change_request_id": change.pk, "business_owner_id": owner.pk, "field": change.field,
            "new_value": change.new_value,
        },
        target_type=_owner_target_type(), target_id=str(owner.pk), target_label=owner.display_name,
        maker_note=note, request=http_request,
    )
    change.approval = approval
    change.save(update_fields=["approval"])
    return approval


def verify(scout, request_id, outcome, note, http_request=None):
    """The assigned scout records what they found on site. Requires their own change verification visit for this
    request, inside the radius. "verified" moves the request to verified and submits the approval with the scout as
    maker; "not_verified" ends it (the business files a new one) and tells the business and Operations.
    Raises DetailChangeError: 404 not_found (not theirs), 403 kyc_submitter, 409 not_waiting / no_visit /
    outside_radius / no_pin, 400 outcome_invalid / note_invalid."""
    from accounts import kyc

    change = _locked(request_id)
    if change is None or change.assigned_scout_id != scout.pk:
        raise DetailChangeError(NOT_FOUND, "not_found", status_code=404)
    if change.status != Request.ASSIGNED:
        raise DetailChangeError(NOT_WAITING_FOR_VISIT, "not_waiting", status_code=409)
    if outcome not in (Request.VERIFIED, Request.NOT_VERIFIED):
        raise DetailChangeError(OUTCOME_INVALID, "outcome_invalid")
    note = _note(note)
    owner = change.business_owner
    # Checked again: the scout may have become the business's account manager since they were assigned.
    if kyc.is_kyc_submitter(owner, scout):
        raise DetailChangeError(kyc.OWN_REGISTRATION, "kyc_submitter", status_code=403)
    visit = _verifying_visit(change, scout)
    now = timezone.now()
    label = LABELS[change.field]
    change.visit, change.verification_note = visit, note
    if outcome == Request.VERIFIED:
        change.status, change.verified_at = Request.VERIFIED, now
        change.save(update_fields=["status", "visit", "verification_note", "verified_at"])
        _close_visit_tasks(change, cancelled=False)
        approval = submit_for_approval(change, scout, note, http_request=http_request)
        notify_business_owner(
            owner, "detail_change_verified", f"A scout verified your {label} change",
            body="It now needs approval from AshantiHub before it takes effect.", link="detail-changes", icon="🪪",
        )
        record(
            scout, "business.detail_change_verified", target=owner,
            summary=f"Verified the business's new {label} on site",
            after={"request_id": change.pk, "field": change.field, "visit_id": visit.pk,
                   "approval_id": approval.pk if approval is not None else None},
            request=http_request,
        )
        return change
    change.status = Request.NOT_VERIFIED
    change.decided_at = now
    change.save(update_fields=["status", "visit", "verification_note", "decided_at"])
    _close_visit_tasks(change, cancelled=False)
    notify_business_owner(
        owner, "detail_change_not_verified", f"Your {label} change could not be verified",
        body="The scout could not confirm it on site, so nothing changed. You can file a new request.",
        link="detail-changes", icon="🪪",
    )
    notify_staff_role(
        OPERATIONS_PERMISSION, "detail_change_not_verified",
        f"{owner.display_name}'s {label} change was not verified on site"[:200],
        body=f"{scout.full_name} could not confirm it. The request has ended.", link="detail-changes", icon="🪪",
    )
    record(
        scout, "business.detail_change_not_verified", target=owner,
        summary=f"Could not verify the business's new {label} on site; the request ended",
        after={"request_id": change.pk, "field": change.field, "visit_id": visit.pk},
        request=http_request,
    )
    return change


def staff_row(change):
    """What Operations sees of one request: the new value masked as everywhere else (a name in full)."""
    scout = change.assigned_scout
    return {
        "id": change.pk,
        "business": {"id": change.business_owner_id, "name": change.business_owner.display_name},
        "field": change.field,
        "field_label": change.get_field_display(),
        "new_value": shown(change.field, change.new_value),
        "reason": change.reason,
        "status": change.status,
        "status_label": change.get_status_display(),
        "requested_at": change.requested_at,
        "assigned_scout": {"id": scout.pk, "name": scout.full_name} if scout is not None else None,
        "assigned_at": change.assigned_at,
        "verified_at": change.verified_at,
        "verification_note": change.verification_note,
        "visit_id": change.visit_id,
        "approval_id": change.approval_id,
        "decided_at": change.decided_at,
    }


def scout_row(change):
    """What the assigned scout sees: the field and the new value in full only while the visit is waiting (they verify it
    on the ground with the owner; masked once they have recorded the outcome), the current value masked, and where the
    business is."""
    from field.services import business_pin

    owner = change.business_owner
    profile = getattr(owner, "profile", None)
    zone = getattr(profile, "zone", None)
    pin = business_pin(owner)
    return {
        "id": change.pk,
        "business": {
            "id": owner.pk, "name": owner.display_name, "area": zone.name if zone else None,
            "has_pin": pin is not None,
        },
        "field": change.field,
        "field_label": change.get_field_display(),
        "current_value": shown(change.field, getattr(owner, change.field)),
        "new_value": change.new_value if change.status == Request.ASSIGNED else shown(change.field, change.new_value),
        "reason": change.reason,
        "status": change.status,
        "status_label": change.get_status_display(),
        "assigned_at": change.assigned_at,
        "due_at": change.assigned_at + VISIT_DUE if change.assigned_at else None,
        "verified_at": change.verified_at,
        "can_verify": change.status == Request.ASSIGNED,
    }


# ── The approval: two people with the password (plan 7F-C Task 8; kind registered by portfolio.approval_kinds) ────────
#
# Payload {change_request_id, business_owner_id, field, new_value}; the target is the owner. The maker is the verifying
# scout (submit_for_approval), so the engine never lets them decide it; apply also refuses anyone who verified the
# change on site (the assigned scout or the visit's scout) should they be among the deciders. Lock order inside the
# decision: the approval row, the target advisory lock (approvals.services), the owner row, then the request row (the
# same owner-then-request order request_change uses); record() last.

APPLIED_TITLE = "Your {label} was changed"
NOT_APPROVED_TITLE = "Your {label} change was not approved"
NOT_APPROVED_BODY = "Nothing changed. You can file a new request if you still need the change."
NOT_WAITING_FOR_APPROVAL = "This change request is no longer waiting for approval."
NOT_RECOGNISED = "That change is not recognised."
STALE = "This detail changed since the request was approved on site. Reject this one; the business can ask again."
VERIFIER_DECIDES = "You verified this change on site, so someone else approves it."


def _refused(message, code, status_code=409):
    from approvals.services import ApprovalError

    error = ApprovalError(message)
    error.code, error.status_code = code, status_code
    return error


def _approval_owner(approval, *, lock=False):
    payload = approval.payload if isinstance(approval.payload, dict) else {}
    if payload.get("field") not in PROTECTED_FIELDS or str(payload.get("business_owner_id")) != str(approval.target_id):
        raise _refused(NOT_RECOGNISED, "bad_payload", 400)
    rows = BusinessOwner.objects.select_for_update() if lock else BusinessOwner.objects
    return rows.get(pk=payload["business_owner_id"])  # DoesNotExist: the engine answers "stale"


def _digest(owner, field):
    from wallets.holder_details import digest

    return digest(owner, field)


def approval_state(approval):
    """The owner's current value as the inbox may show it, and a keyed digest of the raw one: two phones or emails can
    mask alike, so the stale check compares the digest (wallets.holder_details does the same)."""
    owner = _approval_owner(approval)
    field = approval.payload["field"]
    return {"value": shown(field, getattr(owner, field)), "digest": _digest(owner, field)}


def _check(approval, owner, *, lock=False):
    """The request this approval decides, still verified and still pointing at this approval, and the value re-cleaned
    with the detailed staff-side reasons: another business, staff member or customer recovery contact may have taken
    it since (two live requests can name the same value). Raises ApprovalError with a code."""
    payload = approval.payload
    rows = Request.objects.select_for_update() if lock else Request.objects
    change = rows.filter(pk=payload.get("change_request_id"), business_owner_id=owner.pk).first()
    if change is None or change.field != payload["field"] or change.new_value != payload.get("new_value"):
        raise _refused(NOT_RECOGNISED, "bad_payload", 400)
    if change.status != Request.VERIFIED or (change.approval_id is not None and change.approval_id != approval.pk):
        raise _refused(NOT_WAITING_FOR_APPROVAL, "not_waiting")
    try:
        new_value = clean(owner, change.field, change.new_value, detailed=True)
    except DetailChangeError as exc:
        raise _refused(exc.message, exc.code, 400 if exc.code in ("invalid", "invalid_field") else 409)
    return change, new_value


def approval_validate(approval):
    _check(approval, _approval_owner(approval))


def _verifiers(change):
    people = {change.assigned_scout_id}
    if change.visit_id:
        people.add(change.visit.scout_id)
    return {pk for pk in people if pk}


def approval_apply(approval):
    """Write the new value, restart the payout cooling period, close the request as approved, show the owner the change
    (an AppliedChange row and a notice), tell the old phone or email, and record business.detail_changed last."""
    from otp import notices
    from otp.models import EMAIL, SMS
    from wallets.holder_details import restart_cooling

    from .models import AppliedChange

    owner = _approval_owner(approval, lock=True)
    change, new_value = _check(approval, owner, lock=True)  # again, on the locked rows
    deciders = {decision.staff_id for decision in approval.decisions.all()} | {approval.decided_by_id}
    if deciders & (_verifiers(change) | {approval.maker_id}):
        raise _refused(VERIFIER_DECIDES, "verified_it", 403)
    field = change.field
    if not hmac.compare_digest(str((approval.before or {}).get("digest") or ""), _digest(owner, field)):
        raise _refused(STALE, "stale")
    before = getattr(owner, field)
    setattr(owner, field, new_value)
    owner.save(update_fields=[field])
    now = timezone.now()
    cooling = restart_cooling(owner, now)  # every live payout destination waits payout_cooling_hours again
    change.status, change.decided_at = Request.APPROVED, now
    change.save(update_fields=["status", "decided_at"])
    label = LABELS[field]
    # The owner asked for it, so there is nothing to undo ("This wasn't me" is for a scout's change): undo_until is the
    # moment it applied, and the row is there so the change is never a surprise.
    AppliedChange.objects.create(
        approval=approval, business_owner=owner, kind=APPROVAL_KIND, summary=f"Changed your {label}",
        applied_at=now, undo_until=now, result={"request_id": change.pk, "field": field},
    )
    body = "AshantiHub approved the change you asked for."
    if cooling:
        body += " Your payout accounts wait the cooling period again before they can receive money."
    notify_business_owner(
        owner, "detail_change_approved", APPLIED_TITLE.format(label=label), body=body, link="detail-changes",
        icon="🪪",
    )
    channel = {"login_phone": SMS, "email": EMAIL}.get(field)
    if channel and before:
        # After commit, so the old contact never hears of a change that rolled back; the raw value stays in this
        # closure and the delivery path only.
        transaction.on_commit(lambda: notices.contact_changed(owner, channel, before, now=now))
    # Last: record() holds the activity chain lock until commit.
    record(
        approval.decided_by or approval.maker, "business.detail_changed", target=owner,
        summary=f"Changed the business's {label} after an on-site check and two people's approval",
        before={field: shown(field, before)},
        after={field: shown(field, new_value), "request_id": change.pk, "approval_id": approval.pk,
               "proposed_by": approval.maker_id, "destinations_cooling": cooling},
    )


def approval_closed(approval):
    """The approval was rejected (returned) or the maker cancelled it: the request ends as rejected and the business is
    told. There is nothing for the scout to fix and send again (a verified request cannot be re-verified), so no
    returned task is made; the business files a new request if it still needs the change."""
    change = (
        Request.objects.select_for_update().select_related("business_owner")
        .filter(approval_id=approval.pk, status=Request.VERIFIED).first()
    )
    if change is None:
        return
    change.status, change.decided_at = Request.REJECTED, timezone.now()
    change.save(update_fields=["status", "decided_at"])
    notify_business_owner(
        change.business_owner, "detail_change_rejected", NOT_APPROVED_TITLE.format(label=LABELS[change.field]),
        body=NOT_APPROVED_BODY, link="detail-changes", icon="🪪",
    )


def approval_diff(approval):
    payload = approval.payload if isinstance(approval.payload, dict) else {}
    field = payload.get("field")
    if field not in PROTECTED_FIELDS:
        return []
    owner = BusinessOwner.objects.filter(pk=payload.get("business_owner_id")).first()
    from approvals.models import ApprovalRequest

    if approval.status == ApprovalRequest.PENDING and owner is not None:
        before = shown(field, getattr(owner, field))
    else:
        before = (approval.before or {}).get("value")
    return [{"field": f"Owner's {LABELS[field]}", "before": before, "after": shown(field, payload.get("new_value"))}]


def approval_consequences(approval):
    field = (approval.payload or {}).get("field")
    label = LABELS.get(field, "detail")
    lines = [
        f"Changes the owner's {label} to the value a scout verified with the owner on site.",
        "The business's payout accounts cannot receive money again until the cooling period (payout_cooling_hours) "
        "has passed.",
        "The new value is checked again when you approve.",
    ]
    if field in ("login_phone", "email"):
        lines.insert(1, f"The business signs in with the new {label}; the old one is told of the change.")
    return lines


def approval_public_payload(approval):
    payload = dict(approval.payload)
    payload["new_value"] = shown(payload.get("field"), payload.get("new_value"))
    return payload


def approval_chain(approval):
    from approvals.models import ApprovalRequest

    return [(ApprovalRequest.POOL, None), (ApprovalRequest.SUPER_ADMIN, None)]
