"""GET /api/marketing/overview/ (canvas 01). Real figures only.

Each later package (campaigns, consent, coupons, banners) owns one function below and
replaces its "not tracked yet" answer with real counts; until then the screen says so
instead of showing a number. Nothing is estimated or filled in."""
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Min, Sum
from django.utils import timezone

from approvals.models import ApprovalRequest
from core import integrations
from events.models import Event
from listings.models import HeroMediaSubmission, Promotion

from . import policy as policy_rules
from . import promos

PERIODS = (7, 30)

NOT_TRACKED = "not_tracked"


def _money(value):
    return str((value or Decimal("0")).quantize(Decimal("0.01")))


def channels():
    """Per-channel connection state, from core.integrations (read-only, no secrets)."""
    by_key = {item["key"]: item for item in integrations.statuses()}
    out = []
    for key, name in (("sms", "SMS"), ("whatsapp", "WhatsApp"), ("email", "Email")):
        item = by_key[key]
        out.append({"key": key, "name": name, "status": item["status"], "provider": item["provider"], "summary": item["summary"]})
    # In-app notices are created by the app itself and need no provider.
    out.append({"key": "inapp", "name": "In-app", "status": "connected", "provider": "AshantiHub", "summary": "Shown to people the next time they open the app."})
    return out


def promotion_revenue(since, until):
    rows = Promotion.objects.filter(status=Promotion.ACTIVE, starts_at__gte=since, starts_at__lte=until)
    totals = rows.aggregate(total=Sum("amount_paid"))
    return {"amount": _money(totals["total"]), "count": rows.count(), "businesses": rows.values("listing__business_owner_id").distinct().count()}


def queues(user):
    """What waits for this person to review, with the oldest age. A queue the caller may not read is left out."""
    held = user.effective_permission_codenames()
    out = []
    if "hero_media.approve" in held:
        rows = HeroMediaSubmission.objects.filter(status=HeroMediaSubmission.PENDING)
        out.append({"key": "hero", "title": "Hero approval", "count": rows.count(), "oldest": rows.aggregate(o=Min("submitted_at"))["o"]})
    if "event.approve" in held:
        rows = Event.objects.filter(status=Event.PENDING)
        out.append({"key": "events-moderation", "title": "Events", "count": rows.count(), "oldest": rows.aggregate(o=Min("created_at"))["o"]})
    if "promotions.manage" in held:
        rows = Promotion.objects.filter(status=Promotion.PENDING)
        out.append({"key": "promotions", "title": "Promotions", "count": rows.count(), "oldest": rows.aggregate(o=Min("created_at"))["o"]})
    return out


def waiting_on_others(user):
    rows = ApprovalRequest.objects.filter(maker=user, status=ApprovalRequest.PENDING, kind__startswith="marketing.").order_by("created_at")[:6]
    return [{"id": a.pk, "title": a.title, "created_at": a.created_at, "kind": a.kind, "waiting_on": "Super Admin"} for a in rows]


# ─── Sections later packages fill in ─────────────────────────────────────────
def messages_section(since, until):
    """Delivered by channel. Filled by the campaigns package."""
    return {"state": NOT_TRACKED, "note": "No campaigns have been sent yet.", "by_channel": []}


def opt_ins_section(since, until):
    """Net new opt-ins from the consent ledger: lines added in the window (a person who ticks then stops counts once each way)."""
    from .models_consent import ConsentRecord

    rows = ConsentRecord.objects.filter(at__gte=since, at__lte=until)
    joined, left = rows.filter(status=ConsentRecord.OPTED_IN).count(), rows.filter(status=ConsentRecord.OPTED_OUT).count()
    if not ConsentRecord.objects.exists():
        return {"state": NOT_TRACKED, "note": "No opt-ins recorded yet. Opt-in appears on sign-up and Settings."}
    return {"state": "ok", "joined": joined, "left": left, "net": joined - left}


def orders_section(since, until):
    """Orders from campaign links. Filled by the campaigns package."""
    return {"state": NOT_TRACKED, "note": "Not tracked: no campaign link has been clicked yet."}


def coupons_section(since, until):
    """Coupon redemptions and discount cost, from real redemptions only."""
    from .models_promos import Coupon, CouponRedemption

    if not Coupon.objects.exists():
        return {"state": NOT_TRACKED, "note": "No coupons yet."}
    rows = CouponRedemption.objects.filter(released_at__isnull=True, created_at__gte=since, created_at__lte=until)
    totals = rows.aggregate(n=Count("id"), cost=Sum("amount"))
    live = [c for c in Coupon.objects.filter(status=Coupon.ACTIVE) if c.effective_status() == Coupon.ACTIVE]
    return {
        "state": "ok", "live": len(live), "redeemed": totals["n"] or 0, "cost": _money(totals["cost"]),
        "waiting": Coupon.objects.filter(status=Coupon.WAITING).count(),
        "note": "" if promos.enabled() else "Checkout promotions are switched off, so no code can be used yet.",
    }


def banners_section(since, until):
    """Banner click-through, from the first-party counters of banners live in the period."""
    from . import banners as banner_rules
    from .models_banners import Banner

    if not Banner.objects.exclude(state=Banner.DRAFT).exists():
        return {"state": NOT_TRACKED, "note": "No banners yet."}
    live, views, clicks = banner_rules.totals(since, until)
    return {
        "state": "ok", "live": live, "views": views, "clicks": clicks, "ctr": banner_rules.ctr(views, clicks),
        "note": "Counted by this site's own pages since banners launched; lifetime counts of the banners that ran in this period.",
    }


def scheduled_next(until_days=14):
    """Campaigns, flash sales and banners coming up. Each package adds its own entries."""
    from .models_promos import FlashSale

    now = timezone.now()
    out = []
    for sale in FlashSale.objects.filter(status__in=(FlashSale.SCHEDULED, FlashSale.WAITING), starts_at__gte=now, starts_at__lte=now + timedelta(days=until_days)).order_by("starts_at"):
        out.append({"at": sale.starts_at, "kind": "flash_sale", "what": f"Flash sale: {sale.name}", "status": "Scheduled" if sale.status == FlashSale.SCHEDULED else "Waiting for sellers",
                    "tone": "ok" if sale.status == FlashSale.SCHEDULED else "warn"})
    from . import banners as banner_rules

    out.extend(banner_rules.upcoming(until_days))
    return out


def overview(user, days=7):
    days = days if days in PERIODS else 7
    until = timezone.now()
    since = until - timedelta(days=days)
    return {
        "now": until, "days": days, "since": since,
        "channels": channels(),
        "messages": messages_section(since, until),
        "opt_ins": opt_ins_section(since, until),
        "orders": orders_section(since, until),
        "coupons": coupons_section(since, until),
        "banners": banners_section(since, until),
        "promotions": promotion_revenue(since, until),
        "scheduled_next": scheduled_next(),
        "queues": queues(user),
        "waiting_on_others": waiting_on_others(user),
        "policy": policy_rules.serialize(),
        "threshold": _money(policy_rules.approval_threshold()),
        "simulated_payments": True,
    }
