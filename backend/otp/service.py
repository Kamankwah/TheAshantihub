"""The one OTP service (spec §9). A code is 6 digits from `secrets`, kept only as a salted HMAC, alive 5 minutes,
with 5 tries; a resend rotates it after a 60-second wait and keeps the tries. Sends are limited per hour, counted
from the audit trail (otp.models.OtpEvent) so the limits hold across every server process: 5 per account and
phone/email, 20 per phone/email from every account together (so an account registered with someone else's number
cannot use up their allowance, yet nobody can be flooded), 10 per account and 60 per IP. Failed sends count too. A
send that fails never kills the code already delivered and never starts the 60-second wait. An account is locked for
both sending and checking while 5 or more of its wrong codes fall inside the last 15 minutes; when sending, the
lock and the hourly limits answer the same words, so nobody can tell them apart. On top of that sliding lock, an
account whose wrong codes since Accra midnight reach the governed daily cap (ledger.settings_store
"otp_daily_failure_cap", default 20) stays locked until the next Accra day, so someone holding the password cannot keep
guessing a few codes every 15 minutes all day. A staff-assisted recovery (OtpEvent.RECOVERED) restarts both counts.

Guesses are serialised per account (guessing()): the lock check, the comparison and the FAILED row happen one
guess at a time under a Postgres advisory lock, in a short transaction that commits the FAILED row before the
refusal is raised, so parallel wrong guesses can never pass 5. The holder is told when the lock engages
(otp.notices).

verify() counts a try before comparing and must never run inside a transaction that is rolled back when it
refuses (the counted try would be undone): the views call it outside any atomic block and answer refusals as a
Response."""
import hmac
import secrets
from contextlib import contextmanager
from datetime import timedelta

from django.db import connection, transaction
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import salted_hmac

from activity.services import client_ip
from ledger import settings_store

from . import audit, notices, senders, spend
from .identity import contacts, ref
from .models import SIGN_IN, SIGN_UP, SMS, STEP_UP, OtpChallenge, OtpEvent, VerifiedContact

CODE_DIGITS = 6
CODE_TTL = timedelta(minutes=5)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
LOCK_LIMIT = 5
LOCK_WINDOW = timedelta(minutes=15)
PER_DESTINATION_HOURLY = 5  # one account to one phone/email
DESTINATION_CEILING_HOURLY = 20  # one phone/email, every account together
PER_ACCOUNT_HOURLY = 10
# An assumption to tune with real traffic: Ghanaian mobile carriers put many people behind one address (carrier NAT),
# so this is looser than the per-account limits. Listed in the spec's §13 gate.
PER_IP_HOURLY = 60
HOUR = timedelta(hours=1)
CODE_SALT = "otp.code"
SEND_KINDS = (OtpEvent.SENT, OtpEvent.SEND_FAILED)
# pg_advisory_xact_lock(namespace, account_id): one guess at a time per account. The two-int4 key space is separate
# from the one-int8 keys (activity, spend); approvals' two-int4 namespace is 50117.
GUESS_LOCK_NAMESPACE = {"customer": 72210101, "business_owner": 72210102, "staff": 72210103}
SUBJECT = "Your AshantiHub code"

TRY_LATER = "Too many tries. Wait a while, then try again."
WAIT = "Wait a minute before asking for another code."
WRONG = "That code isn't right. Check the message and try again."
EXPIRED = "That code has expired or was already used. Ask for a new one."
CHANNEL_UNAVAILABLE = "We can't send a code that way. Choose another way."
TEXTS_NOT_SENT = "Texts aren't being sent yet. Choose email instead."
NOT_SENT = "We couldn't send the code. Try again, or choose another way."
PURPOSE_WORDS = {SIGN_IN: "sign in", SIGN_UP: "confirm your phone or email", STEP_UP: "confirm a change to your account"}


