"""Flash-sale workflow: eligibility, asking sellers, their answer, the clock, ending early.

No seller is added without saying yes: a listing joins a sale only after its owner agrees in
their own dashboard (an in-app notice from AshantiHub; never a call or WhatsApp). The sellers
pay for the discount, so changing the discount, the dates or the listings asks them again."""
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from fraud.models import FraudFlag
from listings.models import Listing
from listings.visibility import hidden_business_q
from notifications.services import notify_business_owner

from .models_promos import FlashSale, FlashSaleListing
from .promos import cents, money

WITHDRAW_CUTOFF_HOURS = 24
MAX_DISCOUNT_PCT = 90
EDITABLE = (FlashSale.DRAFT, FlashSale.WAITING, FlashSale.SCHEDULED)
OPEN_STATES = (FlashSale.DRAFT, FlashSale.WAITING, FlashSale.SCHEDULED, FlashSale.LIVE)


class FlashError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def sale_price(normal, pct):
    return cents(Decimal(str(normal)) * (100 - pct) / 100)


def withdraw_cutoff(sale):
    return sale.starts_at - timedelta(hours=WITHDRAW_CUTOFF_HOURS)


def eligibility_problem(listing, sale=None):
    """Why this listing cannot be in a sale, or None."""
    if listing.status != Listing.PUBLISHED:
        return "Not live on the site."
    if Listing.objects.filter(pk=listing.pk).filter(hidden_business_q()).exists():
        return "The business is hidden from the site."
    if listing.business_owner.kyc_status != "verified":
        return "The business is not verified."
    if listing.variants.filter(is_active=True).exists():
        return "Has variants: choose a single-price listing."
    if listing.stock_quantity is None:
        return "Its stock is not tracked, so the sale cap can't be enforced."
    if listing.stock_quantity <= 0:
        return "Out of stock."
    if listing.price_amount is None:
        return "It has no price."
    if FraudFlag.objects.filter(status=FraudFlag.OPEN, business_owner_id=listing.business_owner_id).exists():
        return "There is an open fraud case on the business."
    if sale is not None:
        clash = FlashSaleListing.objects.filter(
            listing=listing, sale__status__in=OPEN_STATES, sale__starts_at__lt=sale.ends_at, sale__ends_at__gt=sale.starts_at,
            declined_at__isnull=True,
        ).exclude(sale=sale).select_related("sale").first()
        if clash:
            return f"Already in “{clash.sale.name}” at that time."
    return None


def eligible_listings(search="", sale=None, limit=40):
    qs = Listing.objects.filter(status=Listing.PUBLISHED, stock_quantity__gt=0, price_amount__isnull=False,
                                business_owner__kyc_status="verified").exclude(hidden_business_q()).select_related("business_owner", "category")
    if search:
        qs = qs.filter(name__icontains=search)
    out = []
    for listing in qs.order_by("name")[: limit * 3]:
        if eligibility_problem(listing, sale) is None:
            out.append(listing)
        if len(out) >= limit:
            break
    return out


def _ask(row, sale, now):
    row.asked_at, row.agreed_at, row.declined_at, row.withdrawn_at = now, None, None, None
    row.save(update_fields=["asked_at", "agreed_at", "declined_at", "withdrawn_at"])


