"""The SMS-spend alert (spec §9). OTP texts are counted per day from the audit trail; the first check that finds
today's count at the threshold Super Admin set (staffsecurity.policy.otp_sms_daily_alert, default 500) tells
everyone holding security.manage, once a day. Nothing is blocked: the alert is for a person to look at."""
import logging

from django.db import connection, transaction
from django.utils import timezone

from notifications.services import notify_staff_role

from .models import SMS, OtpEvent

logger = logging.getLogger(__name__)

ALERT_KIND = "otp_sms_spend"
ALERT_LOCK_KEY = 72210016  # pg_advisory_xact_lock key: one alert a day however many texts race


def texts_sent_on(day):
    return OtpEvent.objects.filter(kind=OtpEvent.SENT, channel=SMS, at__date=day).count()


def check(now=None):
    from staffsecurity import policy

    now = now or timezone.now()
    day = timezone.localdate(now)
    threshold = policy.otp_sms_daily_alert()
    sent = texts_sent_on(day)
    if sent < threshold:
        return False
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [ALERT_LOCK_KEY])
        if OtpEvent.objects.filter(kind=OtpEvent.SMS_ALERT, at__date=day).exists():
            return False
        OtpEvent.objects.create(kind=OtpEvent.SMS_ALERT, at=now, channel=SMS, note=f"{sent} texts on {day:%Y-%m-%d}; alert at {threshold}")
    notify_staff_role(
        "security.manage", ALERT_KIND, f"One-time-code texts reached {threshold} today",
        body=(
            f"{sent} code texts have been sent today ({day:%d %b}). A sudden rise can mean someone is abusing the "
            "code requests. Look at the code log and the text balance."
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
