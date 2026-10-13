"""Free-delivery promos: the checkout rule and the owner/staff state changes.

Checkout rule (decided, simplest): the delivery fee is ONE fee per order, measured from the first
listing's pickup point, so it is not split per business. The fee is waived only when EVERY line of
the order belongs to one business and is covered by that business's live waiver(s). A cart mixing
businesses is never waived, so one business's promo is never paid for by another's."""
from django.db import transaction
from django.utils import timezone

from listings.models import Listing
from notifications.services import notify_business_owner, notify_staff_role

from .models_waivers import DeliveryWaiver
from .promos import cents

MAX_DAYS = 90
PERM = "site_promo.manage"


class WaiverError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ─── checkout ────────────────────────────────────────────────────────────────
def live_waivers(owner_id, now):
    """Waivers on right now for one business: approved, and now inside [starts_at, ends_at)."""
    return list(
        DeliveryWaiver.objects.filter(
            business_owner_id=owner_id, status=DeliveryWaiver.ACTIVE, starts_at__lte=now, ends_at__gt=now,
        ).prefetch_related("listings").order_by("id")
    )


def mixed_business(listings):
    return len({l.business_owner_id for l in listings}) > 1


def covering_waiver(listings, now):
    """A live waiver that applies to this order, or None. Every listing must belong to one
    business and be covered by one of that business's live waivers (the first by id is named)."""
    listings = list(listings)
    if not listings or mixed_business(listings):
        return None
    waivers = live_waivers(listings[0].business_owner_id, now)
    if not waivers:
        return None
    covered = {l.pk for l in listings if any(w.all_items or l.pk in {x.pk for x in w.listings.all()} for w in waivers)}
    return waivers[0] if covered == {l.pk for l in listings} else None


def apply_to_fee(waiver, fee_quote):
    """(fee charged, breakdown to store) for a fee quote under a waiver (or none)."""
    if not fee_quote:
        return None, fee_quote
    if waiver is None:
        return cents(fee_quote["total"]), fee_quote
    waived = {"amount": str(cents(fee_quote["total"])), "waiver_id": waiver.pk, "name": waiver.name, "business_id": waiver.business_owner_id}
    return cents(0), {**fee_quote, "waived": waived}


# ─── validation ──────────────────────────────────────────────────────────────
def _when(value, label):
    from .flash_sales import FlashError
    from .views_promos import _parse_dt

    try:
        return _parse_dt(value, label)
    except FlashError as exc:
        raise WaiverError(exc.message)


def clean(data, owner, now=None):
    now = now or timezone.now()
    name = str(data.get("name") or "").strip()
    if not name:
        raise WaiverError("Give the promo a name.")
    starts, ends = _when(data.get("starts_at"), "The start"), _when(data.get("ends_at"), "The end")
    if ends <= starts:
        raise WaiverError("The promo must end after it starts.")
    if ends <= now:
        raise WaiverError("The end must be in the future.")
    if (ends - starts).days > MAX_DAYS:
        raise WaiverError(f"A promo can run for at most {MAX_DAYS} days.")
    all_items = data.get("all_items") is True
    ids = data.get("listing_ids") or []
    listings = []
    if not all_items:
        if not isinstance(ids, list) or not ids or any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
            raise WaiverError("Choose which of your items get free delivery, or pick all of them.")
        # Ownership is enforced here, server side: every id must be a listing of THIS business.
        listings = list(Listing.objects.filter(pk__in=ids, business_owner=owner))
        if len(listings) != len(set(ids)):
            raise WaiverError("One or more of those items aren't yours.")
    return {"name": name[:120], "starts_at": starts, "ends_at": ends, "all_items": all_items}, listings


# ─── actions ─────────────────────────────────────────────────────────────────
@transaction.atomic
def create_for_owner(owner, data):
    fields, listings = clean(data, owner)
    w = DeliveryWaiver.objects.create(business_owner=owner, source=DeliveryWaiver.OWNER, status=DeliveryWaiver.PENDING, **fields)
    w.listings.set(listings)
    notify_staff_role(PERM, "delivery_promo_pending", f"{owner.display_name} asked for a free-delivery promo: {w.name}", link="/staff?tab=mk-delivery-promos", icon="🚚")
    return w


