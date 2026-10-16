"""The one OTP service (spec §9). A code is 6 digits from `secrets`, kept only as a salted HMAC, alive 5 minutes,
with 5 tries; a resend rotates it after a 60-second wait and keeps the tries. Sends are limited per hour per phone
or email, per account and per IP, counted from the audit trail (otp.models.OtpEvent) so the limits hold across
every server process. An account is locked for both sending and checking while 5 or more of its
wrong codes fall inside the last 15 minutes; the lock and the hourly limits answer the same words, so nobody can tell them apart.

verify() counts a try before comparing and must never run inside a transaction that is rolled back when it
refuses (the counted try would be undone): the views call it outside any atomic block and answer refusals as a
Response."""
import hmac
import secrets
from datetime import timedelta

from django.db.models import F
from django.utils import timezone
from django.utils.crypto import salted_hmac

from activity.services import client_ip

from . import audit, senders, spend
from .identity import contacts, ref
from .models import SIGN_IN, SIGN_UP, SMS, STEP_UP, OtpChallenge, OtpEvent, VerifiedContact

CODE_DIGITS = 6
CODE_TTL = timedelta(minutes=5)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
LOCK_LIMIT = 5
LOCK_WINDOW = timedelta(minutes=15)
PER_DESTINATION_HOURLY = 5
PER_ACCOUNT_HOURLY = 10
PER_IP_HOURLY = 20
HOUR = timedelta(hours=1)
CODE_SALT = "otp.code"
SEND_KINDS = (OtpEvent.SENT, OtpEvent.SEND_FAILED)
SUBJECT = "Your AshantiHub code"

TRY_LATER = "Too many tries. Wait a while, then try again."
WAIT = "Wait a minute before asking for another code."
WRONG = "That code isn't right. Check the message and try again."
EXPIRED = "That code has expired or was already used. Ask for a new one."
NO_CHANNEL = "We can't send a code that way. Choose another way."
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


def failures(account, now=None):
    """Wrong codes (texted, emailed or from an authenticator app) inside the lock window, counting only those
    after the latest staff-assisted recovery (otp.approval_kinds)."""
    account_type, account_id = ref(account)
    now = now or timezone.now()
    mine = OtpEvent.objects.filter(account_type=account_type, account_id=account_id)
    rows = mine.filter(kind=OtpEvent.FAILED, at__gte=now - LOCK_WINDOW)
    recovered = mine.filter(kind=OtpEvent.RECOVERED).order_by("-at").values_list("at", flat=True).first()
    if recovered is not None:
        rows = rows.filter(at__gt=recovered)
    return rows.count()


def is_locked(account, now=None):
    return failures(account, now) >= LOCK_LIMIT


def note_failure(account, *, purpose, channel, request=None, now=None):
    """Count one wrong code towards the account's lock; logs the lock the moment it starts."""
    now = now or timezone.now()
    audit.log(OtpEvent.FAILED, account=account, purpose=purpose, channel=channel, request=request, now=now)
    if failures(account, now) == LOCK_LIMIT:
        audit.log(
            OtpEvent.LOCKED, account=account, purpose=purpose, channel=channel, request=request, now=now,
            note=f"{LOCK_LIMIT} wrong codes in {int(LOCK_WINDOW.total_seconds() // 60)} minutes",
        )


def _ip(request):
    django_request = getattr(request, "_request", request)
    return client_ip(django_request) if django_request is not None else None


def _sent_in_last_hour(now, **match):
    return OtpEvent.objects.filter(kind__in=SEND_KINDS, at__gte=now - HOUR, **match).count()


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
    Returns the OtpChallenge. Every refusal raises OtpError and sends nothing."""
    now = now or timezone.now()
    account_type, account_id = ref(account)
    destination = contacts(account).get(channel) if isinstance(channel, str) else None
    if not destination:
        raise OtpError(NO_CHANNEL, "no_channel")
    ip = _ip(request)
    details = {"account": account, "purpose": purpose, "action": action, "channel": channel,
               "destination": destination, "request": request, "now": now}
    if is_locked(account, now):
        audit.log(OtpEvent.SEND_REFUSED, note="locked", **details)
        raise OtpError(TRY_LATER, "try_later", status_code=429)
    challenge = _open_challenge(account, purpose, action, ticket)
    if challenge is not None and challenge.last_sent_at > now - RESEND_COOLDOWN:
        raise _cooldown(challenge, now)
    if (
        _sent_in_last_hour(now, destination=destination) >= PER_DESTINATION_HOURLY
        or _sent_in_last_hour(now, account_type=account_type, account_id=account_id) >= PER_ACCOUNT_HOURLY
        or (ip is not None and _sent_in_last_hour(now, ip=ip) >= PER_IP_HOURLY)
    ):
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
    else:
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
        raise OtpError(NOT_SENT, "send_failed", status_code=502)
    if channel == SMS:
        spend.check(now)
    return challenge


def verify(account, purpose, raw_code, *, action="", ticket="", request=None, now=None):
    """Accept the code for this ticket / step-up session once. Returns the consumed OtpChallenge; every refusal
    raises OtpError. A try is counted before the comparison, so racing requests never get a sixth."""
    now = now or timezone.now()
    account_type, account_id = ref(account)
    if is_locked(account, now):
        raise OtpError(TRY_LATER, "try_later", status_code=429)
    challenge = (
        OtpChallenge.objects.filter(
            account_type=account_type, account_id=account_id, purpose=purpose, action=action, ticket=ticket,
            consumed_at__isnull=True,
        ).order_by("-id").first()
    )
    if challenge is None or challenge.expires_at <= now or challenge.attempts >= MAX_ATTEMPTS:
        raise OtpError(EXPIRED, "code_expired")
    counted = OtpChallenge.objects.filter(
        pk=challenge.pk, consumed_at__isnull=True, attempts__lt=MAX_ATTEMPTS,
    ).update(attempts=F("attempts") + 1)
    if not counted:
        raise OtpError(EXPIRED, "code_expired")
    code = clean_code(raw_code)
    if not code or not hmac.compare_digest(hash_code(challenge.salt, code), challenge.code_hash):
        note_failure(account, purpose=purpose, channel=challenge.channel, request=request, now=now)
        raise OtpError(WRONG, "wrong_code")
    if not OtpChallenge.objects.filter(pk=challenge.pk, consumed_at__isnull=True).update(consumed_at=now):
        raise OtpError(EXPIRED, "code_expired")
    VerifiedContact.objects.bulk_create(
        [VerifiedContact(account_type=account_type, account_id=account_id, channel=challenge.channel,
                         destination=challenge.destination, verified_at=now)],
        ignore_conflicts=True,
    )
    audit.log(OtpEvent.VERIFIED, account=account, purpose=purpose, action=action, channel=challenge.channel,
              destination=challenge.destination, request=request, now=now)
    challenge.consumed_at = now
    return challenge