class OtpError(Exception):
    """A refusal to show the person; `code` is what the frontend branches on."""

    def __init__(self, message, code, status_code=400, retry_after=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.retry_after = retry_after

    def body(self):
        data = {"detail": self.message, "code": self.code}
        if self.retry_after is not None:
            data["retry_after"] = self.retry_after
        return data


def new_code():
    return f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"


def hash_code(salt, code):
    return salted_hmac(CODE_SALT, f"{salt}:{code}").hexdigest()


def clean_code(raw):
    """Six ASCII digits once the spaces and hyphens a person typed are removed, or "" (other scripts' digits pass
    str.isdigit() but are not a code)."""
    if isinstance(raw, bool) or not isinstance(raw, (str, int)):
        return ""
    digits = "".join(str(raw).split()).replace("-", "")
    return digits if len(digits) == CODE_DIGITS and digits.isascii() and digits.isdigit() else ""


def message_for(code, purpose):
    minutes = int(CODE_TTL.total_seconds() // 60)
    return (
        f"{code} is your AshantiHub code to {PURPOSE_WORDS.get(purpose, 'continue')}. It expires in {minutes} minutes. "
        "Never share it: AshantiHub staff will never ask for it."
    )


def _failed_since(account, start):
    """Wrong codes (texted, emailed or from an authenticator app) at or after `start`, counting only those after the
    latest staff-assisted recovery (otp.approval_kinds)."""
    account_type, account_id = ref(account)
    mine = OtpEvent.objects.filter(account_type=account_type, account_id=account_id)
    rows = mine.filter(kind=OtpEvent.FAILED, at__gte=start)
    recovered = mine.filter(kind=OtpEvent.RECOVERED).order_by("-at").values_list("at", flat=True).first()
    if recovered is not None:
        rows = rows.filter(at__gt=recovered)
    return rows.count()


def failures(account, now=None):
    """Wrong codes inside the 15-minute lock window, since the latest staff-assisted recovery."""
    now = now or timezone.now()
    return _failed_since(account, now - LOCK_WINDOW)


def accra_midnight(now):
    """The start of `now`'s day in AshantiHub's time zone (settings.TIME_ZONE, Africa/Accra)."""
    return timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)


def daily_failures(account, now=None):
    """Wrong codes since Accra midnight, since the latest staff-assisted recovery."""
    now = now or timezone.now()
    return _failed_since(account, accra_midnight(now))


def daily_cap(now=None):
    return settings_store.current("otp_daily_failure_cap", at=now)


def is_locked(account, now=None):
    """Locked by the sliding 15-minute window, or until the next Accra day once the daily cap is reached."""
    now = now or timezone.now()
    return failures(account, now) >= LOCK_LIMIT or daily_failures(account, now) >= daily_cap(now)


@contextmanager
def guessing(account):
    """One guess at a time for this account: a transaction holding an advisory lock on (account_type, account_id).
    Inside it the caller checks is_locked(), compares and calls note_failure(); keep it short (never send anything
    inside) and RETURN the outcome from it - a refusal raised inside would roll the FAILED row back. Raise or answer
    the refusal once the block has exited (committed). Never enter it inside another atomic block."""
    account_type, account_id = ref(account)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s, %s)", [GUESS_LOCK_NAMESPACE[account_type], account_id])
        yield


# What note_failure() answers: no lock started, the 15-minute lock started, or the daily cap was reached.
NOT_LOCKED = ""
WINDOW_LOCK = "window"
DAILY_LOCK = "daily"


def note_failure(account, *, purpose, channel, request=None, now=None):
    """Count one wrong code towards the account's locks (call inside guessing()). Logs a lock the moment it starts and
    answers WINDOW_LOCK or DAILY_LOCK (both truthy) for exactly that wrong code, so the caller tells the holder
    (otp.notices.account_locked, with until_tomorrow for DAILY_LOCK) once the guess has committed; else NOT_LOCKED.
    Reaching the daily cap wins over the window lock when one wrong code does both."""
    now = now or timezone.now()
    audit.log(OtpEvent.FAILED, account=account, purpose=purpose, channel=channel, request=request, now=now)
    cap = daily_cap(now)
    if daily_failures(account, now) >= cap:  # >=, so a cap lowered mid-day locks the very next wrong code
        audit.log(
            OtpEvent.LOCKED, account=account, purpose=purpose, channel=channel, request=request, now=now,
            note=f"{cap} wrong codes today: locked until tomorrow",
        )
        return DAILY_LOCK
    if failures(account, now) == LOCK_LIMIT:
        audit.log(
            OtpEvent.LOCKED, account=account, purpose=purpose, channel=channel, request=request, now=now,
            note=f"{LOCK_LIMIT} wrong codes in {int(LOCK_WINDOW.total_seconds() // 60)} minutes",
        )
        return WINDOW_LOCK
    return NOT_LOCKED


