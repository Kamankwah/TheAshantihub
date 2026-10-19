"""wallets.holder_details_edit (wallet rulings 7C, Task 5; spec §13 (xxxiv)): while the ledger is on, staff cannot change
what a payout is matched against, or where a holder's codes go, alone. The staff doors (PATCH accounts/customers/<id>/ and
business-owners/<id>/) no longer write a changed name or contact: they submit this request, which another holder of
users.manage, then a Super Admin, approves with the password again. It is a two_people kind, so not even a Super Admin's
own request applies at once.

Payload {holder_type, holder_id, field, attribute, new_value}: `field` is "payout_name" (the name a destination's account
name is matched to), "recovery_contact" (the phone or email a code is sent to) or "staff_name" (a third-party rider's
staff name); `attribute` is the model column it writes. Approving writes the change, restarts the cooling period
(payout_cooling_hours) on the holder's live payout destinations exactly as a new destination waits, and records the
activity event with contacts masked. A holder's own edits are untouched (they have their own step-up and cooling). With
the ledger off the doors write directly, as before. The new value is validated by the same serializer the direct edit
used, at request and again at approval; an unchanged value is refused (400 no_change). The request payload keeps the new
value unmasked, because applying needs it; the request title, notes, diff and activity event never do."""
from datetime import timedelta

from django.utils import timezone

from accounts.claims import mask_email
from accounts.models import BusinessOwner, Customer, StaffUser
from accounts.phones import mask_phone
from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from ledger import escrow, settings_store
from otp.identity import ACCOUNT_MODELS, ref

from .approval_kinds import Refused
from .models import PayoutDestination

KEY = "wallets.holder_details_edit"
MANAGE = "users.manage"
PAYOUT_NAME, RECOVERY_CONTACT, STAFF_NAME = "payout_name", "recovery_contact", "staff_name"
# holder_type -> {model column: field}
COLUMNS = {
    "customer": {"full_name": PAYOUT_NAME, "phone": RECOVERY_CONTACT, "email": RECOVERY_CONTACT},
    "business_owner": {"full_name": PAYOUT_NAME, "login_phone": RECOVERY_CONTACT, "email": RECOVERY_CONTACT},
    "staff": {"full_name": STAFF_NAME},
}
LABELS = {PAYOUT_NAME: "payout name", RECOVERY_CONTACT: "recovery contact", STAFF_NAME: "staff name"}
NAME_MAX = 150


def guarded():
    """Only while the ledger is on do these edits need a second person; off, the doors write as they always did."""
    return escrow.enabled()


def protected(holder, column):
    """The field a column of this holder belongs to, or None when staff may still edit it directly."""
    return COLUMNS.get(ref(holder)[0], {}).get(column)


def shown(column, value):
    """A value as it may be logged or displayed: contacts masked, names as they are."""
    if value in (None, ""):
        return value
    if column in ("phone", "login_phone"):
        return mask_phone(value)
    if column == "email":
        return mask_email(value)
    return value


def clean(holder, column, value):
    """The value the direct edit would have stored, or Refused (400) with its message."""
    if any(mark in str(value or "") for mark in "*•"):
        raise Refused("That is a masked value; type the full one.", "invalid", status_code=400)
    if ref(holder)[0] == "staff":
        text = str(value or "").strip()
        if not text or len(text) > NAME_MAX:
            raise Refused("Enter a name of up to 150 characters.", "invalid", status_code=400)
        return text
    from accounts.serializers import StaffBusinessOwnerDetailSerializer, StaffCustomerDetailSerializer

    serializer_class = StaffCustomerDetailSerializer if isinstance(holder, Customer) else StaffBusinessOwnerDetailSerializer
    serializer = serializer_class(holder, data={column: value}, partial=True)
    if not serializer.is_valid():
        errors = serializer.errors.get(column) or ["Enter a valid value."]
        raise Refused(str(errors[0]), "invalid", status_code=400)
    return serializer.validated_data[column]


def pending(holder, column):
    return ApprovalRequest.objects.filter(
        kind=KEY, target_type=holder._meta.label_lower, target_id=str(holder.pk), status=ApprovalRequest.PENDING,
        payload__attribute=column,
    ).exists()


def ask(maker, holder, column, value, request=None):
    """Submit the change for a second person. Raises Refused: 400 no_change / invalid, 409 change_pending."""
    from approvals import services as approvals

    field = protected(holder, column)
    if field is None:
        raise Refused("That detail is not covered by approval.", "not_protected", status_code=400)
    new_value = clean(holder, column, value)
    if (getattr(holder, column) or "") == (new_value or ""):
        raise Refused("That is already the current value.", "no_change", status_code=400)
    if pending(holder, column):
        raise Refused(
            f"A change to this {LABELS[field]} is already waiting for approval.", "change_pending", status_code=409,
        )
    holder_type, holder_id = ref(holder)
    return approvals.submit(
        maker, KEY, title=f"Change the {LABELS[field]} of {holder_type.replace('_', ' ')} #{holder_id}",
        payload={"holder_type": holder_type, "holder_id": holder_id, "field": field, "attribute": column, "new_value": new_value},
        target=holder, request=request,
    )


