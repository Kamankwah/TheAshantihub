"""The approval kind `listing.staff_create` (staff-listing pipeline, plan M3, Task 7).

A listing staff drafted for a client goes live only after the owner confirmed it by the texted link
(`portfolio.confirmations`) AND a second person approved it: the kind is `two_people`, so not even a Super Admin's own
draft applies directly, and the engine never lets the maker decide. `submit_draft` is called when the owner confirms
(and again when the owner's KYC is approved, or by staff, if it could not submit then); `apply` publishes the listing,
or creates the (unpaid) event, through the same code a scout's proposal uses.

Nothing here carries the confirmation token, link or hash; phones appear masked.
"""
import logging

from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.phones import mask_phone
from approvals.services import ApprovalError, submit
from events.models import Event
from events.serializers import EventSubmitSerializer
from notifications.services import notify_business_owner

from . import proposals
from .models import ListingDraft

logger = logging.getLogger(__name__)

KEY = "listing.staff_create"
TARGET_TYPE = "portfolio.listingdraft"

NOT_CONFIRMED = "The owner hasn't confirmed this yet."
ALREADY_SUBMITTED = "This draft has already gone for approval."
NOT_SUBMITTED = "This draft isn't waiting for approval."
SUSPENDED = "This business is suspended."
ROLE_LABELS = {
    "scout": "Scout", "operations": "Operations", "super_admin": "Super Admin", "general_manager": "General Manager",
}
KIND_WORDS = {
    ListingDraft.PRODUCT: "product", ListingDraft.SERVICE: "service", ListingDraft.STAY: "stay",
    ListingDraft.EVENT: "event",
}
EVENT_LABELS = (
    ("name", "Name"), ("category", "Category"), ("zone", "Area"), ("description", "Description"),
    ("address", "Address"), ("event_date", "Date"), ("visibility_days", "Visible for (days)"),
    ("access_level", "Who can see it"), ("refund_until_days_before", "Refunds until (days before)"),
    ("lat", "Pin latitude"), ("lng", "Pin longitude"),
)
EVENT_KEYS = tuple(key for key, _ in EVENT_LABELS)


def _draft_of(approval):
    return ListingDraft.objects.select_related("business_owner__profile", "confirmation", "created_by__role").get(
        pk=approval.payload["draft_id"],
    )


def _listing_fields(payload):
    return {key: payload[key] for key in proposals.PROPOSED_LISTING_FIELDS if key in payload}


def _photos(payload):
    return payload.get("main_photo_id"), payload.get("photo_ids") or []


def _event_data(payload):
    serializer = EventSubmitSerializer(data={key: payload[key] for key in EVENT_KEYS if key in payload})
    if not serializer.is_valid():
        raise ApprovalError(proposals.first_message(serializer.errors))
    return dict(serializer.validated_data)


def check(draft, *, submitting):
    """Raise ApprovalError unless this draft may go to (submitting) or be approved from (not submitting) the queue:
    the owner confirmed it, the business is verified and not suspended, the subscription is live and within its limit,
    the photos are unused. Drafts are written without KYC, so this is where KYC is enforced."""
    if submitting and draft.status == ListingDraft.SUBMITTED:
        raise ApprovalError(ALREADY_SUBMITTED)
    if draft.status != (ListingDraft.OWNER_CONFIRMED if submitting else ListingDraft.SUBMITTED):
        raise ApprovalError(NOT_CONFIRMED if submitting else NOT_SUBMITTED)
    owner = draft.business_owner
    if owner.is_suspended:
        raise ApprovalError(SUSPENDED)
    if owner.kyc_status != BusinessOwner.VERIFIED:
        raise ApprovalError(proposals.KYC_FIRST)
    payload = draft.payload or {}
    if draft.kind == ListingDraft.EVENT:
        _event_data(payload)
        return
    _, errors = proposals.check_listing(owner, _listing_fields(payload))
    if not errors:
        errors = proposals.photo_errors(owner, proposals._listing_photo_ids(payload))
    if errors:
        raise ApprovalError(proposals.first_message(errors))


def submit_draft(draft):
    """Send an owner-confirmed draft to the approvals queue. The caller holds the owner and draft row locks. Raises
    ApprovalError (and writes nothing) when it cannot go yet."""
    check(draft, submitting=True)
    owner = draft.business_owner
    name = str((draft.payload or {}).get("name") or draft.kind)[:150]
    approval = submit(
        draft.created_by, KEY, title=f"New {KIND_WORDS[draft.kind]} for a client: {name} — {owner.display_name}",
        payload={"draft_id": draft.pk}, target_type=TARGET_TYPE, target_id=str(draft.pk),
        target_label=f"{name} — {owner.display_name}",
    )
    draft.status, draft.approval = ListingDraft.SUBMITTED, approval
    draft.save(update_fields=["status", "approval", "updated_at"])
    return approval


def try_submit_draft(draft):
    """submit_draft inside a savepoint: the approval, if any, or None with nothing left behind when the draft cannot go
    yet (owner KYC pending, subscription, photos…). It then stays owner_confirmed for `submit_waiting` or a retry."""
    try:
        with transaction.atomic():
            return submit_draft(draft)
    except ApprovalError:
        draft.refresh_from_db()
        return None