def ask_sellers(sale, now=None):
    """Send each owner one notice for the listings of theirs that have not answered. Moves the
    sale to waiting_sellers. Rows already agreed stay agreed."""
    now = now or timezone.now()
    rows = list(sale.listings.select_related("listing__business_owner").filter(agreed_at__isnull=True, declined_at__isnull=True))
    if not sale.listings.exists():
        raise FlashError("Add at least one listing before asking sellers.")
    by_owner = {}
    for row in rows:
        _ask(row, sale, now)
        by_owner.setdefault(row.listing.business_owner, []).append(row)
    for owner, owner_rows in by_owner.items():
        names = ", ".join(r.listing.name for r in owner_rows[:3]) + (" and more" if len(owner_rows) > 3 else "")
        notify_business_owner(
            owner, "flash_sale_invite", f"AshantiHub is asking you to take part in “{sale.name}”",
            body=(f"{sale.discount_pct}% off {names}, {sale.starts_at:%a %d %b %H:%M} to {sale.ends_at:%a %d %b %H:%M}. "
                  f"You pay for the discount on your own items, so only you can say yes, in your dashboard. "
                  f"You can withdraw until {withdraw_cutoff(sale):%a %d %b %H:%M}."),
            link="/business?tab=flash-sales", icon="⚡",
        )
    if sale.status in (FlashSale.DRAFT, FlashSale.WAITING, FlashSale.SCHEDULED):
        sale.status = FlashSale.WAITING
    sale.asked_at = sale.asked_at or now
    sale.save(update_fields=["status", "asked_at", "updated_at"])
    settle(sale)
    return len(by_owner)


def settle(sale):
    """After any answer: scheduled when nobody is still undecided and at least one agreed (and the
    sale hasn't started); back to waiting otherwise."""
    if sale.status not in (FlashSale.WAITING, FlashSale.SCHEDULED):
        return
    rows = list(sale.listings.all())
    pending = any(r.agreed_at is None and r.declined_at is None for r in rows)
    agreed = any(r.agreed_at for r in rows)
    want = FlashSale.SCHEDULED if (agreed and not pending and sale.ends_at > timezone.now()) else FlashSale.WAITING
    if want != sale.status:
        sale.status = want
        sale.save(update_fields=["status", "updated_at"])


def reask_after_change(sale, now=None):
    """The discount, dates or listings changed on a sale sellers had been asked about: every
    answer is cleared and everyone is asked again."""
    now = now or timezone.now()
    sale.listings.filter(declined_at__isnull=False).delete()  # those who said no are not carried over
    for row in sale.listings.all():
        row.normal_price = row.listing.price_amount
        row.sale_price = sale_price(row.listing.price_amount, sale.discount_pct)
        row.asked_at, row.agreed_at, row.declined_at, row.withdrawn_at = None, None, None, None
        row.save()
    sale.status = FlashSale.WAITING
    sale.save(update_fields=["status", "updated_at"])
    if sale.listings.exists():
        ask_sellers(sale, now)


# ── owner side ──
def invitations_for(owner):
    rows = FlashSaleListing.objects.filter(listing__business_owner=owner, asked_at__isnull=False).exclude(
        sale__status__in=(FlashSale.DRAFT, FlashSale.CANCELLED)).select_related("sale", "listing").order_by("-sale__starts_at")
    by_sale = {}
    for row in rows:
        by_sale.setdefault(row.sale_id, []).append(row)
    out = []
    now = timezone.now()
    for sale_rows in by_sale.values():
        sale = sale_rows[0].sale
        states = {r.state for r in sale_rows}
        answer = "agreed" if states == {"agreed"} else "declined" if states <= {"declined", "withdrawn"} else "asked" if "asked" in states else "mixed"
        out.append({
            "sale_id": sale.pk, "name": sale.name, "discount_pct": sale.discount_pct, "starts_at": sale.starts_at, "ends_at": sale.ends_at,
            "sale_status": sale.status, "answer": answer, "can_withdraw": now < withdraw_cutoff(sale) and sale.status in (FlashSale.WAITING, FlashSale.SCHEDULED),
            "can_answer": sale.status in (FlashSale.WAITING, FlashSale.SCHEDULED) and now < sale.starts_at,
            "withdraw_until": withdraw_cutoff(sale),
            "listings": [{"id": r.listing_id, "name": r.listing.name, "normal_price": money(r.normal_price), "sale_price": money(r.sale_price), "state": r.state} for r in sale_rows],
        })
    return out


