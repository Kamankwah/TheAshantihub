"""Sales, revenue and marketplace figures, counted from records only.

Sales are money customers paid to businesses (orders, bookings, service
requests, event tickets); revenue is what AshantiHub itself kept (plan fees,
paid promotions, hero placements, event fees). Both come from successful
payments (`payments.CheckoutSession`) plus the listing-promotion payments that
still book a `billing.Transaction` directly. While PAYMENTS_PROVIDER is not
"hubtel" every payment is simulated, and the screens say so. There is no
commission on sales, delivery fee or VAT record anywhere, so nothing here
invents one."""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from billing.models import Transaction
from bookings.models import Booking
from disputes.models import Dispute
from events.models import Event, EventTicketType, Ticket
from listings.models import Category, Listing, Promotion, Zone
from orders.models import OrderItem
from payments.models import CheckoutSession
from reports.providers import day_bounds
from services.models import ServiceRequest

ZERO = Decimal("0.00")
SALES_KINDS = (
    CheckoutSession.ORDER_CHECKOUT, CheckoutSession.BOOKING, CheckoutSession.SERVICE_REQUEST, CheckoutSession.TICKET_PURCHASE,
)
# (key, label, what it is, checkout kinds)
REVENUE_TYPES = [
    ("subscriptions", "Subscriptions", "Plan fees paid by businesses", (CheckoutSession.SUBSCRIPTION,)),
    ("promotions", "Promotions", "Featured and Boost listings", (CheckoutSession.LISTING_PROMOTION,)),
    ("hero", "Hero placements", "Homepage hero extensions", (CheckoutSession.HERO_EXTEND,)),
    ("event_fees", "Event fees", "Paid event listings and renewals", (CheckoutSession.EVENT_PAY, CheckoutSession.EVENT_RENEW)),
]
KIND_TO_TYPE = {kind: key for key, _l, _n, kinds in REVENUE_TYPES for kind in kinds}
PROMO_PREFIX = "AH-PROMO-"
NOT_RECORDED = [
    {"name": "Commission on sales", "why": "AshantiHub does not take a commission on sales, so none is recorded."},
    {"name": "Delivery fees", "why": "Delivery fees are not charged yet, so there is nothing to show after rider pay."},
    {"name": "VAT", "why": "No tax is calculated anywhere yet; it waits for the accountant."},
]


def simulated():
    return settings.PAYMENTS_PROVIDER != "hubtel"


def money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.01")))


def window(start, end):
    """Aware [low, high) datetimes covering the local days start..end."""
    return day_bounds(start, end)


def month_start(day):
    return day.replace(day=1)


def add_months(day, months):
    index = day.year * 12 + day.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def month_end(day):
    return add_months(month_start(day), 1) - timedelta(days=1)


def last_months(today, count=6):
    """The first day of each of the last `count` months, oldest first, ending with today's."""
    first = month_start(today)
    return [add_months(first, -i) for i in range(count - 1, -1, -1)]


# ---------------------------------------------------------------- attribution

