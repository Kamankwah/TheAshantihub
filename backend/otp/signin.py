"""The second sign-in step for customers, business owners and staff, and the sign-up contact check (spec §9).

After a correct password the login views ask sign_in_step(). It answers one of (mirroring the staff 2-step
shape in accounts/views.py, so the frontend can reuse that screen):
* {"otp_required": true, "mfa_token": …, "channels": [{"channel", "hint"}, …]} — a code by text or email;
* {"two_factor_required": true, "mfa_token": …} — the person's authenticator app (customers and business owners,
  otp.authenticator; staff keep accounts.two_factor and its own endpoints);
* {"detail", "code": "no_channel"} (the login views answer it as a 409) — the account owes a code but has no phone
  or email a code can reach, so no ticket is handed out;
* None — sign in at once (always, while the switches are off).

The mfa_token is a signed ticket: account, stage, purpose, a random nonce that binds the code to this attempt, and
a fingerprint of the password hash (a password change kills it). It lasts TICKET_MAX_AGE seconds."""
import hmac
import secrets
from dataclasses import dataclass

from django.core import signing
from django.db.models import Q

from accounts.authentication import issue_token

from . import authenticator, devices, flags
from .identity import CUSTOMER, STAFF, account_type_of, can_sign_in, channel_list, contacts, fingerprint, load, ref
from .models import SIGN_IN, SIGN_UP, VerifiedContact

TICKET_SALT = "otp.signin.ticket"
TICKET_MAX_AGE = 600  # seconds to choose a channel, receive the code and type it
CODE_STAGE = "code"
AUTHENTICATOR_STAGE = "authenticator"
STAGES = (CODE_STAGE, AUTHENTICATOR_STAGE)
PURPOSES = (SIGN_IN, SIGN_UP)
TIMED_OUT = "Your sign-in timed out. Enter your password again."
NO_CHANNEL = {"detail": "We have no phone or email on file to send a code to. Contact Support.", "code": "no_channel"}


@dataclass
class Ticket:
    account: object
    account_type: str
    stage: str
    purpose: str
    nonce: str


def make_ticket(account, stage, purpose):
    account_type, account_id = ref(account)
    return signing.dumps(
        {"t": account_type, "i": account_id, "s": stage, "p": purpose, "n": secrets.token_hex(16), "pw": fingerprint(account)},
        salt=TICKET_SALT,
    )


def read_ticket(token, stage=None):
    """The Ticket, or None unless it is genuine, fresh, for an account that may sign in, issued under its current
    password and (when `stage` is given) at that stage."""
    if not isinstance(token, str) or not token:
        return None
    try:
        data = signing.loads(token, salt=TICKET_SALT, max_age=TICKET_MAX_AGE)
    except signing.BadSignature:
        return None
    if not isinstance(data, dict) or data.get("s") not in STAGES or data.get("p") not in PURPOSES:
        return None
    if stage is not None and data["s"] != stage:
        return None
    account = load(data.get("t"), data.get("i"))
    if not can_sign_in(account) or not hmac.compare_digest(str(data.get("pw", "")), fingerprint(account)):
        return None
    if data["s"] == CODE_STAGE and data["t"] == STAFF:
        from accounts import two_factor  # accounts.views imports this module

        if two_factor.challenge_for(account) is not None:
            return None  # a texted code never replaces the authenticator a staffer has or owes
    return Ticket(account=account, account_type=data["t"], stage=data["s"], purpose=data["p"], nonce=str(data.get("n", "")))


def code_challenge(account, purpose):
    return {"otp_required": True, "mfa_token": make_ticket(account, CODE_STAGE, purpose), "channels": channel_list(account)}


def has_verified_contact(account):
    """True when a code to one of the account's CURRENT phone/email was accepted at some point."""
    account_type, account_id = ref(account)
    current = Q()
    for channel, destination in contacts(account).items():
        current |= Q(channel=channel, destination=destination)
    if not current:
        return False
    return VerifiedContact.objects.filter(current, account_type=account_type, account_id=account_id).exists()


def step_response(step):
    """The login view's Response for a sign_in_step result: 409 when the account has no way to receive a code."""
    from rest_framework.response import Response

    return Response(step, status=409 if step.get("code") == NO_CHANNEL["code"] else 200)


def sign_in_step(account, device_token=""):
    """The second step owed after a correct password, or None to sign in at once. Staff reach this only after
    accounts.two_factor found no authenticator stage for them. Answers the no_channel body (409 via step_response)
    when a code is owed but contacts() is empty."""
    kind = account_type_of(account)
    if kind != STAFF and flags.sign_up_enforced() and not has_verified_contact(account):
        return _challenge_or_no_channel(account, SIGN_UP)
    if not flags.sign_in_enforced():
        return None
    if kind == CUSTOMER and devices.is_trusted(account, device_token):
        return None
    if kind != STAFF and authenticator.is_enabled(account):
        # The authenticator app replaces the texted or emailed code (spec §9). Staff use accounts.two_factor.
        return {"two_factor_required": True, "mfa_token": make_ticket(account, AUTHENTICATOR_STAGE, SIGN_IN)}
    return _challenge_or_no_channel(account, SIGN_IN)


def authenticator_after_sign_up(account, device_token=""):
    """After a correct sign-up code: the authenticator ticket when one is still owed (sign-in codes on, the account
    has an authenticator, and this is not a trusted customer device), else None. A sign-up code never stands in for
    the authenticator."""
    kind = account_type_of(account)
    if kind == STAFF or not flags.sign_in_enforced():
        return None
    if kind == CUSTOMER and devices.is_trusted(account, device_token):
        return None
    if authenticator.is_enabled(account):
        return {"two_factor_required": True, "mfa_token": make_ticket(account, AUTHENTICATOR_STAGE, SIGN_IN)}
    return None


def _challenge_or_no_channel(account, purpose):
    """Never hand out a challenge that can't be passed: with no phone or email to send to, say so."""
    if not contacts(account):
        return dict(NO_CHANNEL)
    return code_challenge(account, purpose)


def signed_in_body(account, request):
    """What a finished sign-in answers: exactly the body the password-only login gives today."""
    kind = account_type_of(account)
    if kind == STAFF:
        from accounts.views import _staff_sign_in_response  # accounts.views imports this module

        return _staff_sign_in_response(account, request, two_factor_used=True)
    return {"token": issue_token(account, kind), "account_type": kind, "id": account.id, "full_name": account.full_name}
