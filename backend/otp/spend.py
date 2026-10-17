"""The SMS-spend alert (spec §9). Code texts (from the OTP audit trail) and business money texts (wallets.VendorText;
spec §6, vendor plan 4) are counted per day; marketing campaign texts are not. The first check that finds today's count
at the threshold Super Admin set (staffsecurity.policy.otp_sms_daily_alert, default 500) tells everyone holding
security.manage, once a day. Nothing is blocked: the alert is for a person to look at."""
import logging
from datetime import datetime, time, timedelta

from django.db import connection, transaction
from django.utils import timezone

from notifications.services import notify_staff_role

from .models import SMS, OtpEvent

logger = logging.getLogger(__name__)

ALERT_KIND = "otp_sms_spend"
ALERT_LOCK_KEY = 72210016  # pg_advisory_xact_lock key: one alert a day however many texts race


def _bounds(day):
    """[start, next start) of the local `day`, for range filters on indexed timestamps."""
    return (
        timezone.make_aware(datetime.combine(day, time.min)),
        timezone.make_aware(datetime.combine(day + timedelta(days=1), time.min)),
    )


def code_texts_sent_on(day):
    start, end = _bounds(day)
    return OtpEvent.objects.filter(kind=OtpEvent.SENT, channel=SMS, at__gte=start, at__lt=end).count()


def business_texts_sent_on(day):
    """Business money texts actually sent on `day`, by a range on sent_at (index-friendly). A text the simulated provider
    "sent" went nowhere and costs nothing, so it is not counted."""
    from wallets.models import VendorText

    start, end = _bounds(day)
    return VendorText.objects.filter(
        status=VendorText.SENT, sent_at__gte=start, sent_at__lt=end,
    ).exclude(provider="simulated").count()


def texts_sent_on(day):
    """Messages sent on `day`: code texts plus business money texts (marketing campaign texts are not counted). Business
    texts are never OtpEvents (the code send limits count those), so they are counted from their own outbox. This counts
    messages, not billed SMS parts: a two-part business text counts once."""
    return code_texts_sent_on(day) + business_texts_sent_on(day)


def check(now=None):
    from staffsecurity import policy

    now = now or timezone.now()
    day = timezone.localdate(now)
    start, end = _bounds(day)
    if OtpEvent.objects.filter(kind=OtpEvent.SMS_ALERT, at__gte=start, at__lt=end).exists():
        return False  # already alerted today: no need to count
    threshold = policy.otp_sms_daily_alert()
    codes, business = code_texts_sent_on(day), business_texts_sent_on(day)  # each counted once
    sent = codes + business
    if sent < threshold:
        return False
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [ALERT_LOCK_KEY])
        if OtpEvent.objects.filter(kind=OtpEvent.SMS_ALERT, at__gte=start, at__lt=end).exists():
            return False
        OtpEvent.objects.create(kind=OtpEvent.SMS_ALERT, at=now, channel=SMS, note=f"{sent} texts on {day:%Y-%m-%d}; alert at {threshold}")
    notify_staff_role(
        "security.manage", ALERT_KIND, f"Texts reached {threshold} today",
        body=(
            f"{sent} texts have been sent today ({day:%d %b}): {codes} one-time codes and {business} business money "
            "texts. A sudden rise in codes can mean someone is abusing the code requests. Look at the code log and the "
            "text balance."
        ),
        link="security", icon="📱",
    )
    return True


def check_quietly(now=None):
    """check() after a text has gone out: a failure here must never turn a delivered message into an error. Logs
    only the error type."""
    try:
        return check(now)
    except Exception as exc:  # noqa: BLE001
        logger.warning("OTP text-spend check failed: %s", type(exc).__name__)
        return False