@transaction.atomic
def respond(owner, sale_id, accept):
    sale = FlashSale.objects.select_for_update().filter(pk=sale_id).first()
    rows = list(FlashSaleListing.objects.select_for_update().filter(sale_id=sale_id, listing__business_owner=owner, asked_at__isnull=False)) if sale else []
    if not rows or sale.status not in (FlashSale.WAITING, FlashSale.SCHEDULED):
        raise FlashError("This invitation is not open.", 404)
    now = timezone.now()
    if now >= sale.starts_at:
        raise FlashError("This sale has already started.", 409)
    for row in rows:
        if accept:
            if row.declined_at:
                continue  # said no already; a fresh invitation is needed
            row.agreed_at = row.agreed_at or now
        else:
            if row.agreed_at:
                if now >= withdraw_cutoff(sale):
                    raise FlashError("It is too close to the start to withdraw. Contact AshantiHub Support if you must.", 409)
                row.withdrawn_at = now  # had said yes, now withdrawing
            row.agreed_at = None
            row.declined_at = now
        row.save(update_fields=["agreed_at", "declined_at", "withdrawn_at"])
    settle(sale)
    return sale


# ── the clock ──
def tick(now=None):
    """scheduled -> live -> ended. A sale that was never agreed in time stays waiting and ends at
    its end time without ever going live. Returns (went_live, ended)."""
    now = now or timezone.now()
    live = ended = 0
    for sale in FlashSale.objects.filter(status__in=(FlashSale.SCHEDULED, FlashSale.LIVE, FlashSale.WAITING), ends_at__lte=now):
        with transaction.atomic():
            row = FlashSale.objects.select_for_update().get(pk=sale.pk)
            if row.status in (FlashSale.SCHEDULED, FlashSale.LIVE, FlashSale.WAITING):
                row.status = FlashSale.ENDED if row.status in (FlashSale.SCHEDULED, FlashSale.LIVE) else FlashSale.CANCELLED
                row.save(update_fields=["status", "updated_at"])
                ended += 1
    for sale in FlashSale.objects.filter(status=FlashSale.SCHEDULED, starts_at__lte=now, ends_at__gt=now):
        with transaction.atomic():
            row = FlashSale.objects.select_for_update().get(pk=sale.pk)
            if row.status == FlashSale.SCHEDULED:
                row.status = FlashSale.LIVE
                row.save(update_fields=["status", "updated_at"])
                live += 1
    return live, ended


def end_early(sale_id, staff):
    with transaction.atomic():
        sale = FlashSale.objects.select_for_update().get(pk=sale_id)
        if sale.status != FlashSale.LIVE:
            raise FlashError("Only a live sale can be ended early.", 409)
        sale.status = FlashSale.ENDED
        sale.ended_early_at = timezone.now()
        sale.ended_early_by = staff
        sale.save(update_fields=["status", "ended_early_at", "ended_early_by", "updated_at"])
    return sale


def cancel(sale_id):
    with transaction.atomic():
        sale = FlashSale.objects.select_for_update().get(pk=sale_id)
        if sale.status not in (FlashSale.DRAFT, FlashSale.WAITING, FlashSale.SCHEDULED):
            raise FlashError("Only a sale that hasn't started can be cancelled; end a live one early.", 409)
        sale.status = FlashSale.CANCELLED
        sale.save(update_fields=["status", "updated_at"])
    return sale


def flash_sale_entries(start, end):
    """Windows for the campaign calendar: [{id, kind:'flash_sale', title, starts_at, ends_at, status}]
    for every sale that overlaps [start, end) and is not cancelled."""
    qs = FlashSale.objects.exclude(status=FlashSale.CANCELLED).filter(starts_at__lt=end, ends_at__gt=start).order_by("starts_at")
    return [{"id": s.pk, "kind": "flash_sale", "title": s.name, "starts_at": s.starts_at, "ends_at": s.ends_at, "status": s.status} for s in qs]
