"""Free-delivery promos: the checkout rule and the owner/staff state changes.

Checkout rule (decided, simplest): the delivery fee is ONE fee per order, measured from the first
listing's pickup point, so it is not split per business. The fee is waived only when EVERY line of
the order belongs to one business and is covered by that business's live waiver(s). A cart mixing
businesses is never waived, so one business's promo is never paid for by another's."""
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone

from accounts.models import BusinessOwner
from listings.models import Listing
from listings.visibility import hidden_business_q
from notifications.services import notify_business_owner, notify_staff_role

from .models_waivers import DeliveryWaiver, WaivedFeeCharge
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
    rows = list(
        DeliveryWaiver.objects.filter(
            business_owner_id=owner_id, status=DeliveryWaiver.ACTIVE, starts_at__lte=now, ends_at__gt=now,
            business_owner__kyc_status=BusinessOwner.VERIFIED,
        ).exclude(hidden_business_q("business_owner__")).prefetch_related("listings").order_by("id")
    )
    # An AshantiHub-funded promo whose cap is used up stops waiving (derived, never a status change).
    return [w for w in rows if not (w.funded_by == DeliveryWaiver.FUNDER_PLATFORM and cap_left(w) <= 0)]


def spent(w):
    """What an AshantiHub-funded promo has cost so far: its charges still owed (reversed ones cost nothing)."""
    return w.charges.filter(status=WaivedFeeCharge.OWED).aggregate(t=Sum("amount"))["t"] or Decimal("0.00")


def cap_left(w):
    return (w.budget_cap or Decimal("0.00")) - spent(w)


def owner_blocker(owner):
    """Why this business may not run a promo, or None. Suspended, hidden or unverified businesses cannot,
    and an already-live promo of one stops applying (live_waivers applies the same test)."""
    row = BusinessOwner.objects.filter(pk=owner.pk).exclude(hidden_business_q("")).first()
    if row is None:
        return "This business is suspended or hidden, so it can't run a free-delivery promo."
    if row.kyc_status != BusinessOwner.VERIFIED:
        return "Only a verified business can run a free-delivery promo."
    return None


def _guard(owner):
    message = owner_blocker(owner)
    if message:
        raise WaiverError(message, 403)


def record_charge(order, waiver, amount):
    """The business's cover of a waived fee as an auditable row tied to the order and the promo. Call in the checkout transaction."""
    return WaivedFeeCharge.objects.create(order=order, waiver=waiver, business_owner=waiver.business_owner, amount=cents(amount),
        funded_by=waiver.funded_by,
    )


def reverse_for_order(order, reason):
    """Idempotent: the order was cancelled, its payment failed or it was fully refunded, so the business no longer owes the fee."""
    charge = WaivedFeeCharge.objects.select_for_update().filter(order=order, status=WaivedFeeCharge.OWED).first()
    if charge is not None:
        charge.status, charge.reversed_at, charge.reversed_reason = WaivedFeeCharge.REVERSED, timezone.now(), reason[:40]
        charge.save(update_fields=["status", "reversed_at", "reversed_reason"])
    return charge


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
    _guard(owner)
    fields, listings = clean(data, owner)
    w = DeliveryWaiver.objects.create(business_owner=owner, source=DeliveryWaiver.OWNER, status=DeliveryWaiver.PENDING, **fields)
    w.listings.set(listings)
    notify_staff_role(PERM, "delivery_promo_pending", f"{owner.display_name} asked for a free-delivery promo: {w.name}", link="/staff?tab=mk-delivery-promos", icon="🚚")
    return w


@transaction.atomic
def create_for_staff(staff, owner, data):
    _guard(owner)
    fields, listings = clean(data, owner)
    w = DeliveryWaiver.objects.create(
        business_owner=owner, source=DeliveryWaiver.STAFF, status=DeliveryWaiver.ACTIVE, created_by=staff,
        funded_by=DeliveryWaiver.FUNDER_BUSINESS, reviewed_by=staff, reviewed_at=timezone.now(), **fields,
    )
    w.listings.set(listings)
    return w


def _cap(value):
    """The budget cap as money, or a WaiverError: required, a plain number above zero."""
    from decimal import InvalidOperation

    if value is None or isinstance(value, bool) or isinstance(value, (list, dict)):
        raise WaiverError("Set the most this promo may cost AshantiHub (a budget cap above zero).")
    try:
        cap = cents(Decimal(str(value).strip()))
    except (InvalidOperation, ValueError):
        raise WaiverError("The budget cap must be an amount in GH₵.")
    if not cap.is_finite() or cap <= 0:
        raise WaiverError("The budget cap must be more than zero.")
    if cap >= Decimal("100000000"):
        raise WaiverError("That budget cap is too large.")
    return cap


