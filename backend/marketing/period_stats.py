"""Marketing analytics for a chosen period (canvas 17): 7, 30 or 90 days of
real counts from real tables. Nothing is estimated and nothing is invented: a
figure that has no source says so (`state: "not_tracked"`), and the opt-ins
tile reads the consent ledger only while it exists and holds rows."""
from datetime import timedelta
from decimal import Decimal

from django.apps import apps
from django.db.models import Count
from django.utils import timezone

PERIODS = (7, 30, 90)
DEFAULT_DAYS = 30
NO_OPT_INS = "No opt-ins recorded yet."


def clean_days(raw):
    try:
        days = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return days if days in PERIODS else DEFAULT_DAYS


def opt_ins(since, until):
    """Opt-ins and opt-outs recorded in the window, from marketing.ConsentRecord.
    Imported by name at call time: the consent ledger is a separate package, so
    when its model is absent or empty this answers an honest empty state."""
    try:
        record = apps.get_model("marketing", "ConsentRecord")
    except LookupError:
        return {"state": "not_tracked", "note": NO_OPT_INS}
    rows = record.objects.filter(at__gte=since, at__lt=until)
    if not record.objects.exists():
        return {"state": "not_tracked", "note": NO_OPT_INS}
    by_status = {r["status"]: r["n"] for r in rows.values("status").annotate(n=Count("id"))}
    return {
        "state": "tracked", "opted_in": by_status.get("opted_in", 0), "opted_out": by_status.get("opted_out", 0),
        "note": "Counted from the consent ledger.",
    }


def period_stats(days, now=None):
    from accounts.models import BusinessOwner, Customer
    from events.models import Event
    from listings.models import HeroMediaSubmission, Listing, Promotion
    from orders.models import Order

    from .overview import promotion_revenue

    now = now or timezone.now()
    since = now - timedelta(days=days)
    orders = Order.objects.filter(placed_at__gte=since, placed_at__lt=now)
    promotions = Promotion.objects.filter(created_at__gte=since, created_at__lt=now)
    # Revenue is counted the way the Marketing overview counts it: approved
    # promotions that started in the window, at what the owner paid.
    revenue = promotion_revenue(since, now)
    return {
        "days": days,
        "since": since,
        "until": now,
        "customers": Customer.objects.filter(created_at__gte=since, created_at__lt=now).count(),
        "business_owners": BusinessOwner.objects.filter(created_at__gte=since, created_at__lt=now).count(),
        "listings": Listing.objects.filter(created_at__gte=since, created_at__lt=now).count(),
        "orders": orders.count(),
        "orders_paid": orders.filter(status=Order.PAID).count(),
        "events": Event.objects.filter(created_at__gte=since, created_at__lt=now).count(),
        "hero_submissions": HeroMediaSubmission.objects.filter(submitted_at__gte=since, submitted_at__lt=now).count(),
        "promotions_bought": promotions.count(),
        "promotion_revenue": revenue["amount"],
        "promotions_started": revenue["count"],
        "opt_ins": opt_ins(since, now),
        "marketplace": marketplace(days, now),
    }


ROWS = [
    ("customers", "New customers"),
    ("business_owners", "New business owners"),
    ("listings", "New listings"),
    ("orders", "Orders placed"),
    ("orders_paid", "Orders paid"),
    ("events", "Events submitted"),
    ("hero_submissions", "Hero submissions"),
    ("promotions_bought", "Promotions bought"),
    ("promotions_started", "Promotions approved and started"),
    ("promotion_revenue", "Promotion revenue (GH₵)"),
]


def export_tables(stats):
    from insights import tabular

    rows = [[label, stats[key]] for key, label in ROWS]
    opt = stats["opt_ins"]
    if opt["state"] == "tracked":
        rows += [["Opt-ins recorded", opt["opted_in"]], ["Opt-outs recorded", opt["opted_out"]]]
    else:
        rows.append(["Opt-ins recorded", opt["note"]])
    return tabular.document(
        f"Marketing analytics, last {stats['days']} days",
        [tabular.table("Counts from real records", ["Measure", "Value"], rows)],
        note="Each figure counts rows created in the period. Nothing is estimated.",
    )


# ─── marketplace view (canvas 17): totals, categories, order sources, reachable ──────────────
ATTRIBUTION_DAYS = 7


