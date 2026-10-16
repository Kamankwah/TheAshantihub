"""Nightly clean-up (otp.tasks.purge_old_otp_rows). Codes and step-up tokens are useless after minutes, so they
go after a day; ended trusted devices after 90 days; the audit trail after RETENTION_DAYS (the staff sign-in
history keeps the same 400). Devices that were never ended but whose last code is older than the configured customer gap can never skip
a code again (devices.find already refuses them), so they go too, and each account keeps at most MAX_LIVE_DEVICES of its most recently seen ones."""
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from . import devices
from .models import OtpChallenge, OtpEvent, StepUpToken, TrustedDevice

SHORT_LIVED = timedelta(days=1)
ENDED_DEVICES = timedelta(days=90)
RETENTION_DAYS = 400
MAX_LIVE_DEVICES = 10


def _cap_live_devices():
    removed = 0
    crowded = (
        TrustedDevice.objects.filter(revoked_at__isnull=True).values("account_type", "account_id")
        .annotate(n=Count("id")).filter(n__gt=MAX_LIVE_DEVICES)
    )
    for group in crowded:
        keep = TrustedDevice.objects.filter(
            revoked_at__isnull=True, account_type=group["account_type"], account_id=group["account_id"],
        ).order_by("-last_seen_at", "-id").values_list("pk", flat=True)[:MAX_LIVE_DEVICES]
        gone, _ = TrustedDevice.objects.filter(
            revoked_at__isnull=True, account_type=group["account_type"], account_id=group["account_id"],
        ).exclude(pk__in=list(keep)).delete()
        removed += gone
    return removed


def purge(now=None):
    now = now or timezone.now()
    challenges, _ = OtpChallenge.objects.filter(created_at__lt=now - SHORT_LIVED).delete()
    tokens, _ = StepUpToken.objects.filter(created_at__lt=now - SHORT_LIVED).delete()
    ended, _ = TrustedDevice.objects.filter(revoked_at__lt=now - ENDED_DEVICES).delete()
    stale, _ = TrustedDevice.objects.filter(revoked_at__isnull=True, verified_at__lt=now - devices._gap()).delete()
    capped = _cap_live_devices()
    events, _ = OtpEvent.objects.filter(at__lt=now - timedelta(days=RETENTION_DAYS)).delete()
    return {"challenges": challenges, "step_up_tokens": tokens, "devices": ended + stale + capped, "events": events}