@transaction.atomic
def create_platform_funded(staff, owner, data, request=None):
    """An AshantiHub-funded promo for one named business: pending until Operations or a Super Admin approves it through the
    approvals engine (a Super Admin's own applies at once). Returns (waiver, approval)."""
    from activity.services import record
    from approvals import services as approvals

    from .approval_kinds_waivers import KEY

    _guard(owner)
    fields, listings = clean(data, owner)
    cap = _cap(data.get("budget_cap"))
    w = DeliveryWaiver.objects.create(
        business_owner=owner, source=DeliveryWaiver.STAFF, status=DeliveryWaiver.PENDING, created_by=staff,
        funded_by=DeliveryWaiver.FUNDER_PLATFORM, budget_cap=cap, **fields,
    )
    w.listings.set(listings)
    approval = approvals.submit(
        staff, KEY, title=f"Free delivery for {owner.display_name}, up to GH₵ {cap} paid by AshantiHub", target=w,
        payload={"waiver": w.pk, "budget_cap": str(cap)}, request=request,
    )
    w.refresh_from_db()
    record(staff, "marketing.delivery_promo_created", target=w, summary=f"AshantiHub-funded free delivery proposed: {w.name}", request=request,
           after={"business_id": owner.pk, "name": w.name, "starts_at": w.starts_at.isoformat(), "ends_at": w.ends_at.isoformat(),
                  "budget_cap": str(cap), "funded_by": w.funded_by})
    return w, approval


def _refuse_platform(w):
    if w.funded_by == DeliveryWaiver.FUNDER_PLATFORM:
        raise WaiverError("AshantiHub-funded promos are decided from the approvals inbox.", 409)


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
    _guard(owner)
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
    _refuse_platform(w)
    _guard(w.business_owner)
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
    _refuse_platform(w)
    if w.status != DeliveryWaiver.PENDING:
        raise WaiverError("This promo is not waiting for review.", 409)
    w.status, w.reviewed_by, w.reviewed_at, w.rejection_reason = DeliveryWaiver.REJECTED, staff, timezone.now(), reason[:300]
    w.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
    notify_business_owner(w.business_owner, "delivery_promo_rejected", f"Your free-delivery promo “{w.name}” was not approved", body=w.rejection_reason, icon="🚚")
    return w


@transaction.atomic
def re_review(pk):
    w = _locked(pk)
    _refuse_platform(w)
    if w.status != DeliveryWaiver.REJECTED:
        raise WaiverError("Only a not-approved promo can be sent back to review.", 400)
    w.status, w.rejection_reason, w.reviewed_by, w.reviewed_at = DeliveryWaiver.PENDING, "", None, None
    w.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at", "updated_at"])
    return w


def _approval_of(w):
    from approvals.models import ApprovalRequest

    from .approval_kinds_waivers import KEY

    return ApprovalRequest.objects.filter(kind=KEY, target_type="marketing.deliverywaiver", target_id=str(w.pk)).order_by("-id").first()


def serialize(w, now=None):
    now = now or timezone.now()
    platform = w.funded_by == DeliveryWaiver.FUNDER_PLATFORM
    approval = _approval_of(w) if platform else None
    owed = w.charges.filter(status=WaivedFeeCharge.OWED).aggregate(n=Count("id"), total=Sum("amount"))
    return {
        "covered_orders": owed["n"], "covered_total": str(owed["total"] or Decimal("0.00")),
        "id": w.pk, "name": w.name, "business_id": w.business_owner_id, "business": w.business_owner.display_name,
        "starts_at": w.starts_at, "ends_at": w.ends_at, "all_items": w.all_items,
        "listings": [{"id": l.pk, "name": l.name} for l in w.listings.all()],
        "status": w.status, "effective_status": w.effective_status(now), "live": w.is_live(now), "source": w.source,
        "funded_by": w.funded_by, "budget_cap": str(w.budget_cap) if w.budget_cap is not None else None,
        "spent": str(spent(w)) if platform else None,
        "awaiting_approval": bool(platform and w.status == DeliveryWaiver.PENDING and approval is not None and approval.status == "pending"),
        "approval_id": approval.pk if approval else None,
        "rejection_reason": w.rejection_reason, "reviewed_at": w.reviewed_at, "created_at": w.created_at,
    }
