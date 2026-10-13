"""Pricing a cart with flash sales and a coupon, and recording the result on the order.

This is the ONLY code that reads Coupon / FlashSale rows at checkout, and it runs only while
settings.MARKETING_PROMOS_ENABLED is on (orders.views.OrderCheckoutView and the cart quote
view check marketing.promos.enabled() first). With the switch off checkout is untouched.

Correctness rules (backend/CLAUDE.md, checkout core):
- price(..., lock=True) runs inside the order transaction BEFORE any stock is reserved or any
  row is written. It locks the live flash sales (by id), then the coupon row, so two checkouts
  can neither oversell a sale's stock_cap nor use a single-use code twice. Lock order is
  always: flash sales, coupon, then the listings (the existing stock loop).
- Flash cap and per-customer limits are counted from OrderItem rows (orders not cancelled).
- One coupon per order, never on a flash-sale line. The coupon discount is taken off
  Order.total_amount (NET) and written to Order.discount_amount; the seller's line totals are
  untouched, so the owner views (OwnerOrderSerializer, sales report) still show only the
  caller's own lines at the price they were sold for.
- Listing.price_amount is never changed. A flash line's OrderItem.unit_price is the sale price.
- Failure: payments.services._fail_order_checkout calls release_order() for an order priced
  here, which gives the coupon use back and cancels the order so its sale stock is free."""
from dataclasses import dataclass, field
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from accounts.phones import filter_by_phone, phone_key
from fraud.models import FraudFlag
from listings.models import Listing
from listings.visibility import hidden_business_q
from notifications.services import notify_staff_role
from orders.models import Order, OrderItem

from .models_promos import Coupon, CouponCode, CouponRedemption, FlashSale, FlashSaleListing
from .promos import cents, money

INVALID_CODE = "That code isn't valid."
LEAST_TOTAL = Decimal("0.01")


class PromoError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


@dataclass
class Line:
    listing: object
    quantity: int
    unit_price: Decimal
    flash_sale: object = None
    cart_item_id: int = None

    @property
    def line_total(self):
        return cents(self.unit_price * self.quantity)


@dataclass
class Priced:
    lines: list
    items_subtotal: Decimal
    discount: Decimal = Decimal("0.00")
    total: Decimal = Decimal("0.00")
    coupon: object = None
    code_row: object = None
    code_used: str = ""
    notes: list = field(default_factory=list)

    def order_extras(self):
        return {"discount_amount": self.discount, "coupon": self.coupon}


# ─── flash sales ─────────────────────────────────────────────────────────────
def live_window_sales(now, lock=False):
    """Sales that are on right now by the clock. The status flips on a one-minute tick, so the
    window decides; `ended` and `cancelled` (end early) never match."""
    qs = FlashSale.objects.filter(
        status__in=(FlashSale.SCHEDULED, FlashSale.LIVE), starts_at__lte=now, ends_at__gt=now,
    ).order_by("id")
    return list(qs.select_for_update() if lock else qs)


def usable_rows(rows, listings):
    """The flash-sale rows whose listing is still fit to sell at the sale price: published, not
    hidden, stock tracked, the price the seller agreed to, and no open fraud case on the business."""
    ids = [l.pk for l in listings]
    hidden = set(Listing.objects.filter(pk__in=ids).filter(hidden_business_q()).values_list("pk", flat=True))
    owner_ids = {l.business_owner_id for l in listings}
    flagged = set(FraudFlag.objects.filter(status=FraudFlag.OPEN, business_owner_id__in=owner_ids).values_list("business_owner_id", flat=True))
    fresh = {l.pk: l for l in Listing.objects.filter(pk__in=ids)}
    out = []
    for row in rows:
        live = fresh.get(row.listing_id)
        if (
            live is None or live.status != Listing.PUBLISHED or live.pk in hidden or live.stock_quantity is None
            or live.price_amount is None or cents(live.price_amount) != cents(row.normal_price)
            or live.business_owner_id in flagged
        ):
            continue
        out.append(row)
    return out


def _sold(sale, customer=None):
    qs = OrderItem.objects.filter(flash_sale=sale).exclude(order__status=Order.CANCELLED)
    if customer is not None:
        qs = qs.filter(order__customer=customer)
    return qs.aggregate(n=Sum("quantity"))["n"] or 0


