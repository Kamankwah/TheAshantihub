"""Sign-in and sign-up codes (otp plan Task 7), plus the helpers the other otp view modules share.

These endpoints work from a signed mfa_token (otp.signin), never from a phone or email, so they cannot tell anyone
whether an account exists. They authenticate nobody (a stale Authorization header can't block them). Refusals are
answered as a Response, never raised, so a wrong code's counted try is never rolled back. activity_exempt: request
bodies carry codes, and these views keep their own audit trail (otp.models.OtpEvent).

POST sign-in/send/   {mfa_token, channel: "sms" | "email"}
    -> {"channel", "hint", "expires_in": 300, "resend_in": 60}
POST sign-in/verify/ {mfa_token, code, trust_device?, device_token?}
    -> the body a password-only sign-in gives, plus "device_token" when a customer trusted this device."""
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.two_factor import SecretUnreadable
from staffsecurity import signin as signin_log
from staffsecurity.models import StaffSignInRecord

from . import audit, authenticator, devices, service, signin
from .identity import CUSTOMER, STAFF, hint
from .models import AUTHENTICATOR, SIGN_IN, OtpEvent
from .service import OtpError

UNREADABLE = "Your authenticator app can't be checked right now. Ask AshantiHub Support to help you sign in."
WRONG_AUTHENTICATOR = "That code isn't right. Check your authenticator app and try again."


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


def _text(value):
    """A request value as a string, or None if the client sent anything else."""
    return value if isinstance(value, str) else None


def _truthy(value):
    return value is True or (isinstance(value, str) and value.strip().lower() in ("true", "1", "yes", "on"))


def _expired():
    return Response({"detail": signin.TIMED_OUT, "code": "challenge_expired"}, status=400)


def _refused(exc):
    return Response(exc.body(), status=exc.status_code)


def _sent(challenge):
    return {
        "channel": challenge.channel,
        "hint": hint(challenge.channel, challenge.destination),
        "expires_in": int(service.CODE_TTL.total_seconds()),
        "resend_in": int(service.RESEND_COOLDOWN.total_seconds()),
    }


def _check_code(ticket, body, request):
    """None when the texted or emailed code is right, else the refusal to answer."""
    try:
        service.verify(ticket.account, ticket.purpose, body.get("code"), ticket=ticket.nonce, request=request)
    except OtpError as exc:
        if ticket.account_type == STAFF and exc.code == "wrong_code":
            signin_log.log(StaffSignInRecord.TWO_STEP_FAILED, request, staff=ticket.account, note="Text or email code")
        return _refused(exc)
    return None


def _check_authenticator(account, body, request):
    """None when the authenticator code (or a recovery code) is right, else the refusal to answer. Wrong codes count
    towards the same 15-minute lock as texted ones."""
    if service.is_locked(account):
        return _refused(OtpError(service.TRY_LATER, "try_later", status_code=429))
    recovery = _text(body.get("recovery_code"))
    try:
        if recovery:
            ok = authenticator.use_recovery_code(account, recovery)
        else:
            ok = authenticator.verify(account, _text(body.get("code")) or "")
    except SecretUnreadable:
        return Response({"detail": UNREADABLE, "code": "authenticator_unreadable"}, status=400)
    if not ok:
        service.note_failure(account, purpose=SIGN_IN, channel=AUTHENTICATOR, request=request)
        return _refused(OtpError(WRONG_AUTHENTICATOR, "wrong_code"))
    audit.log(OtpEvent.VERIFIED, account=account, purpose=SIGN_IN, channel=AUTHENTICATOR,
              note="recovery code" if recovery else "", request=request)
    return None


class SignInSendView(APIView):
    """Send, or resend, the sign-in or sign-up code on the chosen way (switching way recovers a lost code)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_scope = "otp_send"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        ticket = signin.read_ticket(body.get("mfa_token"), signin.CODE_STAGE)
        if ticket is None:
            return _expired()
        try:
            challenge = service.send(ticket.account, ticket.purpose, body.get("channel"), ticket=ticket.nonce, request=request)
        except OtpError as exc:
            return _refused(exc)
        return Response(_sent(challenge))


class SignInVerifyView(APIView):
    """Finish signing in (or confirm the contact after sign-up)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_scope = "otp_verify"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        ticket = signin.read_ticket(body.get("mfa_token"))
        if ticket is None:
            return _expired()
        if ticket.stage == signin.AUTHENTICATOR_STAGE:
            refused = _check_authenticator(ticket.account, body, request)
        else:
            refused = _check_code(ticket, body, request)
        if refused is not None:
            return refused
        payload = signin.signed_in_body(ticket.account, request)
        if ticket.account_type == CUSTOMER and _truthy(body.get("trust_device")):
            payload["device_token"] = devices.trust(ticket.account, request, existing=_text(body.get("device_token")) or "")
        return Response(payload)
