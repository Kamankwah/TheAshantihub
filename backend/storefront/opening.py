"""The marketplace opening gate. Before `opens_at` a Customer can browse but not buy; businesses, staff and the
allowlisted test customers are unaffected. The whole gate is behind MARKETPLACE_GATE_ENABLED (default off):
while off the marketplace is open to everyone."""
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.utils import timezone

ACCRA = ZoneInfo("Africa/Accra")
OPENING_DEFAULT = datetime(2026, 11, 6, 6, 0, tzinfo=ACCRA)  # documents the seeded row (migration 0002 holds its own literal)


class OpeningError(Exception):
    """A delay that cannot be made; the message is shown to the Super Admin."""


def gate_enabled():
    return bool(getattr(settings, "MARKETPLACE_GATE_ENABLED", False))


def _current():
    from .models import OpeningTime

    return OpeningTime.objects.first()


def opens_at():
    return _current().opens_at


def _real_open(now):
    return now >= opens_at()


def is_open(now=None):
    if not gate_enabled():
        return True
    return _real_open(now or timezone.now())


def can_buy(user, now=None):
    from accounts.models import Customer

    from .models import TestAccount

    if is_open(now):
        return True
    if not isinstance(user, Customer):
        return user is not None  # a business owner or staff member; anonymous cannot buy
    return TestAccount.objects.filter(customer=user).exists()


def opening_message(when):
    local = when.astimezone(ACCRA)
    return f"The marketplace opens on {local.day} {local:%b %Y} at {local:%H:%M}."


@transaction.atomic
def delay(staff, new_opens_at, reason, now=None):
    from .models import OpeningTime

    now = now or timezone.now()
    reason = (reason or "").strip()
    if not reason:
        raise OpeningError("Say why the opening is being moved.")
    if _real_open(now):
        raise OpeningError("The marketplace is already open, so it cannot be delayed.")
    if new_opens_at <= now or new_opens_at <= opens_at():
        raise OpeningError("The new opening time must be later than the current one.")
    return OpeningTime.objects.create(opens_at=new_opens_at, set_by=staff, reason=reason[:300])


def snapshot(now=None):
    now = now or timezone.now()
    return {
        "opens_at": opens_at().isoformat(),
        "server_now": now.isoformat(),
        "is_open": is_open(now),
        "gate_enabled": gate_enabled(),
    }
