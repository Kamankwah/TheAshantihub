"""2-step sign-in for staff (foundations F9): TOTP authenticator codes with
single-use recovery codes. Mandatory for Super Admin (set up at the next
password sign-in), optional for everyone else."""
import hashlib
import hmac
import secrets
import time
from datetime import timedelta

import pyotp
from cryptography.fernet import Fernet
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone

from activity.models import ActivityEvent

from .models import Role, StaffTwoFactor, StaffUser

ISSUER = "AshantiHub"
STEP_SECONDS = 30
RECOVERY_CODE_COUNT = 10
RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
CHALLENGE_SALT = "accounts.two_factor.challenge"
CHALLENGE_MAX_AGE = 300  # seconds to finish the second step
VERIFY = "verify"
ENROL = "enrol"
FAILURE_LIMIT = 5  # wrong second-step codes allowed per staffer ...
FAILURE_WINDOW = timedelta(minutes=15)  # ... within this window
FAILED_VERB = "staff.two_factor_failed"


def _clock():
    return time.time()


def _fernet():
    return Fernet(settings.STAFF_SECRETS_KEY.encode())


def encrypt_secret(secret):
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token):
    return _fernet().decrypt(token.encode()).decode()


def is_required(staff):
    return staff.role.name == Role.SUPER_ADMIN


def is_enabled(staff):
    return (
        StaffTwoFactor.objects.filter(staff=staff, confirmed_at__isnull=False).exclude(secret_encrypted="").exists()
    )


def challenge_for(staff):
    """None when the password alone signs this staffer in, else the stage of
    the second step they must pass."""
    if is_enabled(staff):
        return VERIFY
    if is_required(staff):
        return ENROL
    return None


def make_challenge(staff, stage):
    return signing.dumps({"staff": staff.pk, "stage": stage}, salt=CHALLENGE_SALT)


def read_challenge(token, stage):
    """The staffer a challenge was issued to — or None if it is forged,
    expired, for the other stage, or they can no longer sign in."""
    try:
        data = signing.loads(token or "", salt=CHALLENGE_SALT, max_age=CHALLENGE_MAX_AGE)
    except signing.BadSignature:
        return None
    if data.get("stage") != stage:
        return None
    return (
        StaffUser.objects.select_related("role")
        .filter(pk=data.get("staff"), is_active=True, is_suspended=False)
        .first()
    )


def _hash_code(code):
    return hmac.new(settings.STAFF_SECRETS_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()


def _normalise_code(code):
    return (code or "").strip().lower().replace("-", "").replace(" ", "")


def _new_recovery_codes():
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def _match_step(secret, code, after_step, now=None):
    """The 30-second step `code` belongs to (±1 step of clock drift), or None.
    Steps at or before `after_step` are refused, so no code works twice."""
    digits = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(digits) != 6:
        return None
    totp = pyotp.TOTP(secret)
    current = int(now if now is not None else _clock()) // STEP_SECONDS
    for step in (current - 1, current, current + 1):
        if step > after_step and hmac.compare_digest(totp.at(step * STEP_SECONDS), digits):
            return step
    return None


def begin_enrolment(staff):
    """A fresh secret waiting for its first code. An existing, confirmed
    secret keeps working until the new one is confirmed."""
    secret = pyotp.random_base32()
    record, _ = StaffTwoFactor.objects.get_or_create(staff=staff)
    record.pending_secret_encrypted = encrypt_secret(secret)
    record.save(update_fields=["pending_secret_encrypted"])
    return secret, pyotp.TOTP(secret).provisioning_uri(name=staff.email, issuer_name=ISSUER)


def confirm_enrolment(staff, code, now=None):
    """Activate the pending secret if `code` matches it. Returns 10 new
    recovery codes (shown once), or None."""
    with transaction.atomic():
        record = StaffTwoFactor.objects.select_for_update().filter(staff=staff).first()
        if record is None or not record.pending_secret_encrypted:
            return None
        step = _match_step(decrypt_secret(record.pending_secret_encrypted), code, 0, now)
        if step is None:
            return None
        codes = _new_recovery_codes()
        record.secret_encrypted = record.pending_secret_encrypted
        record.pending_secret_encrypted = ""
        record.confirmed_at = timezone.now()
        record.last_used_step = step
        record.recovery_code_hashes = [_hash_code(_normalise_code(c)) for c in codes]
        record.save()
    return codes


def verify(staff, code, now=None):
    with transaction.atomic():
        record = (
            StaffTwoFactor.objects.select_for_update()
            .filter(staff=staff, confirmed_at__isnull=False)
            .exclude(secret_encrypted="")
            .first()
        )
        if record is None:
            return False
        step = _match_step(decrypt_secret(record.secret_encrypted), code, record.last_used_step, now)
        if step is None:
            return False
        record.last_used_step = step
        record.save(update_fields=["last_used_step"])
    return True


def use_recovery_code(staff, code):
    normalised = _normalise_code(code)
    if not normalised:
        return False
    with transaction.atomic():
        record = StaffTwoFactor.objects.select_for_update().filter(staff=staff, confirmed_at__isnull=False).first()
        hashed = _hash_code(normalised)
        if record is None or hashed not in record.recovery_code_hashes:
            return False
        record.recovery_code_hashes = [h for h in record.recovery_code_hashes if h != hashed]
        record.save(update_fields=["recovery_code_hashes"])
    return True


def regenerate_recovery_codes(staff):
    if not is_enabled(staff):
        return None
    codes = _new_recovery_codes()
    StaffTwoFactor.objects.filter(staff=staff).update(
        recovery_code_hashes=[_hash_code(_normalise_code(c)) for c in codes]
    )
    return codes


def disable(staff):
    StaffTwoFactor.objects.filter(staff=staff).delete()


def status(staff):
    record = StaffTwoFactor.objects.filter(staff=staff).first()
    enabled = bool(record and record.confirmed_at and record.secret_encrypted)
    return {
        "enabled": enabled,
        "required": is_required(staff),
        "enabled_at": record.confirmed_at if enabled else None,
        "recovery_codes_left": len(record.recovery_code_hashes) if enabled else 0,
    }


def too_many_failures(staff, now=None):
    """True once this staffer has FAILURE_LIMIT wrong second-step codes in the
    last FAILURE_WINDOW. Counted per staffer from the activity log, so it holds
    however many IPs the guesses come from."""
    now = now or timezone.now()
    recent = ActivityEvent.objects.filter(
        actor_type=ActivityEvent.STAFF, actor_id=staff.pk, verb=FAILED_VERB,
        occurred_at__gte=now - FAILURE_WINDOW,
    )
    return recent.count() >= FAILURE_LIMIT