class Lookups:
    """Zone and category for the thing a payment was for, fetched in batches."""

    def __init__(self, sessions):
        meta = lambda s, key: s.metadata.get(key)  # noqa: E731
        by_kind = defaultdict(list)
        for s in sessions:
            by_kind[s.kind].append(s)
        ids = lambda kind, key: {int(v) for s in by_kind[kind] if (v := meta(s, key)) not in (None, "")}  # noqa: E731
        self.order_lines = defaultdict(list)
        for item in OrderItem.objects.filter(order_id__in=ids(CheckoutSession.ORDER_CHECKOUT, "order_id")).select_related("listing"):
            self.order_lines[item.order_id].append(item)
        self.bookings = {b.pk: b for b in Booking.objects.filter(pk__in=ids(CheckoutSession.BOOKING, "booking_id")).select_related("listing")}
        self.requests = {r.pk: r for r in ServiceRequest.objects.filter(pk__in=ids(CheckoutSession.SERVICE_REQUEST, "service_request_id")).select_related("listing")}
        self.ticket_types = {t.pk: t for t in EventTicketType.objects.filter(pk__in=ids(CheckoutSession.TICKET_PURCHASE, "ticket_type_id")).select_related("event")}
        event_ids = ids(CheckoutSession.EVENT_PAY, "event_id") | ids(CheckoutSession.EVENT_RENEW, "event_id")
        self.events = {e.pk: e for e in Event.objects.filter(pk__in=event_ids)}
        owner_ids = {s.business_owner_id for s in sessions if s.business_owner_id}
        self.profiles = {p.business_owner_id: p for p in BusinessOwnerProfile.objects.filter(business_owner_id__in=owner_ids)}

    def parts(self, session):
        """[(zone_id, category_id, amount)] for one successful payment."""
        kind, meta = session.kind, session.metadata
        try:
            if kind == CheckoutSession.ORDER_CHECKOUT:
                lines = self.order_lines.get(int(meta.get("order_id")), [])
                if lines:
                    return [(i.listing.zone_id, i.listing.category_id, i.line_total) for i in lines]
            elif kind == CheckoutSession.BOOKING:
                b = self.bookings.get(int(meta.get("booking_id")))
                if b:
                    return [(b.listing.zone_id, b.listing.category_id, session.amount)]
            elif kind == CheckoutSession.SERVICE_REQUEST:
                r = self.requests.get(int(meta.get("service_request_id")))
                if r:
                    return [(r.listing.zone_id, r.listing.category_id, session.amount)]
            elif kind == CheckoutSession.TICKET_PURCHASE:
                t = self.ticket_types.get(int(meta.get("ticket_type_id")))
                if t:
                    return [(t.event.zone_id, t.event.category_id, session.amount)]
            elif kind in (CheckoutSession.EVENT_PAY, CheckoutSession.EVENT_RENEW):
                e = self.events.get(int(meta.get("event_id")))
                if e:
                    return [(e.zone_id, e.category_id, session.amount)]
            elif session.business_owner_id:
                p = self.profiles.get(session.business_owner_id)
                if p:
                    return [(p.zone_id, p.business_category_id, session.amount)]
        except (TypeError, ValueError):
            pass
        return [(None, None, session.amount)]


def _promotion_parts(transactions):
    """Listing promotions still book a Transaction directly (reference
    AH-PROMO-<promotion id>-...); the promotion names the listing."""
    ids = {}
    for t in transactions:
        try:
            ids[t.pk] = int(t.reference[len(PROMO_PREFIX):].split("-")[0])
        except ValueError:
            continue
    promos = {p.pk: p for p in Promotion.objects.filter(pk__in=set(ids.values())).select_related("listing")}
    out = {}
    for t in transactions:
        promo = promos.get(ids.get(t.pk))
        out[t.pk] = [(promo.listing.zone_id, promo.listing.category_id, t.amount)] if promo else [(None, None, t.amount)]
    return out


def sales_lines(start, end):
    """[{kind, amount, zone, category, customer, created}] for each part of every
    successful sales payment in the window."""
    low, high = window(start, end)
    sessions = list(CheckoutSession.objects.filter(status=CheckoutSession.SUCCESS, kind__in=SALES_KINDS, created_at__gte=low, created_at__lt=high))
    look = Lookups(sessions)
    lines = []
    for s in sessions:
        for zone, category, amount in look.parts(s):
            lines.append({"session": s.pk, "kind": s.kind, "amount": amount, "zone": zone, "category": category, "customer": s.customer_id, "at": s.created_at})
    return lines, len(sessions)


