"""Step-up tokens (spec §9). Before a sensitive change the signed-in person proves it is them with a code and gets
a single-use token for that one action, alive 5 minutes and bound to the access token it was issued to (its jti).
The client sends it once in the X-Step-Up-Token header. A view calls require(request, ACTION) INSIDE the
transaction.atomic() block that makes the change: the token is spent only if the change commits, so a change
refused by validation leaves it usable for the retry.

While settings.OTP_STEP_UP_ENFORCED is off, require() does nothing; force=True asks for it anyway: the authenticator
settings, and - while LEDGER_ENABLED is on - adding a customer recovery contact and the wallet actions (withdrawal,
payout_destination, contact_change), so a code can be sent for those whatever the OTP switches say. Only customers, business owners and third-party riders (withdrawal and payout_destination) can get a token (otp.views_step_up); other staff use sudo."""
import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone
from rest_framework import exceptions

from . import audit, flags
from .identity import ref
from .models import STEP_UP, OtpEvent, StepUpToken

PAYOUT_DESTINATION = "payout_destination"
CONTACT_CHANGE = "contact_change"
AUTHENTICATOR_CHANGE = "authenticator_change"
PASSWORD_CHANGE = "password_change"
WITHDRAWAL = "withdrawal"
ACTIONS = {
    PAYOUT_DESTINATION: "Change where your money is paid",
    CONTACT_CHANGE: "Add or change a phone number or email",
    AUTHENTICATOR_CHANGE: "Turn the authenticator app on or off",
    PASSWORD_CHANGE: "Change your password",
    WITHDRAWAL: "Withdraw money",
}
TOKEN_TTL = timedelta(minutes=5)
HEADER = "HTTP_X_STEP_UP_TOKEN"
REQUIRED = "Confirm it's you with a code first."


class StepUpRequired(exceptions.PermissionDenied):
    """403 {"detail", "code": "step_up_required", "action"}: the frontend asks for a code, then retries with the
    X-Step-Up-Token header (the same pattern as sudo_required)."""

    def __init__(self, action):
        super().__init__({"detail": REQUIRED, "code": "step_up_required", "action": action})


def _hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def session_key(request):
    """The jti of the access token on this request ("" when there is none): what a step-up is bound to."""
    token = getattr(request, "auth", None)
    try:
        return str(token.get("jti", "")) if token is not None else ""
    except AttributeError:
        return ""


def issue(account, action, request, now=None):
    if action not in ACTIONS:
        raise ValueError(f"Unknown step-up action: {action}")
    now = now or timezone.now()
    account_type, account_id = ref(account)
    raw = secrets.token_urlsafe(32)
    StepUpToken.objects.create(
        account_type=account_type, account_id=account_id, action=action, token_hash=_hash(raw),
        jti=session_key(request), created_at=now, expires_at=now + TOKEN_TTL,
    )
    audit.log(OtpEvent.STEP_UP_ISSUED, account=account, purpose=STEP_UP, action=action, request=request, now=now)
    return raw


def enforced(force=False):
    return force or flags.step_up_enforced()


def _live_tokens(request, action, now):
    """The unspent, unexpired tokens this request's header holds for `action` (this account and sign-in), or None
    when there is no header or no sign-in."""
    raw = request.META.get(HEADER, "")
    jti = session_key(request)
    if not raw or not jti:
        return None
    account_type, account_id = ref(request.user)
    return StepUpToken.objects.filter(
        token_hash=_hash(raw), account_type=account_type, account_id=account_id, action=action, jti=jti,
        used_at__isnull=True, expires_at__gt=now,
    )


def valid(request, action, *, force=False):
    """True when require() would accept this request's token now. Spends nothing: a view uses it to refuse a request
    with no good code before doing anything costly (a provider lookup), then require() still spends it."""
    if action not in ACTIONS:
        raise ValueError(f"Unknown step-up action: {action}")
    if not enforced(force):
        return True
    live = _live_tokens(request, action, timezone.now())
    return live is not None and live.exists()


def require(request, action, *, force=False):
    """Spend this request's step-up token for `action`, or raise StepUpRequired. Call inside the atomic block that
    saves the change."""
    if action not in ACTIONS:
        raise ValueError(f"Unknown step-up action: {action}")
    if not enforced(force):
        return
    now = timezone.now()
    live = _live_tokens(request, action, now)
    if live is None:
        raise StepUpRequired(action)
    spent = live.update(used_at=now)
    if spent != 1:
        raise StepUpRequired(action)
    audit.log(OtpEvent.STEP_UP_USED, account=request.user, purpose=STEP_UP, action=action, request=request, now=now)
