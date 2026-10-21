"""Staff draft listings for a client business (staff-listing pipeline, plan M3, Task 5).

Staff (a scout for a business they manage; Operations and Super Admin for any, see `accounts.permissions.can_stage_for`)
draft a product, service, stay or event for a client. A draft goes nowhere until it is sent to the owner, the owner
confirms by the texted link (`portfolio.confirmations`), and a second person approves it (Task 7). Nothing here
publishes anything.

The payload is the validated, normalised listing (only known fields; models as their ids, decimals as strings) so Task 7
can publish it through the same serializers. Photos follow the staged-photo pattern of `portfolio.proposals`.

Every write records its own activity event (record() last). Bodies and `after` dicts hold masked phones only, never a
token, a link or a whole number. A response carries `confirmations.state_of` and nothing else of the confirmation."""
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from accounts.claims import ClaimError
from accounts.models import BusinessOwner
from accounts.phones import mask_phone
from activity.services import record
from events.models import Event
from events.serializers import EventSubmitSerializer
from listings.models import Category

from . import confirmations, proposals
from .models import ListingDraft, OwnerConfirmation

LISTING_KINDS = (ListingDraft.PRODUCT, ListingDraft.SERVICE, ListingDraft.STAY)
EVENT_FIELDS = tuple(EventSubmitSerializer.Meta.fields)
EDITABLE = (ListingDraft.DRAFT, ListingDraft.AWAITING_OWNER)

BAD_KIND = "Choose what the draft is: product, service, stay or event."
WRONG_CATEGORY = {
    ListingDraft.PRODUCT: "Choose a product category.",
    ListingDraft.SERVICE: "Choose a service category that is not a stay.",
    ListingDraft.STAY: "Choose an accommodation category for a stay.",
}
PRICE_BAD = "Enter a price above zero."
UNITS_BAD = "Say how many rooms or units there are (at least 1)."
NO_IDS = "Choose at least one draft to send."


def _errors(**fields):
    return {name: [message] for name, message in fields.items()}


def _flat(value):
    return value.pk if hasattr(value, "pk") else value


def _amount(value):
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


# ── Validation, per kind ────────────────────────────────────────────────────

def _kind_errors(kind, raw, cleaned):
    category = cleaned["category"]
    stay = category.kind == Category.SERVICE and category.is_accommodation
    right = {
        ListingDraft.PRODUCT: category.kind == Category.PRODUCT,
        ListingDraft.SERVICE: category.kind == Category.SERVICE and not stay,
        ListingDraft.STAY: stay,
    }[kind]
    if not right:
        return _errors(category=WRONG_CATEGORY[kind])
    price = cleaned.get("price_amount")
    if price is not None and price <= 0:
        return _errors(price_amount=PRICE_BAD)
    if kind in (ListingDraft.PRODUCT, ListingDraft.STAY) and price is None:
        return _errors(price_amount=PRICE_BAD)
    if kind == ListingDraft.STAY and (raw.get("units_total") in (None, "") or (cleaned.get("units_total") or 0) < 1):
        return _errors(units_total=UNITS_BAD)
    return {}


def _listing_payload(owner, kind, data):
    listing = {key: data[key] for key in proposals.PROPOSED_LISTING_FIELDS if key in data}
    if listing.get("contact_phone") not in (None, ""):
        try:
            listing["contact_phone"] = proposals._phone(listing["contact_phone"])  # stored +233..., like a proposal
        except proposals._Invalid as exc:
            raise ValidationError({"contact_phone": [str(exc)]})
    main_id = proposals._one_photo_id(data.get("main_photo_id"), "main_photo_id")
    gallery = proposals._photo_id_list(data.get("photo_ids"), "photo_ids")
    every_photo = proposals._listing_photo_ids({"main_photo_id": main_id, "photo_ids": gallery})
    if len(every_photo) > proposals.MAX_PHOTOS:
        raise ValidationError({"photo_ids": [proposals.TOO_MANY_PHOTOS]})
    # KYC is not required to draft: a business registered for a client waits for KYC while its listings are drafted.
    cleaned, errors = proposals.check_listing(owner, listing, require_kyc=False)
    if not errors:
        errors = _kind_errors(kind, listing, cleaned)
    if not errors:
        errors = proposals.photo_errors(owner, every_photo)
    if errors:
        raise ValidationError(errors)
    payload = proposals.jsonable({key: _flat(value) for key, value in cleaned.items()})
    payload["main_photo_id"], payload["photo_ids"] = main_id, gallery
    return payload


