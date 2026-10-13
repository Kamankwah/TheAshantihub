"""What a campaign is expected to cost, for the GH₵ approval limit.

There is no SMS or WhatsApp provider, so there is no real price. The estimate uses
a per-message price set on the server (settings.MARKETING_UNIT_PRICE, GH₵); a channel
with no price set is "unknown" and an unknown estimate is treated as over the limit
(fail closed). In-app and email messages cost nothing to send."""
from decimal import Decimal

from django.conf import settings

CHANNELS = ("sms", "whatsapp", "email", "inapp")
FREE_CHANNELS = ("email", "inapp")


def unit_price(channel):
    """GH₵ per message, or None when no price is configured."""
    if channel in FREE_CHANNELS:
        return Decimal("0")
    raw = (getattr(settings, "MARKETING_UNIT_PRICE", {}) or {}).get(channel)
    return None if raw in (None, "") else Decimal(str(raw))


def estimate(channel, recipients):
    """(amount, known): the expected GH₵ cost and whether it rests on a real price."""
    price = unit_price(channel)
    if price is None:
        return Decimal("0"), False
    return (price * recipients).quantize(Decimal("0.01")), True


def needs_approval(channel, recipients, threshold):
    amount, known = estimate(channel, recipients)
    return (not known) or amount > threshold
