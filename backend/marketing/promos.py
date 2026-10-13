"""The one switch for checkout promotions, and small shared helpers."""
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings

CENT = Decimal("0.01")


def enabled():
    """settings.MARKETING_PROMOS_ENABLED, read at call time. While False nothing here touches
    checkout, the cart, the public site or an order."""
    return bool(getattr(settings, "MARKETING_PROMOS_ENABLED", False))


def cents(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def money(value):
    return str(cents(value or 0))


# The staff screens say this whenever the switch is off.
OFF_NOTICE = (
    "Discounts are not applied at checkout yet. You can draft, edit and schedule here; "
    "nothing reaches customers until the owner switches checkout promotions on."
)