def _event_payload(owner, data):
    serializer = EventSubmitSerializer(data={key: data[key] for key in EVENT_FIELDS if key in data})
    if not serializer.is_valid():
        raise ValidationError(dict(serializer.errors))
    cleaned = dict(serializer.validated_data)
    try:
        Event(**cleaned, submitted_by_business=owner).full_clean(exclude=["access_code"])
    except DjangoValidationError as exc:
        raise ValidationError(exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages})
    return proposals.jsonable({key: _flat(value) for key, value in cleaned.items()})


def clean_payload(owner, kind, data):
    """The normalised payload for a draft of `kind`, or a 400 ValidationError naming what is wrong."""
    if not isinstance(data, dict):
        raise ValidationError({"detail": ["Send the draft's details."]})
    if kind == ListingDraft.EVENT:
        return _event_payload(owner, data)
    return _listing_payload(owner, kind, data)


# ── What staff see ──────────────────────────────────────────────────────────

def draft_item(draft):
    state = confirmations.state_of(draft)
    payload = dict(draft.payload) if isinstance(draft.payload, dict) else {}
    if payload.get("contact_phone"):
        payload["contact_phone"] = mask_phone(payload["contact_phone"])  # phones leave the server masked
    return {
        "id": draft.pk, "kind": draft.kind, "name": str(payload.get("name") or "")[:150], "payload": payload,
        "status": state["state"], "created_by_name": draft.created_by.full_name,
        "created_at": draft.created_at, "updated_at": draft.updated_at, "confirmation": state,
    }


def registration_state(row):
    """The registration confirmation as staff see it: no token, hash or link, and a masked number."""
    lapsed = row.confirmed_at is None and row.expires_at < timezone.now()
    return {
        "state": "lapsed" if lapsed else "awaiting_owner",
        "sent_to_masked": mask_phone(row.sent_to) if row.sent_to else "",
        "expires_at": row.expires_at,
        "send_note": confirmations.SEND_NOTES[row.send_state],
    }


def list_drafts(owner):
    rows = ListingDraft.objects.filter(business_owner=owner).select_related("confirmation", "created_by")
    return [draft_item(draft) for draft in rows]


def _fresh(pks):
    rows = ListingDraft.objects.filter(pk__in=pks).select_related("confirmation", "created_by").order_by("pk")
    return [draft_item(draft) for draft in rows]


def get_draft(owner, pk):
    draft = ListingDraft.objects.select_related("confirmation", "created_by").filter(business_owner=owner, pk=pk).first()
    if draft is None:
        raise Http404
    return draft


# ── Writes ──────────────────────────────────────────────────────────────────

def _label(draft):
    return str((draft.payload or {}).get("name") or draft.kind)[:100]


def create_draft(staff, owner, data, *, request=None):
    kind = data.get("kind") if isinstance(data, dict) else None
    if kind not in dict(ListingDraft.KIND_CHOICES):
        raise ValidationError({"kind": [BAD_KIND]})
    payload = clean_payload(owner, kind, data)
    with transaction.atomic():
        draft = ListingDraft.objects.create(business_owner=owner, kind=kind, payload=payload, created_by=staff)
        record(
            staff, "listing_draft.created", target=draft,
            summary=f"Drafted {kind} “{_label(draft)}” for {owner.display_name}",
            after={"kind": kind, "name": _label(draft), "status": draft.status}, request=request,
        )
    return draft


def update_draft(staff, owner, draft, data, *, request=None):
    """Edit a draft that is a draft, awaiting the owner or lapsed. Editing detaches it from its link, so the owner
    confirms what they actually saw: the link is revoked once it covers nothing else."""
    if draft.status not in EDITABLE:
        raise ClaimError(confirmations.NOT_EDITABLE, code="not_editable", status_code=409)
    if not isinstance(data, dict):
        raise ValidationError({"detail": ["Send the fields to change."]})
    changes = {key: value for key, value in data.items() if key != "kind"}
    was = draft.status
    with transaction.atomic():
        # merge and validate against the payload read under the draft's lock, so two edits cannot overwrite each other
        draft = confirmations.detach(
            draft, staff, payload=lambda current: clean_payload(owner, draft.kind, {**current, **changes}),
        )
        record(
            staff, "listing_draft.updated", target=draft,
            summary=f"Edited {draft.kind} draft “{_label(draft)}”"
            + ("; the owner must confirm it again" if was == ListingDraft.AWAITING_OWNER else ""),
            after={"kind": draft.kind, "name": _label(draft), "status": draft.status, "was": was}, request=request,
        )
    return draft