def submit_waiting(owner_id):
    """The owner's KYC was just approved: submit the drafts they had already confirmed. Runs after commit, so a failure
    here is logged and never undoes the KYC decision."""
    try:
        with transaction.atomic():
            BusinessOwner.objects.select_for_update().get(pk=owner_id)
            waiting = ListingDraft.objects.select_for_update(of=("self",)).filter(
                business_owner_id=owner_id, status=ListingDraft.OWNER_CONFIRMED,
            ).order_by("pk")
            for draft in waiting:
                try_submit_draft(draft)
    except Exception:
        logger.exception("Could not submit the confirmed drafts of business owner %s after KYC", owner_id)


def retry_submit(owner, draft_id):
    """Staff try again to send a confirmed draft that could not go. Returns the approval; raises ApprovalError with the
    reason when it still cannot."""
    with transaction.atomic():
        BusinessOwner.objects.select_for_update().get(pk=owner.pk)
        draft = ListingDraft.objects.select_for_update(of=("self",)).select_related("business_owner__profile").get(
            pk=draft_id, business_owner=owner,
        )
        return submit_draft(draft)


# --- the approval kind's callbacks ------------------------------------------------------------------------------------

def current_state(approval):
    # A missing draft (DoesNotExist) makes the engine answer "stale", and so does a KYC change or a suspension. The
    # draft's own status is not here: submitting moves it, and validate() checks it at approval.
    owner = BusinessOwner.objects.get(listing_drafts__pk=approval.payload["draft_id"])
    return {"kyc_status": owner.kyc_status, "suspended": owner.is_suspended}


def validate(approval):
    try:
        draft = _draft_of(approval)
    except ObjectDoesNotExist:
        raise ApprovalError(NOT_SUBMITTED)
    if draft.approval_id != approval.pk:
        raise ApprovalError(NOT_SUBMITTED)
    check(draft, submitting=False)


def apply(approval):
    """Publish. Lock order matches confirmations: the owner row, then the draft."""
    owner_id = ListingDraft.objects.values_list("business_owner_id", flat=True).get(pk=approval.payload["draft_id"])
    owner = BusinessOwner.objects.select_for_update(of=("self",)).select_related("profile").get(pk=owner_id)
    draft = ListingDraft.objects.select_for_update(of=("self",)).get(pk=approval.payload["draft_id"])
    if draft.status != ListingDraft.SUBMITTED or draft.approval_id != approval.pk:
        raise ApprovalError(NOT_SUBMITTED)
    payload = draft.payload or {}
    if draft.kind == ListingDraft.EVENT:
        now = timezone.now()
        event = Event.objects.create(
            **_event_data(payload), submitted_by_business=owner, status=Event.APPROVED,
            created_by_staff=approval.maker, approved_by=approval.decided_by, reviewed_by=approval.decided_by,
            reviewed_at=now,
        )
        notify_business_owner(
            owner, "event_approved", "Event approved",
            body=f"“{event.name}” was approved. Pay to publish it and open RSVPs.", link="/events", icon="✅",
        )
        return
    listing = proposals.publish_listing(
        owner, _listing_fields(payload), _photos(payload), maker=approval.maker, decided_by=approval.decided_by,
    )
    notify_business_owner(
        owner, "listing_approved", "Listing published", body=f"“{listing.name}” is now live on AshantiHub.",
        link="/business-dashboard", icon="✅",
    )


def reopen(approval):
    """The approval was returned or cancelled: the draft goes back to a draft the maker can edit and send again (the
    owner confirms what they will then see). Runs inside the decision's transaction."""
    draft = ListingDraft.objects.select_for_update(of=("self",)).filter(
        pk=approval.payload.get("draft_id"), status=ListingDraft.SUBMITTED, approval=approval,
    ).first()
    if draft is not None:
        draft.status, draft.confirmation = ListingDraft.DRAFT, None
        draft.save(update_fields=["status", "confirmation", "updated_at"])


def _who(staff):
    return f"{staff.full_name} ({ROLE_LABELS.get(staff.role.name, staff.role.name.replace('_', ' ').title())})"


def _day(moment):
    return f"{timezone.localtime(moment):%-d %b %Y}"


def render_diff(approval):
    try:
        draft = _draft_of(approval)
    except ObjectDoesNotExist:
        return [{"field": "Draft", "before": None, "after": approval.target_label}]
    payload = draft.payload or {}
    owner, link = draft.business_owner, draft.confirmation
    if link is not None and link.confirmed_at is not None:
        confirmed = _day(link.confirmed_at)
    else:
        confirmed = "no owner text was needed"
    rows = [
        {"field": "Business", "before": None, "after": owner.display_name},
        {"field": "Owner confirmed", "before": None, "after": confirmed},
    ]
    if link is not None and link.sent_to:
        # Masked, like every phone; the full number is behind the KYC review's "Show full phone number".
        rows.append({"field": "Text sent to", "before": None, "after": mask_phone(link.sent_to)})
    rows.append({"field": "Listed by", "before": None, "after": _who(draft.created_by)})
    if draft.kind == ListingDraft.EVENT:
        rows += [
            {"field": label, "before": None, "after": proposals._listing_shown(key, payload[key])}
            for key, label in EVENT_LABELS if key in payload
        ]
    else:
        rows += proposals.listing_rows(_listing_fields(payload), *_photos(payload))
    return rows


def consequences(approval):
    try:
        draft = _draft_of(approval)
    except ObjectDoesNotExist:
        return []
    if draft.kind == ListingDraft.EVENT:
        lines = ["The event is approved. The owner still pays for its visibility window before it is shown."]
    else:
        lines = ["The listing goes live now."]
    if draft.created_by.role.name == "scout":
        lines.append(f"It counts toward {draft.created_by.full_name.split(' ')[0]}'s listings today.")
    return lines