def revenue_lines(start, end):
    low, high = window(start, end)
    sessions = list(CheckoutSession.objects.filter(status=CheckoutSession.SUCCESS, kind__in=list(KIND_TO_TYPE), created_at__gte=low, created_at__lt=high))
    look = Lookups(sessions)
    lines = []
    for s in sessions:
        for zone, category, amount in look.parts(s):
            lines.append({"type": KIND_TO_TYPE[s.kind], "amount": amount, "zone": zone, "category": category, "at": s.created_at})
    promo_tx = list(Transaction.objects.filter(
        status=Transaction.SUCCESS, reference__startswith=PROMO_PREFIX, created_at__gte=low, created_at__lt=high,
    ))
    parts = _promotion_parts(promo_tx)
    for t in promo_tx:
        for zone, category, amount in parts[t.pk]:
            lines.append({"type": "promotions", "amount": amount, "zone": zone, "category": category, "at": t.created_at})
    return lines


def refunds_total(start, end):
    """(amount, count) recorded as refunded in the window: resolved disputes
    with a refund amount, and refunded event tickets."""
    low, high = window(start, end)
    disputes = Dispute.objects.filter(status=Dispute.RESOLVED, refund_amount__gt=0, updated_at__gte=low, updated_at__lt=high)
    tickets = Ticket.objects.filter(refunded_at__gte=low, refunded_at__lt=high)
    d = disputes.aggregate(total=Sum("refund_amount"), n=Count("id"))
    t = tickets.aggregate(total=Sum("price"), n=Count("id"))
    return (d["total"] or ZERO) + (t["total"] or ZERO), (d["n"] or 0) + (t["n"] or 0)


def _filtered(lines, zone, category):
    return [l for l in lines if (zone is None or l["zone"] == zone) and (category is None or l["category"] == category)]


def _total(lines):
    return sum((l["amount"] for l in lines), ZERO)


def revenue_report(start, end, *, zone=None, category=None, today=None):
    today = today or timezone.localdate()
    span = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)
    sales, sales_count = sales_lines(start, end)
    sales = _filtered(sales, zone, category)
    revenue = _filtered(revenue_lines(start, end), zone, category)
    previous = _filtered(revenue_lines(prev_start, prev_end), zone, category)
    sales_total, revenue_total = _total(sales), _total(revenue)
    refunded, refund_n = refunds_total(start, end)
    types = []
    for key, label, note, _kinds in REVENUE_TYPES:
        types.append({
            "key": key, "label": label, "note": note,
            "amount": money(_total([l for l in revenue if l["type"] == key])),
            "previous": money(_total([l for l in previous if l["type"] == key])),
        })
    months = []
    for first in last_months(end, 6):
        last = min(month_end(first), end if month_start(end) == first else month_end(first))
        month_lines = _filtered(revenue_lines(first, last), zone, category)
        months.append({
            "month": first.strftime("%Y-%m"), "label": first.strftime("%b %Y"), "days": (last - first).days + 1,
            "partial": last < month_end(first), "total": money(_total(month_lines)),
            "by_type": {key: money(_total([l for l in month_lines if l["type"] == key])) for key, *_ in REVENUE_TYPES},
        })
    zones = {z.pk: z.name for z in Zone.objects.all()}
    cats = {c.pk: c.label for c in Category.objects.all()}
    by_zone = defaultdict(lambda: {"sales": ZERO, "orders": set(), "revenue": ZERO})
    for l in sales:
        row = by_zone[l["zone"]]
        row["sales"] += l["amount"]
        row["orders"].add(l["session"])
    for l in revenue:
        by_zone[l["zone"]]["revenue"] += l["amount"]
    active = dict(
        BusinessOwnerProfile.objects.filter(business_owner__kyc_status=BusinessOwner.VERIFIED, business_owner__is_suspended=False)
        .values_list("zone").annotate(n=Count("id")).values_list("zone", "n")
    )
    zone_rows = [
        {"zone_id": z, "zone": zones.get(z, "No zone recorded"), "sales": money(v["sales"]), "orders": len(v["orders"]), "revenue": money(v["revenue"]), "businesses": active.get(z, 0)}
        for z, v in by_zone.items()
    ]
    zone_rows.sort(key=lambda r: -Decimal(r["sales"]))
    by_cat = defaultdict(lambda: {"sales": ZERO, "orders": set()})
    for l in sales:
        by_cat[l["category"]]["sales"] += l["amount"]
        by_cat[l["category"]]["orders"].add(l["session"])
    top = max([v["sales"] for v in by_cat.values()] or [ZERO])
    cat_rows = [
        {"category_id": c, "category": cats.get(c, "No category recorded"), "sales": money(v["sales"]), "orders": len(v["orders"]),
         "share": float(round(v["sales"] / top, 4)) if top else 0}
        for c, v in by_cat.items()
    ]
    cat_rows.sort(key=lambda r: -Decimal(r["sales"]))
    return {
        "from": start, "to": end, "previous": {"from": prev_start, "to": prev_end}, "simulated": simulated(),
        "partial_days": span if end >= today else None,
        "kpis": {
            "sales": money(sales_total), "orders": sales_count if zone is None and category is None else len({l["session"] for l in sales}),
            "average": money(sales_total / len({l["session"] for l in sales})) if sales else None,
            "revenue": money(revenue_total),
            "revenue_share": round(float(revenue_total / sales_total * 100), 1) if sales_total else None,
            "refunded": money(refunded), "refunds": refund_n,
            "refund_share": round(float(refunded / sales_total * 100), 1) if sales_total else None,
        },
        "types": types, "months": months, "zones": zone_rows, "categories": cat_rows, "not_recorded": NOT_RECORDED,
        "zone_options": [{"id": k, "name": v} for k, v in sorted(zones.items(), key=lambda kv: kv[1])],
        "category_options": [{"id": k, "name": v} for k, v in sorted(cats.items(), key=lambda kv: kv[1])],
    }


