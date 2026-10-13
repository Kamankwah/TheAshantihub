"""The Marketing role's "From the system" sections of a staff report (canvas
22). Counted from source records over the whole local days start..end; the
snapshot taken on submit freezes them. Called by reports.providers.

Only what exists is counted: hero, event and promotion decisions, the live
promotions and what they earned. Campaign, coupon, flash-sale and banner
figures are NOT here and are not invented. Each of those packages adds its own
rows by appending a function to EXTRA_SECTIONS (see below); a function there
takes (staff, start, end) and returns a list of section dicts of the same shape
(`{"key", "title", "rows": [{"label", "value"}]}`), or [] while it has nothing
real to say.

Hooks still owed (the package that lands each one adds its function):
  - campaigns: sent / delivered / failed by channel, cost (Campaign, CampaignRecipient)
  - consent: opt-ins and opt-outs recorded in the period (ConsentRecord)
  - coupons: redemptions and discount cost (CouponRedemption)
  - flash sales: sales run and units sold
  - banners: views and clicks (first-party counters)
"""
from django.utils import timezone

from reports.providers import day_bounds

EXTRA_SECTIONS = []

# Verbs StaffActivityMiddleware writes for the promotion decision endpoints (the url names).
PROMOTION_APPROVED_VERB = "promotion-approve"
PROMOTION_REJECTED_VERB = "promotion-reject"


def marketing_sections(staff, start, end):
    from activity.models import ActivityEvent
    from events.models import Event
    from listings.models import HeroMediaSubmission, Promotion

    from .overview import promotion_revenue

    low, high = day_bounds(start, end)

    def decided(model, approved, rejected):
        rows = model.objects.filter(reviewed_by=staff, reviewed_at__gte=low, reviewed_at__lt=high)
        return rows.filter(status=approved).count(), rows.filter(status=rejected).count()

    hero_ok, hero_no = decided(HeroMediaSubmission, HeroMediaSubmission.APPROVED, HeroMediaSubmission.REJECTED)
    event_ok, event_no = decided(Event, Event.APPROVED, Event.REJECTED)
    promo_events = ActivityEvent.objects.filter(
        actor_type=ActivityEvent.STAFF, actor_id=staff.pk, occurred_at__gte=low, occurred_at__lt=high,
    )
    promo_ok = promo_events.filter(verb=PROMOTION_APPROVED_VERB).count()
    promo_no = promo_events.filter(verb=PROMOTION_REJECTED_VERB).count()

    now = timezone.now()
    live = Promotion.objects.filter(status=Promotion.ACTIVE, starts_at__lte=now, ends_at__gte=now).count()
    revenue = promotion_revenue(low, high)

    sections = [
        {
            "key": "marketing_moderation",
            "title": "Moderation decided by you",
            "rows": [
                {"label": "Hero approved", "value": hero_ok},
                {"label": "Hero rejected", "value": hero_no},
                {"label": "Events approved", "value": event_ok},
                {"label": "Events rejected", "value": event_no},
                {"label": "Promotions approved", "value": promo_ok},
                {"label": "Promotions rejected", "value": promo_no},
            ],
        },
        {
            "key": "marketing_promotions",
            "title": "Promotions",
            "rows": [
                {"label": "Running now", "value": live},
                {"label": "Approved and started in the period", "value": revenue["count"]},
                {"label": "Promotion revenue (GH₵)", "value": revenue["amount"]},
            ],
        },
    ]
    for extra in EXTRA_SECTIONS:
        sections.extend(extra(staff, start, end))
    return sections
