"""otp.recovery (otp plan Task 11). Support asks for a customer's or business owner's sign-in to be recovered when
they can receive a code neither by text nor by email and have no working authenticator app; a Super Admin approves
with the password re-entered (a Super Admin's own request applies at once). Applying ends every trusted device,
turns the authenticator app off, restarts the wrong-code count (an OtpEvent "recovered") and sends a one-hour
password-reset link to a contact the account already has - never to a new one: a contact changes only through the
existing staff edit. Staff sign-ins are not recovered here; a Super Admin resets their 2-step sign-in."""
import json

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import get_random_string, salted_hmac

from accounts.models import BusinessOwner, PasswordResetToken
from accounts.serializers import PASSWORD_RESET_TOKEN_LIFETIME
from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError, StaleRequest

from . import audit, authenticator, devices, senders, spend
from .identity import BUSINESS_OWNER, CUSTOMER, contacts, hint, load, ref
from .models import EMAIL, RECOVERY, SMS, OtpEvent, TrustedDevice

KEY = "otp.recovery"
KINDS = (CUSTOMER, BUSINESS_OWNER)
WAYS = {SMS: "text message", EMAIL: "email"}


class AccountMissing(ApprovalError):
    status_code = 404


def check_payload(payload):
    """The account a recovery request names, or ApprovalError saying what to fix."""
    payload = payload if isinstance(payload, dict) else {}
    if payload.get("account_type") not in KINDS:
        raise ApprovalError("Choose a customer or a business owner. A Super Admin resets a staff member's 2-step sign-in.")
    account_id = payload.get("account_id")
    if isinstance(account_id, bool) or not isinstance(account_id, int):
        raise ApprovalError("Choose a customer or a business owner.")
    account = load(payload["account_type"], account_id)
    if account is None:
        raise AccountMissing("We couldn't find that account.")
    if isinstance(account, BusinessOwner) and account.needs_claim:
        raise ApprovalError("This business owner hasn't set up their login yet. Send them a claim link instead.")
    if account.is_suspended:
        raise ApprovalError("This account is suspended, so its sign-in can't be recovered.")
    send_to = payload.get("send_to")
    if not isinstance(send_to, str) or send_to not in contacts(account):
        raise ApprovalError("Send the reset link to their phone or their email, whichever they still have.")
    if send_to == SMS and senders.texts_simulated():
        raise ApprovalError("Texts aren't being sent yet (no SMS provider is connected). Send the reset link by email.")
    return account


def _digest(account):
    return salted_hmac("otp.recovery.contacts", json.dumps(contacts(account), sort_keys=True)).hexdigest()


def current_state(request):
    """What the decision is made on. A contact that changes after the request makes it stale (409)."""
    try:
        account = check_payload(request.payload)
    except ApprovalError:
        return {"exists": False}
    return {
        "name": account.full_name,
        "contacts": {c: hint(c, d) for c, d in contacts(account).items()},
        "contacts_digest": _digest(account),
    }


def validate(request):
    check_payload(request.payload)


LINK_SMS = "AshantiHub Support helped you recover your sign-in and removed your authenticator app. Choose a new password within 1 hour: {link} Not you? Contact AshantiHub Support now."
LINK_EMAIL_SUBJECT = "Your AshantiHub sign-in was recovered"
LINK_EMAIL = (
    "AshantiHub Support helped this account recover access. Your authenticator app and trusted devices were removed.\n\n"
    "Choose a new password with this link, which works for 1 hour:\n\n{link}\n\n"
    "If you did not ask for this, contact AshantiHub Support immediately.\n\n- AshantiHub"
)
NOTICE = "AshantiHub Support removed your authenticator and sent a sign-in reset link to {where}. If this wasn't you, contact Support."


def _deliver(account, channel, destination, subject, body):
    """Send and record the real outcome; never raises."""
    try:
        delivery = senders.deliver(channel, destination, subject, body)
    except Exception:
        delivery = senders.Delivery(ok=False, provider="")
    audit.log(OtpEvent.SENT if delivery.ok else OtpEvent.SEND_FAILED, account=account, purpose=RECOVERY,
              channel=channel, destination=destination, provider=delivery.provider)
    if delivery.ok and channel == SMS:
        spend.check_quietly()
    return delivery.ok


def _send_link(account, channel, destination, link, others):
    _deliver(account, channel, destination, LINK_EMAIL_SUBJECT,
             LINK_SMS.format(link=link) if channel == SMS else LINK_EMAIL.format(link=link))
    where = hint(channel, destination)
    for other, other_destination in others.items():  # a notice without the link, so the real holder learns of it
        _deliver(account, other, other_destination, LINK_EMAIL_SUBJECT, NOTICE.format(where=where))


def apply(request):
    account = check_payload(request.payload)
    if (request.before or {}).get("contacts_digest") != _digest(account):
        raise StaleRequest("This person's contact details changed after the request was made. Ask again.")
    account_type, account_id = ref(account)
    channel = request.payload["send_to"]
    destination = contacts(account)[channel]
    others = {c: d for c, d in contacts(account).items() if c != channel}
    decider = request.decided_by or request.maker
    had_authenticator = authenticator.disable(account)
    ended = devices.revoke_all(account, TrustedDevice.STAFF_RECOVERY)
    audit.log(OtpEvent.RECOVERED, account=account, purpose=RECOVERY, note=f"Approval {request.pk}")
    raw = get_random_string(43)
    PasswordResetToken.objects.create(
        account_type=account_type, account_id=account_id, token=raw, expires_at=timezone.now() + PASSWORD_RESET_TOKEN_LIFETIME,
    )
    link = f"{settings.FRONTEND_BASE_URL}/reset-password?token={raw}&type={account_type}"
    # After commit, so a decision that rolls back sends nothing.
    transaction.on_commit(lambda: _send_link(account, channel, destination, link, others), robust=True)
    # Last: record() holds the activity chain lock until commit. The link and its token never go in it.
    record(
        decider, "otp.recovered", target=account,
        summary=f"Sign-in recovered; a reset link goes by {WAYS[channel]} to {hint(channel, destination)}",
        after={"send_to": channel, "authenticator_removed": had_authenticator, "devices_ended": ended},
    )


def super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


def diff(request):
    payload = request.payload or {}
    shown = ((request.before or {}).get("contacts") or {}).get(payload.get("send_to"), "")
    way = WAYS.get(payload.get("send_to"), "")
    return [{"field": "Sign-in", "before": "Can't receive a code", "after": f"Recovered: reset link by {way} to {shown}"}]


RECOVERY_KIND = ApprovalKind(
    key=KEY, label="Recover a sign-in", pool_permission="", current_state=current_state, apply=apply,
    response_hours=24, chain_note="Super Admin only", resolve_approver=super_admin_only, render_diff=diff,
    validate=validate, requires_sudo=True,
    consequences=lambda request: [
        "Ends every trusted device and turns their authenticator app off.",
        "Sends a one-hour password-reset link to the contact chosen. Nothing else about the account changes.",
    ],
)
