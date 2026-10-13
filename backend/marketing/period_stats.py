"""Marketing analytics for a chosen period (canvas 17): 7, 30 or 90 days of
real counts from real tables. Nothing is estimated and nothing is invented: a
figure that has no source says so (`state: "not_tracked"`), and the opt-ins
tile reads the consent ledger only while it exists and holds rows."""
from datetime import timedelta

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