def _flash_lines(customer, items, now, lock):
    """Split each cart line into a flash part (sale price, within the sale's remaining stock and
    this customer's remaining allowance) and a regular part. Returns (lines, notes)."""
    sales = live_window_sales(now, lock)
    lines, notes = [], []
    if not sales:
        return [Line(i.listing, i.quantity, i.unit_price_snapshot, None, i.id) for i in items], notes
    by_sale = {s.pk: s for s in sales}
    rows = FlashSaleListing.objects.filter(
        sale_id__in=by_sale, listing_id__in=[i.listing_id for i in items],
        agreed_at__isnull=False, declined_at__isnull=True,
    ).select_related("listing").order_by("sale_id")
    usable = {}
    for row in usable_rows(list(rows), [i.listing for i in items]):
        usable.setdefault(row.listing_id, row)
    room = {}  # sale id -> [stock left, customer allowance left]
    for sale in sales:
        room[sale.pk] = [max(0, sale.stock_cap - _sold(sale)), max(0, sale.per_customer_limit - _sold(sale, customer))]
    for item in items:
        row = usable.get(item.listing_id)
        snapshot = cents(item.unit_price_snapshot)
        if row is None or cents(row.sale_price) >= snapshot:
            lines.append(Line(item.listing, item.quantity, item.unit_price_snapshot, None, item.id))
            continue
        left = room[row.sale_id]
        take = min(item.quantity, left[0], left[1])
        if take <= 0:
            lines.append(Line(item.listing, item.quantity, item.unit_price_snapshot, None, item.id))
            notes.append(f"{item.listing.name}: the sale price is no longer available for you, so it is at its normal price." if left[1] <= 0 else f"{item.listing.name}: sold out at the sale price, so it is at its normal price.")
            continue
        left[0] -= take
        left[1] -= take
        lines.append(Line(item.listing, take, row.sale_price, by_sale[row.sale_id], item.id))
        if take < item.quantity:
            lines.append(Line(item.listing, item.quantity - take, item.unit_price_snapshot, None, item.id))
            notes.append(f"{item.listing.name}: {take} at the sale price, the other {item.quantity - take} at the normal price.")
    return lines, notes


# ─── coupons ─────────────────────────────────────────────────────────────────
def normalise_code(raw):
    return (raw or "").strip().upper()


def find_code(raw):
    """(coupon, code_row) for a typed code, or (None, None). A shared coupon's own code, or a
    generated single-use code; the prefix of a single-use coupon is not itself a code."""
    code = normalise_code(raw)
    if not code:
        return None, None
    coupon = Coupon.objects.filter(code=code, code_mode=Coupon.SHARED).first()
    if coupon:
        return coupon, None
    row = CouponCode.objects.select_related("coupon").filter(code=code).first()
    return (row.coupon, row) if row else (None, None)


def _same_person(customer):
    """Redemptions by this customer or anyone sharing their phone (or this order's delivery phone):
    the only abuse checks that can be made from fields we really hold."""
    from accounts.models import Customer

    ids = {customer.pk}
    if customer.phone:
        ids |= set(filter_by_phone(Customer.objects.all(), "phone", customer.phone).values_list("pk", flat=True))
    return ids


def _uses_by_person(coupon, customer, delivery_phone):
    qs = CouponRedemption.objects.filter(coupon=coupon, released_at__isnull=True)
    ids = _same_person(customer)
    n = qs.filter(customer_id__in=ids).count()
    key = phone_key(delivery_phone)
    if key:
        n = max(n, filter_by_phone(qs, "order__delivery_phone", delivery_phone).count())
    return n


def discount_for(coupon, eligible):
    """What this coupon takes off `eligible` (the items it applies to)."""
    if coupon.kind == Coupon.FIXED:
        amount = coupon.value
    else:
        amount = eligible * coupon.value / Decimal(100)
        if coupon.max_discount is not None:
            amount = min(amount, coupon.max_discount)
    return cents(min(amount, eligible))


def apply_coupon(raw_code, customer, lines, *, lock, now, delivery_phone=""):
    """(coupon, code_row, discount) or raises PromoError. Locks the coupon row when `lock`."""
    coupon, row = find_code(raw_code)
    if coupon is None:
        raise PromoError(INVALID_CODE)
    if lock:
        coupon = Coupon.objects.select_for_update().get(pk=coupon.pk)
    if coupon.status != Coupon.ACTIVE:
        raise PromoError(INVALID_CODE)
    if coupon.starts_at and coupon.starts_at > now:
        raise PromoError("That code isn't valid yet.")
    if coupon.expires_at and coupon.expires_at <= now:
        raise PromoError("That code has expired.")
    flash_present = any(l.flash_sale is not None for l in lines)
    eligible_lines = [l for l in lines if l.flash_sale is None and (coupon.category_id is None or l.listing.category_id == coupon.category_id)]
    eligible = sum((l.line_total for l in eligible_lines), Decimal("0.00"))
    if eligible <= 0:
        if flash_present:
            raise PromoError("Coupons can't be used on flash-sale prices.")
        raise PromoError("This code doesn't apply to anything in your cart.")
    if eligible < coupon.min_spend:
        raise PromoError(f"Spend at least GH₵ {money(coupon.min_spend)} on eligible items to use this code.")
    if coupon.uses() >= coupon.usage_limit:
        raise PromoError("That code has been used up.")
    if row is not None:
        if CouponRedemption.objects.filter(code_row=row, released_at__isnull=True).exists():
            raise PromoError("That code has already been used.")
    elif _uses_by_person(coupon, customer, delivery_phone) >= coupon.per_customer_limit:
        raise PromoError("You have already used this code.")
    discount = discount_for(coupon, eligible)
    remaining = coupon.budget_cap - coupon.cost_to_date()
    if remaining <= 0 or discount > remaining:
        raise PromoError("That code is no longer available.")
    return coupon, row, discount