def marketplace(days, now=None):
    """Totals now, a by-category table for the period, where the period's orders came from, and who is reachable.
    All counted from AshantiHub's own rows; order value is what customers paid (net of any coupon), not AshantiHub's income."""
    from django.db.models import DateTimeField, Exists, ExpressionWrapper, OuterRef, Sum

    from accounts.models import BusinessOwner, Customer
    from bookings.models import Booking
    from events.models import Event
    from listings.models import Category, Listing, Promotion
    from orders.models import Order, OrderItem

    from . import consent
    from .models_campaigns import CampaignRecipient
    from .models_consent import CHANNEL_LABELS, ConsentRecord

    now = now or timezone.now()
    since = now - timedelta(days=days)
    live = Listing.objects.filter(status=Listing.PUBLISHED)
    live_by_cat = dict(live.values_list("category_id").annotate(n=Count("id")))
    lines = OrderItem.objects.filter(order__placed_at__gte=since, order__placed_at__lt=now).exclude(order__status=Order.CANCELLED)
    value_by_cat, orders_by_cat = {}, {}
    for row in lines.values("listing__category_id").annotate(v=Sum("line_total"), n=Count("order_id", distinct=True)):
        value_by_cat[row["listing__category_id"]], orders_by_cat[row["listing__category_id"]] = row["v"] or 0, row["n"]
    bookings_by_cat = dict(Booking.objects.filter(created_at__gte=since, created_at__lt=now).exclude(status=Booking.CANCELLED).values_list("listing__category_id").annotate(n=Count("id")))
    categories = []
    for cat in Category.objects.order_by("label"):
        activity = orders_by_cat.get(cat.pk, 0) + bookings_by_cat.get(cat.pk, 0)
        if live_by_cat.get(cat.pk) or activity:
            categories.append({"id": cat.pk, "name": cat.label, "live_listings": live_by_cat.get(cat.pk, 0), "orders": orders_by_cat.get(cat.pk, 0),
                               "bookings": bookings_by_cat.get(cat.pk, 0), "order_value": str(value_by_cat.get(cat.pk, 0))})
    categories.sort(key=lambda c: -(c["orders"] + c["bookings"]))
    placed = Order.objects.filter(placed_at__gte=since, placed_at__lt=now).exclude(status=Order.CANCELLED)
    clicked = CampaignRecipient.objects.filter(
        customer_id=OuterRef("customer_id"), first_click_at__lte=OuterRef("placed_at"),
        first_click_at__gte=ExpressionWrapper(OuterRef("placed_at") - timedelta(days=ATTRIBUTION_DAYS), output_field=DateTimeField()))
    via_campaign = placed.filter(Exists(clicked))
    via_coupon = placed.exclude(pk__in=via_campaign.values("pk")).filter(coupon__isnull=False)
    total = placed.count()
    reachable = []
    for channel, label in CHANNEL_LABELS.items():
        n = sum(model.objects.annotate(_s=consent.latest_status_subquery(field, channel)).filter(_s=ConsentRecord.OPTED_IN).count()
                for model, field in ((Customer, "customer"), (BusinessOwner, "business_owner")))
        reachable.append({"channel": channel, "label": label, "opted_in": n})
    ts = timezone.now()
    return {
        "totals": {
            "businesses": BusinessOwner.objects.count(), "businesses_verified": BusinessOwner.objects.filter(kyc_status=BusinessOwner.VERIFIED).count(),
            "live_listings": live.count(), "customers": Customer.objects.count(),
            "live_events": Event.objects.filter(status=Event.APPROVED).count(),
            "active_promotions": Promotion.objects.filter(status=Promotion.ACTIVE, starts_at__lte=ts, ends_at__gte=ts).count(),
        },
        "categories": categories,
        "category_totals": {"live_listings": sum(c["live_listings"] for c in categories), "orders": sum(c["orders"] for c in categories), "bookings": sum(c["bookings"] for c in categories),
                            "order_value": str(sum((Decimal(c["order_value"]) for c in categories), Decimal("0")))},
        "sources": {"orders": total, "campaign": via_campaign.count(), "campaign_value": str(via_campaign.aggregate(v=Sum("total_amount"))["v"] or 0),
                    "coupon": via_coupon.count(), "other": total - via_campaign.count() - via_coupon.count()},
        "reachable": reachable,
        "order_value": str(placed.aggregate(v=Sum("total_amount"))["v"] or 0),
    }