# ------------------------------------------------------------------ analytics

def _buyers(low, high):
    """customer id -> number of successful sales payments in the window."""
    rows = (
        CheckoutSession.objects.filter(status=CheckoutSession.SUCCESS, kind__in=SALES_KINDS, customer__isnull=False, created_at__gte=low, created_at__lt=high)
        .values("customer").annotate(n=Count("id"))
    )
    return {r["customer"]: r["n"] for r in rows}


def repeat_rate(end):
    """Of the customers who bought in the 90 days to `end`, the share who
    bought more than once up to `end` (counted: ordered, booked or bought a
    ticket). (repeaters, buyers) or None when nobody bought."""
    _, high = window(end, end)
    low = high - timedelta(days=90)
    buyers = _buyers(low, high)
    if not buyers:
        return None
    totals = dict(
        CheckoutSession.objects.filter(status=CheckoutSession.SUCCESS, kind__in=SALES_KINDS, customer_id__in=list(buyers), created_at__lt=high)
        .values_list("customer").annotate(n=Count("id")).values_list("customer", "n")
    )
    return sum(1 for c in buyers if totals.get(c, 0) > 1), len(buyers)


def analytics_report(*, zone=None, today=None):
    today = today or timezone.localdate()
    months = []
    for first in last_months(today, 6):
        last = min(month_end(first), today)
        _, high = window(last, last)
        low, _ = window(first, last)
        lines, count = sales_lines(first, last)
        lines = _filtered(lines, zone, None)
        sessions = len({l["session"] for l in lines})
        owners = BusinessOwner.objects.filter(kyc_status=BusinessOwner.VERIFIED, is_suspended=False, created_at__lt=high)
        if zone is not None:
            owners = owners.filter(profile__zone_id=zone)
        rate = repeat_rate(last)
        months.append({
            "month": first.strftime("%Y-%m"), "label": first.strftime("%b %Y"), "partial": last < month_end(first), "days": (last - first).days + 1,
            "businesses": owners.count(),
            "customers": Customer.objects.filter(created_at__gte=low, created_at__lt=high).count(),
            "orders": sessions, "gmv": money(_total(lines)),
            "repeat_rate": round(rate[0] / rate[1] * 100, 1) if rate else None,
        })
    first = month_start(today)
    lines, _count = sales_lines(first, today)
    zones = {z.pk: z.name for z in Zone.objects.all()}
    _, high = window(today, today)
    ninety = high - timedelta(days=90)
    buyers_by_zone = defaultdict(set)
    sessions = list(CheckoutSession.objects.filter(status=CheckoutSession.SUCCESS, kind__in=SALES_KINDS, customer__isnull=False, created_at__gte=ninety, created_at__lt=high))
    look = Lookups(sessions)
    for s in sessions:
        for z, _c, _a in look.parts(s):
            buyers_by_zone[z].add(s.customer_id)
    ever = defaultdict(lambda: defaultdict(int))
    if sessions:
        history = list(CheckoutSession.objects.filter(status=CheckoutSession.SUCCESS, kind__in=SALES_KINDS, customer_id__in={s.customer_id for s in sessions}, created_at__lt=high))
        hist_look = Lookups(history)
        for s in history:
            for z in {z for z, _c, _a in hist_look.parts(s)}:
                ever[z][s.customer_id] += 1
    month_by_zone = defaultdict(lambda: {"gmv": ZERO, "orders": set()})
    for l in lines:
        month_by_zone[l["zone"]]["gmv"] += l["amount"]
        month_by_zone[l["zone"]]["orders"].add(l["session"])
    active = dict(
        BusinessOwnerProfile.objects.filter(business_owner__kyc_status=BusinessOwner.VERIFIED, business_owner__is_suspended=False)
        .values_list("zone").annotate(n=Count("id")).values_list("zone", "n")
    )
    zone_ids = set(month_by_zone) | set(buyers_by_zone) | set(active)
    zone_rows = []
    for z in zone_ids:
        buyers = buyers_by_zone.get(z, set())
        repeaters = sum(1 for c in buyers if ever[z].get(c, 0) > 1)
        zone_rows.append({
            "zone_id": z, "zone": zones.get(z, "No zone recorded"), "businesses": active.get(z, 0), "buyers": len(buyers),
            "orders": len(month_by_zone[z]["orders"]) if z in month_by_zone else 0,
            "gmv": money(month_by_zone[z]["gmv"]) if z in month_by_zone else money(0),
            "repeat_rate": round(repeaters / len(buyers) * 100, 1) if buyers else None,
        })
    zone_rows = [r for r in zone_rows if zone is None or r["zone_id"] == zone]
    zone_rows.sort(key=lambda r: (-Decimal(r["gmv"]), r["zone"]))
    now_rate = repeat_rate(today)
    all_buyers = _buyers(ninety, high)
    published = Listing.objects.filter(status=Listing.PUBLISHED)
    return {
        "simulated": simulated(), "months": months, "zones": zone_rows,
        "kpis": {
            "businesses": BusinessOwner.objects.filter(kyc_status=BusinessOwner.VERIFIED, is_suspended=False).count(),
            "customers": Customer.objects.count(), "customers_ordered_90": len(all_buyers),
            "orders": months[-1]["orders"], "gmv": months[-1]["gmv"],
            "repeat_rate": round(now_rate[0] / now_rate[1] * 100, 1) if now_rate else None,
            "repeaters": now_rate[0] if now_rate else None, "buyers": now_rate[1] if now_rate else None,
            "listings_live": published.count(), "categories_live": published.values("category").distinct().count(),
        },
        "not_measured": [
            {"name": "Site visits and conversion", "why": "No web analytics tool is connected, so visits to orders can't be counted."},
            {"name": "Customer satisfaction", "why": "Arrives with the support desk's after-chat rating."},
            {"name": "Delivery on-time rate", "why": "Arrives with rider check-ins and delivery codes."},
            {"name": "Where customers came from", "why": "Campaign tracking isn't built yet, so no channel gets credit."},
        ],
        "zone_options": [{"id": k, "name": v} for k, v in sorted(zones.items(), key=lambda kv: kv[1])],
    }