# ─── the whole cart ──────────────────────────────────────────────────────────
def price(customer, items, coupon_code="", *, lock=False, now=None, delivery_phone=""):
    """Price `items` (cart lines, each with .listing, .quantity, .unit_price_snapshot, .id).
    Raises PromoError for a coupon that cannot be used; flash-sale shortfalls never raise, they
    fall back to the regular price and say so in `notes`."""
    now = now or timezone.now()
    lines, notes = _flash_lines(customer, items, now, lock)
    subtotal = sum((l.line_total for l in lines), Decimal("0.00"))
    priced = Priced(lines=lines, items_subtotal=subtotal, total=subtotal, notes=notes)
    if normalise_code(coupon_code):
        coupon, row, discount = apply_coupon(coupon_code, customer, lines, lock=lock, now=now, delivery_phone=delivery_phone)
        if subtotal - discount < LEAST_TOTAL:
            discount = max(Decimal("0.00"), subtotal - LEAST_TOTAL)
        priced.coupon, priced.code_row, priced.discount = coupon, row, discount
        priced.code_used = normalise_code(coupon_code)
        priced.total = subtotal - discount
    return priced


def create_lines(order, priced):
    """The order's lines from a priced cart (a flash part and a regular part of one cart line
    become two OrderItems)."""
    for line in priced.lines:
        OrderItem.objects.create(
            order=order, listing=line.listing, quantity=line.quantity, unit_price=line.unit_price,
            line_total=line.line_total, flash_sale=line.flash_sale,
        )


def record_redemption(order, priced, customer):
    """Called in the order transaction, with the coupon row still locked. Pauses the coupon when
    its budget is reached and ends it when its uses are gone."""
    if priced.coupon is None:
        return None
    redemption = CouponRedemption.objects.create(
        coupon=priced.coupon, code_row=priced.code_row, order=order, customer=customer,
        amount=priced.discount, code_used=priced.code_used,
    )
    coupon = priced.coupon
    if coupon.cost_to_date() >= coupon.budget_cap:
        pause(coupon, "Budget cap reached")
    elif coupon.uses() >= coupon.usage_limit:
        coupon.status = Coupon.EXPIRED
        coupon.save(update_fields=["status", "updated_at"])
    return redemption


def pause(coupon, reason):
    coupon.status = Coupon.PAUSED
    coupon.paused_reason = reason[:200]
    coupon.paused_at = timezone.now()
    coupon.save(update_fields=["status", "paused_reason", "paused_at", "updated_at"])
    notify_staff_role("coupons.manage", "coupon_paused", f"Coupon {coupon.code} paused: {reason}", link="/staff?tab=mk-coupons", icon="🏷️")


def release_order(order_id):
    """Payment failed or expired for an order priced here: give the coupon use back and cancel the
    order so the sale stock it held is free again. Idempotent."""
    order = Order.objects.select_for_update().get(pk=order_id)
    if order.status == Order.PAID:
        return
    CouponRedemption.objects.filter(order=order, released_at__isnull=True).update(released_at=timezone.now())
    if order.status != Order.CANCELLED:
        order.status = Order.CANCELLED
        order.save(update_fields=["status"])


# ─── what the customer is shown ──────────────────────────────────────────────
def quote_data(priced):
    return {
        "enabled": True,
        "lines": [
            {
                "listing": l.listing.pk, "listing_name": l.listing.name, "quantity": l.quantity,
                "unit_price": money(l.unit_price), "line_total": str(l.line_total),
                "flash_sale": l.flash_sale.name if l.flash_sale else None,
            }
            for l in priced.lines
        ],
        "items_subtotal": money(priced.items_subtotal),
        "coupon": {"code": priced.code_used, "discount": money(priced.discount)} if priced.coupon else None,
        "discount": money(priced.discount),
        "total": money(priced.total),
        "notes": priced.notes,
    }
