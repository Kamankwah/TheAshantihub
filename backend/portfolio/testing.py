"""Test helpers for the owner-confirmation gate (plan M3 Task 6). Import from tests only."""
import re

from django.utils import timezone

from accounts.claims import hash_token
from otp import senders

from . import confirmations
from .models import OwnerConfirmation

_TOKEN = re.compile(r"token=([\w-]+)")


def confirm_registration(owner):
    """Mark a staff-registered owner's registration confirmed, so its KYC can be approved in a test that is not about
    the gate. Goes through the real `confirmations.confirm` with the raw token from the text in `senders.sms_outbox`
    when that text is there (the real path); otherwise (the text goes after commit, which a plain TestCase never runs)
    sets `confirmed_at` on the registration row directly. No registration row: nothing to do (grandfathered)."""
    rows = OwnerConfirmation.objects.filter(
        business_owner=owner, scope=OwnerConfirmation.REGISTRATION, confirmed_at__isnull=True,
        declined_at__isnull=True, revoked_at__isnull=True,
    )
    for text in reversed(senders.sms_outbox):
        found = _TOKEN.search(text.body)
        if found and rows.filter(token_hash=hash_token(found.group(1))).exists():
            confirmations.confirm(found.group(1))
            return
    rows.update(confirmed_at=timezone.now())