def withdraw_draft(staff, owner, draft, *, request=None):
    was = draft.status
    with transaction.atomic():
        draft = confirmations.detach(draft, staff, withdraw=True)
        record(
            staff, "listing_draft.withdrawn", target=draft,
            summary=f"Withdrew {draft.kind} draft “{_label(draft)}”",
            after={"kind": draft.kind, "name": _label(draft), "was": was}, request=request,
        )
    return draft


def _ids(value):
    if not isinstance(value, (list, tuple)) or not value:
        raise ValidationError({"draft_ids": [NO_IDS]})
    ids = []
    for item in value:
        if isinstance(item, bool):
            raise ValidationError({"draft_ids": [NO_IDS]})
        try:
            pk = int(item)
        except (TypeError, ValueError):
            raise ValidationError({"draft_ids": [NO_IDS]})
        if pk not in ids:
            ids.append(pk)
    return ids


def _confirm_without_text(staff, owner, ids, request):
    """A business whose owner needs no text (confirmations.needs_owner_text is False): its drafts are confirmed at
    once, through the same seam the owner's own confirmation uses."""
    with transaction.atomic():
        BusinessOwner.objects.select_for_update().get(pk=owner.pk)  # 1. the owner
        locked = list(ListingDraft.objects.select_for_update().filter(business_owner=owner, pk__in=ids).order_by("pk"))
        if len(locked) != len(ids) or any(draft.status != ListingDraft.DRAFT for draft in locked):
            raise ClaimError(confirmations.NOT_CONFIRMABLE, code="not_confirmable", status_code=409)
        for draft in locked:
            draft.status = ListingDraft.OWNER_CONFIRMED
            draft.save(update_fields=["status", "updated_at"])
        confirmations._after_owner_confirmed(locked)
        for draft in locked:
            record(
                staff, "listing_draft.sent", target=draft,
                summary=f"Confirmed {draft.kind} draft “{_label(draft)}” without a text: no owner text is needed",
                after={"kind": draft.kind, "status": draft.status, "text": "not needed"}, request=request,
            )


def send(staff, owner, draft_ids, *, request=None):
    """Ask the owner, by one texted link, to confirm these drafts. Returns the drafts as staff see them."""
    ids = _ids(draft_ids)
    drafts = list(ListingDraft.objects.filter(business_owner=owner, pk__in=ids))
    if len(drafts) != len(ids):
        raise Http404
    if not confirmations.needs_owner_text(owner):
        _confirm_without_text(staff, owner, ids, request)
        return _fresh(ids)
    row = confirmations.request_confirmation(owner, staff, drafts=drafts)
    masked = mask_phone(row.sent_to) if row.sent_to and row.send_state != OwnerConfirmation.BLOCKED else ""
    for draft in sorted(drafts, key=lambda item: item.pk):
        record(
            staff, "listing_draft.sent", target=draft,
            summary=f"Sent {draft.kind} draft “{_label(draft)}” to the owner for confirmation"
            + (f" ({masked})" if masked else ""),
            after={"kind": draft.kind, "sent_to": masked, "send_note": confirmations.SEND_NOTES[row.send_state]},
            request=request,
        )
    return _fresh(ids)


def resend_draft(staff, owner, draft, *, request=None):
    """A fresh link for a draft whose link lapsed or whose text did not go out."""
    row = confirmations.resend([draft], staff)
    masked = mask_phone(row.sent_to) if row.sent_to and row.send_state != OwnerConfirmation.BLOCKED else ""
    record(
        staff, "listing_draft.resent", target=draft,
        summary=f"Sent {draft.kind} draft “{_label(draft)}” to the owner again" + (f" ({masked})" if masked else ""),
        after={"kind": draft.kind, "sent_to": masked, "send_note": confirmations.SEND_NOTES[row.send_state]},
        request=request,
    )
    return _fresh([draft.pk])[0]
