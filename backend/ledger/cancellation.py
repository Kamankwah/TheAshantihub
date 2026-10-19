"""Vendor-chosen cancellation policies (Plan 7E): data, not code. A policy is a list of tiers [hours before start,
share in basis points]; the customer gets the share of the first tier they are still inside (the cut-off instant itself
is inside: the boundary favours the customer), and nothing after the last tier. 10000 basis points is the whole price.

The policy a sale was paid under is copied onto the sale (`snapshot`, BookingSale.policy_snapshot), so a later edit by
the vendor never changes it."""
from datetime import timedelta

FLEXIBLE, MODERATE, STRICT, NONE = "flexible", "moderate", "strict", "none"
CHOICES = [(FLEXIBLE, "Flexible"), (MODERATE, "Moderate"), (STRICT, "Strict")]
WHOLE = 10000

POLICIES = {
    FLEXIBLE: {"label": "Flexible", "tiers": [[24, 10000]], "text": "Full refund until 24 hours before the start."},
    MODERATE: {
        "label": "Moderate", "tiers": [[120, 10000], [24, 5000]],
        "text": "Full refund until 5 days before the start, half until 24 hours before.",
    },
    STRICT: {"label": "Strict", "tiers": [[168, 5000]], "text": "Half refunded until 7 days before the start, nothing after."},
    NONE: {"label": "No refunds", "tiers": [], "text": "No refunds after purchase, except for a cancelled event."},
}


def until_days_before(days):
    """A ticket policy for an organiser who offers refunds up to `days` days before the event."""
    return {"policy": "organiser", "tiers": [[days * 24, WHOLE]], "text": f"Full refund until {days} day{'s' if days != 1 else ''} before the event."}


def snapshot(name):
    """The policy `name` as stored on a sale."""
    policy = POLICIES[name]
    return {"policy": name, "tiers": [list(tier) for tier in policy["tiers"]], "text": policy["text"]}


def refund_share(policy, start, at):
    """Basis points of the price the customer gets back when cancelling at `at` a booking that starts at `start`. `policy`
    is a name or a stored snapshot. No start (a service has no scheduled time) is the whole price: it is cancelled before
    it is done, never after."""
    tiers = POLICIES[policy]["tiers"] if isinstance(policy, str) else policy["tiers"]
    if start is None:
        return WHOLE
    for hours, share in sorted(tiers, key=lambda tier: -tier[0]):
        if at <= start - timedelta(hours=hours):
            return share
    return 0
