"""Link-free notices that tell an account holder about their sign-in security (final review F4).

* account_locked(): the moment wrong codes (texted, emailed or from an authenticator app) lock the account -
  otp.service.note_failure() answers True for exactly that wrong code;
* recovery_code_used(): an authenticator recovery code signed someone in (otp.views).

Each goes to every phone and email the account has (otp.identity.contacts) through otp.senders and is recorded as
an OtpEvent (SENT or SEND_FAILED, `note` LOCKED_NOTE / RECOVERY_CODE_NOTE), so it counts towards the hourly send
limits like any other message to that phone or email. Best-effort: nothing here ever raises and only an error's
type is logged. A notice never holds a code, a token or a link. However often the sliding lock re-engages, a lock
notice goes at most once an hour per account, so someone who holds the password cannot use wrong codes to flood
the holder (about one more wrong code fits every few minutes once the first ones leave the 15-minute window). The
daily cap (otp.service.daily_failures) is different: it is reached at most once a day per recovery, so its notice
(until_tomorrow, DAILY_LOCKED_NOTE) always goes, even inside that hour."""
import logging
from datetime import timedelta

from django.utils import timezone

from . import audit, senders, spend
from .identity import contacts, ref
from .models import SIGN_IN, SMS, OtpEvent

logger = logging.getLogger(__name__)

SUBJECT = "AshantiHub security notice"
LOCKED_TEXT = (
    "Someone entered wrong sign-in codes for your AshantiHub account several times. "
    "If this wasn't you, change your password and contact Support."
)
DAILY_LOCKED_TEXT = (
    "Someone entered too many wrong sign-in codes for your AshantiHub account today, so it is locked until tomorrow. "
    "If this wasn't you, change your password and contact Support."
)
RECOVERY_CODE_TEXT = (
    "A recovery code was used to sign in to your AshantiHub account. "
    "If this wasn't you, change your password and contact Support."
)
LOCKED_NOTE = "notice: locked"
DAILY_LOCKED_NOTE = "notice: locked until tomorrow"
RECOVERY_CODE_NOTE = "notice: recovery code used"
LOCK_NOTICE_GAP = timedelta(hours=1)
SEND_KINDS = (OtpEvent.SENT, OtpEvent.SEND_FAILED)


def _send(account, *, text, note, purpose, now):
    for channel, destination in contacts(account).items():
        delivery = senders.deliver(channel, destination, SUBJECT, text)
        audit.log(
            OtpEvent.SENT if delivery.ok else OtpEvent.SEND_FAILED, account=account, purpose=purpose, channel=channel,
            destination=destination, provider=delivery.provider, note=note, now=now,
        )
        if delivery.ok and channel == SMS:
            spend.check_quietly(now)


def account_locked(account, *, purpose="", now=None, until_tomorrow=False):
    """Tell the holder that wrong codes just locked the account: the 15-minute lock at most once an hour, the daily
    cap (until_tomorrow) each time it is reached."""
    try:
        now = now or timezone.now()
        if until_tomorrow:
            _send(account, text=DAILY_LOCKED_TEXT, note=DAILY_LOCKED_NOTE, purpose=purpose, now=now)
            return
        account_type, account_id = ref(account)
        told = OtpEvent.objects.filter(
            account_type=account_type, account_id=account_id, kind__in=SEND_KINDS, note=LOCKED_NOTE,
            at__gte=now - LOCK_NOTICE_GAP,
        ).exists()
        if not told:
            _send(account, text=LOCKED_TEXT, note=LOCKED_NOTE, purpose=purpose, now=now)
    except Exception as exc:  # noqa: BLE001 - a notice must never change the answer to the guess
        logger.warning("OTP lock notice not sent: %s", type(exc).__name__)


def recovery_code_used(account, *, now=None):
    """Tell the holder that a recovery code was just used to sign in."""
    try:
        _send(account, text=RECOVERY_CODE_TEXT, note=RECOVERY_CODE_NOTE, purpose=SIGN_IN, now=now or timezone.now())
    except Exception as exc:  # noqa: BLE001
        logger.warning("OTP recovery-code notice not sent: %s", type(exc).__name__)