@transaction.atomic
def create_for_staff(staff, owner, data):
    fields, listings = clean(data, owner)
    w = DeliveryWaiver.objects.create(
        business_owner=owner, source=DeliveryWaiver.STAFF, status=DeliveryWaiver.ACTIVE, created_by=staff,
        reviewed_by=staff, reviewed_at=timezone.now(), **fields,
    )
    w.listings.set(listings)
    return w


def _locked(pk, **scope):
    w = DeliveryWaiver.objects.select_for_update().filter(pk=pk, **scope).first()
    if w is None:
        raise DeliveryWaiver.DoesNotExist
    return w


@transaction.atomic
def owner_pause(owner, pk):
    w = _locked(pk, business_owner=owner)
    if w.status != DeliveryWaiver.ACTIVE:
        raise WaiverError("Only an approved promo can be paused.", 409)
    w.status = DeliveryWaiver.PAUSED
    w.save(update_fields=["status", "updated_at"])
    return w


@transaction.atomic
def owner_resume(owner, pk):
    w = _locked(pk, business_owner=owner)
    if w.status != DeliveryWaiver.PAUSED:
        raise WaiverError("Only a paused promo can be resumed.", 409)
    if w.ends_at <= timezone.now():
        raise WaiverError("This promo's window has ended.", 409)
    w.status = DeliveryWaiver.ACTIVE
    w.save(update_fields=["status", "updated_at"])
    return w


@transaction.atomic
def end(pk, owner=None):
    w = _locked(pk, **({"business_owner": owner} if owner is not None else {}))
    if w.status not in (DeliveryWaiver.PENDING, DeliveryWaiver.ACTIVE, DeliveryWaiver.PAUSED):
        raise WaiverError("This promo is already over.", 409)
    w.status = DeliveryWaiver.ENDED
    w.save(update_fields=["status", "updated_at"])
    return w


@transaction.atomic
def approve(pk, staff):
    w = _locked(pk)
    if w.status != DeliveryWaiver.PENDING:
        raise WaiverError("This promo is not waiting for review.", 409)
    if w.ends_at <= timezone.now():
        raise WaiverError("This promo's window has already ended.", 409)
    w.status, w.reviewed_by, w.reviewed_at, w.rejection_reason = DeliveryWaiver.ACTIVE, staff, timezone.now(), ""
    w.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
    notify_business_owner(w.business_owner, "delivery_promo_approved", f"Your free-delivery promo “{w.name}” was approved", icon="🚚")
    return w


@transaction.atomic
def reject(pk, staff, reason):
    reason = str(reason or "").strip()
    if not reason:
        raise WaiverError("Give a reason so the business knows what to change.")
    w = _locked(pk)
    if w.status != DeliveryWaiver.PENDING:
        raise WaiverError("This promo is not waiting for review.", 409)
    w.status, w.reviewed_by, w.reviewed_at, w.rejection_reason = DeliveryWaiver.REJECTED, staff, timezone.now(), reason[:300]
    w.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
    notify_business_owner(w.business_owner, "delivery_promo_rejected", f"Your free-delivery promo “{w.name}” was not approved", body=w.rejection_reason, icon="🚚")
    return w


@transaction.atomic
def re_review(pk):
    w = _locked(pk)
    if w.status != DeliveryWaiver.REJECTED:
        raise WaiverError("Only a not-approved promo can be sent back to review.", 400)
    w.status, w.rejection_reason, w.reviewed_by, w.reviewed_at = DeliveryWaiver.PENDING, "", None, None
    w.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at", "updated_at"])
    return w


def serialize(w, now=None):
    now = now or timezone.now()
    return {
        "id": w.pk, "name": w.name, "business_id": w.business_owner_id, "business": w.business_owner.display_name,
        "starts_at": w.starts_at, "ends_at": w.ends_at, "all_items": w.all_items,
        "listings": [{"id": l.pk, "name": l.name} for l in w.listings.all()],
        "status": w.status, "effective_status": w.effective_status(now), "live": w.is_live(now), "source": w.source,
        "rejection_reason": w.rejection_reason, "reviewed_at": w.reviewed_at, "created_at": w.created_at,
    }
