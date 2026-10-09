"""Fraud cases (plan 2A Task 4, spec S9). raise_flag() opens a case — from
the system, an owner's "This wasn't me", or a person; confirm()/dismiss()
decide it, always with a note. ON_CONFIRMED hooks run inside the confirming
transaction, after the status change and any suspension (plan 2B appends the
commission reversal); a hook that raises undoes the whole confirmation.
Lock order when confirming: the case row, then the owner row; record() last."""
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.models import BusinessOwner
from activity.services import record
from notifications.services import notify_business_owner, notify_staff_role

from .models import FraudFlag

# callable(flag, staff) run after a case is confirmed, inside its transaction.
ON_CONFIRMED = []

NOTE_REQUIRED = "Write a note — confirming or dismissing always needs one."
ALREADY_DECIDED = "This case has already been decided."
CANNOT_SUSPEND = "This kind of case can't suspend a business."
NOT_YOUR_CASE = "A case about you is decided by someone else."
NOT_FOUND = "We couldn't find that case."
SUSPENDED_BODY = (
    "Your business has been suspended after an AshantiHub fraud check, so your listings and events are hidden. "
    "Please contact AshantiHub support."
)


class FraudError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def record_raised(flag, *, request=None):
    """Record fraud.flag_raised for `flag`. raise_flag() calls it unless told
    not to; a view that raises a case passes its request so the middleware
    doesn't add a second event. The actor is raised_by (None for the system
    and for an owner's objection)."""
    return record(
        flag.raised_by, "fraud.flag_raised", target=flag,
        after={
            "kind": flag.kind, "source": flag.source,
            "business_owner_id": flag.business_owner_id, "staff_subject_id": flag.staff_subject_id,
        },
        request=request,
    )


def raise_flag(kind, *, title, detail="", evidence=(), business_owner=None, related_business_owner=None,
               staff_subject=None, raised_by=None, source=FraudFlag.SYSTEM, dedupe_key="", record_event=True):
    """Open a case and tell every fraud.manage holder. With a dedupe_key, an
    open case under that key is returned instead of a new one."""
    if kind not in dict(FraudFlag.KIND_CHOICES):
        raise ValueError(f"Unknown fraud case kind: {kind}")
    dedupe_key = (dedupe_key or "")[:120]
    with transaction.atomic():
        if dedupe_key:
            existing = FraudFlag.objects.filter(dedupe_key=dedupe_key, status=FraudFlag.OPEN).first()
            if existing is not None:
                return existing
        try:
            with transaction.atomic():
                flag = FraudFlag.objects.create(
                    kind=kind, source=source, title=str(title)[:200], detail=detail or "",
                    evidence=[str(item)[:300] for item in evidence],
                    business_owner=business_owner, related_business_owner=related_business_owner,
                    staff_subject=staff_subject, raised_by=raised_by, dedupe_key=dedupe_key,
                )
        except IntegrityError:
            if not dedupe_key:
                raise
            # Raised at the same moment elsewhere: the partial unique constraint
            # kept the other one, so hand that one back.
            return FraudFlag.objects.get(dedupe_key=dedupe_key, status=FraudFlag.OPEN)
        notify_staff_role(
            "fraud.manage", "fraud_flag_raised", f"Fraud case: {flag.title}"[:200],
            body=flag.detail[:200], link="fraud-cases", icon="🚩",
        )
        if record_event:
            record_raised(flag)
    return flag


def open_flag_exists(business_owner, kind):
    return FraudFlag.objects.filter(business_owner=business_owner, kind=kind, status=FraudFlag.OPEN).exists()


def can_suspend(flag):
    """Whether confirming this case may also suspend its business (the
    "Suspend {business}" checkbox)."""
    return (
        flag.status == FraudFlag.OPEN
        and flag.kind in FraudFlag.SUSPENDABLE
        and flag.business_owner_id is not None
        and not flag.business_owner.is_suspended
    )


def _locked(flag_id):
    try:
        return FraudFlag.objects.select_for_update(of=("self",)).select_related("business_owner").get(pk=flag_id)
    except FraudFlag.DoesNotExist:
        raise FraudError(NOT_FOUND, status_code=404) from None


def _check_decidable(flag, staff, note):
    if flag.status != FraudFlag.OPEN:
        raise FraudError(ALREADY_DECIDED)
    if flag.staff_subject_id is not None and flag.staff_subject_id == staff.pk:
        raise FraudError(NOT_YOUR_CASE, status_code=403)
    if not note:
        raise FraudError(NOTE_REQUIRED)


def _resolve(flag, staff, status, note):
    flag.status = status
    flag.resolved_by = staff
    flag.resolved_at = timezone.now()
    flag.resolution_note = note
    flag.save(update_fields=["status", "resolved_by", "resolved_at", "resolution_note"])


def _suspend_owner(flag):
    """Suspend the case's business (hidden from public browse by
    listings.visibility.hidden_business_q) and tell the owner. An owner
    already suspended keeps their reason and isn't told twice."""
    owner = BusinessOwner.objects.select_for_update().get(pk=flag.business_owner_id)
    if owner.is_suspended:
        return False
    owner.is_suspended = True
    owner.suspension_reason = f"Confirmed fraud case: {flag.title}"[:500]
    owner.save(update_fields=["is_suspended", "suspension_reason"])
    notify_business_owner(owner, "account_suspended", "Your account has been suspended", body=SUSPENDED_BODY, icon="🚫")
    return True


def confirm(flag_id, staff, *, note, suspend=False, http_request=None):
    note = (note or "").strip()
    suspend = bool(suspend)
    with transaction.atomic():
        flag = _locked(flag_id)
        _check_decidable(flag, staff, note)
        if suspend and (flag.kind not in FraudFlag.SUSPENDABLE or flag.business_owner_id is None):
            raise FraudError(CANNOT_SUSPEND)
        _resolve(flag, staff, FraudFlag.CONFIRMED, note)
        if suspend:
            _suspend_owner(flag)
            # _suspend_owner saved its own copy of the owner; hooks see this one.
            flag.business_owner.refresh_from_db(fields=["is_suspended", "suspension_reason"])
        for hook in list(ON_CONFIRMED):
            hook(flag, staff)
        record(
            staff, "fraud.flag_confirmed", target=flag,
            after={"kind": flag.kind, "note": note, "suspend": suspend}, request=http_request,
        )
    return flag


def dismiss(flag_id, staff, *, note, http_request=None):
    note = (note or "").strip()
    with transaction.atomic():
        flag = _locked(flag_id)
        _check_decidable(flag, staff, note)
        _resolve(flag, staff, FraudFlag.DISMISSED, note)
        record(staff, "fraud.flag_dismissed", target=flag, after={"kind": flag.kind, "note": note}, request=http_request)
    return flag