def divert(maker, holder, validated, request=None):
    """For a staff PATCH: take the protected, changed columns out of `validated` (in place) and submit each for approval.
    Returns the approvals. Protected columns whose value did not change are dropped silently. Raises Refused."""
    asked = []
    for column in [name for name in validated if protected(holder, name)]:
        value = validated.pop(column)
        if (getattr(holder, column) or "") != (value or ""):
            asked.append((column, value))
    return [ask(maker, holder, column, value, request=request) for column, value in asked]


def _holder(payload, lock=False):
    model = ACCOUNT_MODELS.get(payload.get("holder_type"))
    if model is None or payload.get("attribute") not in COLUMNS.get(payload.get("holder_type"), {}):
        raise Refused("That change is not recognised.", "bad_payload", status_code=400)
    rows = model.objects.select_for_update() if lock else model.objects
    return rows.get(pk=payload.get("holder_id"))  # DoesNotExist: the engine answers "stale"


def current_state(request):
    holder = _holder(request.payload)
    column = request.payload["attribute"]
    return {"value": shown(column, getattr(holder, column))}


def _check(request, holder):
    payload = request.payload
    column = payload["attribute"]
    if COLUMNS[payload["holder_type"]][column] != payload.get("field"):
        raise Refused("That change is not recognised.", "bad_payload", status_code=400)
    new_value = clean(holder, column, payload.get("new_value"))
    if (getattr(holder, column) or "") == (new_value or ""):
        raise Refused("That is already the current value. Nothing was changed.", "no_change", status_code=409)
    return column, new_value


def validate(request):
    _check(request, _holder(request.payload))


def restart_cooling(holder, now):
    """A changed name or contact waits as a new destination does: every live destination is unusable until
    payout_cooling_hours from now (never shortened)."""
    holder_type, holder_id = ref(holder)
    until = now + timedelta(hours=settings_store.current("payout_cooling_hours", now))
    return PayoutDestination.objects.filter(
        holder_type=holder_type, holder_id=holder_id, removed_at__isnull=True, usable_from__lt=until,
    ).update(usable_from=until)


def apply(request):
    holder = _holder(request.payload, lock=True)
    people = [request.maker] + [decision.staff for decision in request.decisions.select_related("staff")]
    if isinstance(holder, StaffUser) and any(person is not None and person.pk == holder.pk for person in people):
        raise Refused("You cannot change your own staff name. Ask another member of staff.", "own_details", status_code=403)
    column, new_value = _check(request, holder)  # again, on the locked row
    before = getattr(holder, column)
    setattr(holder, column, new_value)
    holder.save(update_fields=[column])
    now = timezone.now()
    restarted = restart_cooling(holder, now)
    field = request.payload["field"]
    decider = request.decided_by or request.maker
    # Last: record() holds the activity chain lock until commit.
    record(
        decider, "wallets.holder_details_changed", target=holder,
        summary=f"Changed the {LABELS[field]} of {request.payload['holder_type'].replace('_', ' ')} #{holder.pk} by two people; "
                f"payout destinations wait again",
        before={column: shown(column, before)},
        after={column: shown(column, new_value), "approval_id": request.pk, "proposed_by": request.maker_id,
               "destinations_cooling": restarted},
    )


def render_diff(request):
    try:
        holder = _holder(request.payload)
    except (Refused, KeyError, Customer.DoesNotExist, BusinessOwner.DoesNotExist, StaffUser.DoesNotExist):
        return []
    column = request.payload.get("attribute")
    return [{
        "field": f"{LABELS.get(request.payload.get('field'), 'Detail')} ({column.replace('_', ' ')})",
        "before": shown(column, getattr(holder, column)) if request.status == ApprovalRequest.PENDING
        else (request.before or {}).get("value"),
        "after": shown(column, request.payload.get("new_value")),
    }]


def consequences(request):
    return [
        "Changes the detail on the account. Payout destinations cannot receive money again until the cooling period "
        "(payout_cooling_hours) has passed.",
        "The new value is checked again when you approve.",
    ]


def public_payload(request):
    payload = dict(request.payload)
    payload["new_value"] = shown(payload.get("attribute"), payload.get("new_value"))
    return payload


def chain(request):
    return [(ApprovalRequest.POOL, None), (ApprovalRequest.SUPER_ADMIN, None)]


HOLDER_DETAILS_EDIT = ApprovalKind(
    key=KEY, label="Change a holder's payout name or contact", pool_permission=MANAGE, current_state=current_state,
    apply=apply, response_hours=24, resolve_approver=chain, render_diff=render_diff, validate=validate,
    consequences=consequences, public_payload=public_payload, requires_sudo=True, two_people=True,
    chain_note="Another holder of users.manage, then a Super Admin; never the person who asked",
)