def _ip(request):
    django_request = getattr(request, "_request", request)
    return client_ip(django_request) if django_request is not None else None


def _sent_in_last_hour(now, **match):
    return OtpEvent.objects.filter(kind__in=SEND_KINDS, at__gte=now - HOUR, **match).count()


def _over_hourly_limits(now, account_type, account_id, destination, ip):
    mine = {"account_type": account_type, "account_id": account_id}
    return (
        _sent_in_last_hour(now, destination=destination, **mine) >= PER_DESTINATION_HOURLY
        or _sent_in_last_hour(now, destination=destination) >= DESTINATION_CEILING_HOURLY
        or _sent_in_last_hour(now, **mine) >= PER_ACCOUNT_HOURLY
        or (ip is not None and _sent_in_last_hour(now, ip=ip) >= PER_IP_HOURLY)
    )


def _open_challenge(account, purpose, action, ticket):
    account_type, account_id = ref(account)
    return (
        OtpChallenge.objects.filter(
            account_type=account_type, account_id=account_id, purpose=purpose, action=action, ticket=ticket,
            consumed_at__isnull=True, attempts__lt=MAX_ATTEMPTS,
        ).order_by("-id").first()
    )


def _cooldown(challenge, now):
    wait = int((challenge.last_sent_at + RESEND_COOLDOWN - now).total_seconds()) + 1
    return OtpError(WAIT, "resend_cooldown", status_code=429, retry_after=max(wait, 1))


def send(account, purpose, channel, *, action="", ticket="", request=None, now=None):
    """Send, or resend, the code for this sign-in ticket / step-up session on `channel` ("sms" or "email").
    Returns the OtpChallenge. Every refusal raises OtpError and sends nothing. A failed delivery (counted as
    SEND_FAILED, answered 502) puts the challenge back as it was: the code delivered before still works and no wait
    starts; a first code that never arrived is dead and can be replaced at once."""
    now = now or timezone.now()
    account_type, account_id = ref(account)
    destination = contacts(account).get(channel) if isinstance(channel, str) else None
    if not destination:
        raise OtpError(CHANNEL_UNAVAILABLE, "channel_unavailable")
    ip = _ip(request)
    details = {"account": account, "purpose": purpose, "action": action, "channel": channel,
               "destination": destination, "request": request, "now": now}
    if channel == SMS and senders.texts_simulated():
        # No SMS provider is connected: a "sent" text would reach nobody, so no screen may claim one was sent.
        audit.log(OtpEvent.SEND_REFUSED, note="texts simulated", **details)
        raise OtpError(TEXTS_NOT_SENT, "channel_unavailable")
    if is_locked(account, now):
        audit.log(OtpEvent.SEND_REFUSED, note="locked", **details)
        raise OtpError(TRY_LATER, "try_later", status_code=429)
    challenge = _open_challenge(account, purpose, action, ticket)
    if challenge is not None and challenge.last_sent_at > now - RESEND_COOLDOWN:
        raise _cooldown(challenge, now)
    if _over_hourly_limits(now, account_type, account_id, destination, ip):
        audit.log(OtpEvent.SEND_REFUSED, note="hourly limit", **details)
        raise OtpError(TRY_LATER, "try_later", status_code=429)
    code, salt = new_code(), secrets.token_hex(16)
    fields = {"channel": channel, "destination": destination, "salt": salt, "code_hash": hash_code(salt, code),
              "last_sent_at": now, "expires_at": now + CODE_TTL, "ip": ip}
    if challenge is None:
        challenge = OtpChallenge.objects.create(
            account_type=account_type, account_id=account_id, purpose=purpose, action=action, ticket=ticket,
            created_at=now, **fields,
        )
        undo = {"expires_at": now, "last_sent_at": now - RESEND_COOLDOWN}  # never delivered: dead, and no wait
    else:
        undo = {**{name: getattr(challenge, name) for name in fields}, "sends": challenge.sends}
        # Conditional, so two resends racing past the check above still send one code. Tries are kept.
        rotated = OtpChallenge.objects.filter(pk=challenge.pk, last_sent_at__lte=now - RESEND_COOLDOWN).update(
            sends=F("sends") + 1, **fields,
        )
        if not rotated:
            raise _cooldown(challenge, now)
        challenge.refresh_from_db()
    delivery = senders.deliver(channel, destination, SUBJECT, message_for(code, purpose))
    audit.log(OtpEvent.SENT if delivery.ok else OtpEvent.SEND_FAILED, provider=delivery.provider, **details)
    if not delivery.ok:
        # Only if the row still holds the code this call wrote (a resend that raced in after it is left alone).
        OtpChallenge.objects.filter(pk=challenge.pk, code_hash=fields["code_hash"]).update(**undo)
        raise OtpError(NOT_SENT, "send_failed", status_code=502)
    if channel == SMS:
        spend.check_quietly(now)
    return challenge


def verify(account, purpose, raw_code, *, action="", ticket="", request=None, now=None):
    """Accept the code for this ticket / step-up session once. Returns the consumed OtpChallenge; every refusal
    raises OtpError. A try is counted before the comparison, and guesses on one account run one at a time
    (guessing()), so racing requests never get a sixth try or a sixth wrong code in the lock window."""
    with guessing(account):
        now = now or timezone.now()  # read once the lock is held
        challenge, refusal, locked_now = _check(account, purpose, raw_code, action, ticket, request, now)
    # The guess has committed (the FAILED row is kept); only now tell the holder and refuse.
    if locked_now:
        notices.account_locked(account, purpose=purpose, now=now, until_tomorrow=locked_now == DAILY_LOCK)
    if refusal is not None:
        raise refusal
    return challenge


def _check(account, purpose, raw_code, action, ticket, request, now):
    """verify()'s work inside guessing(): (challenge, None, False) when accepted, else (None, refusal, locked_now).
    Never raises a refusal, so the FAILED row it writes commits."""
    account_type, account_id = ref(account)
    if is_locked(account, now):
        return None, OtpError(TRY_LATER, "try_later", status_code=429), False
    challenge = (
        OtpChallenge.objects.filter(
            account_type=account_type, account_id=account_id, purpose=purpose, action=action, ticket=ticket,
            consumed_at__isnull=True,
        ).order_by("-id").first()
    )
    if challenge is None or challenge.expires_at <= now or challenge.attempts >= MAX_ATTEMPTS:
        return None, OtpError(EXPIRED, "code_expired"), False
    counted = OtpChallenge.objects.filter(
        pk=challenge.pk, consumed_at__isnull=True, attempts__lt=MAX_ATTEMPTS,
    ).update(attempts=F("attempts") + 1)
    if not counted:
        return None, OtpError(EXPIRED, "code_expired"), False
    code = clean_code(raw_code)
    if not code or not hmac.compare_digest(hash_code(challenge.salt, code), challenge.code_hash):
        locked_now = note_failure(account, purpose=purpose, channel=challenge.channel, request=request, now=now)
        return None, OtpError(WRONG, "wrong_code"), locked_now
    if not OtpChallenge.objects.filter(pk=challenge.pk, consumed_at__isnull=True).update(consumed_at=now):
        return None, OtpError(EXPIRED, "code_expired"), False
    VerifiedContact.objects.bulk_create(
        [VerifiedContact(account_type=account_type, account_id=account_id, channel=challenge.channel,
                         destination=challenge.destination, verified_at=now)],
        ignore_conflicts=True,
    )
    audit.log(OtpEvent.VERIFIED, account=account, purpose=purpose, action=action, channel=challenge.channel,
              destination=challenge.destination, request=request, now=now)
    challenge.consumed_at = now
    return challenge, None, False
