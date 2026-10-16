"""Step-up codes for signed-in customers and business owners (otp plan Task 8).

POST step-up/send/   {action, channel} -> {"channel", "hint", "expires_in", "resend_in"}
POST step-up/verify/ {action, code}    -> {"step_up_token", "action", "expires_in"}
The token goes once in the X-Step-Up-Token header of the change it was asked for (otp.step_up.require). The code
is bound to the access token's jti, like the token it buys.

Who may ask (final review F2):
* Customers and business owners only (403 for staff, 401 without a sign-in). Staff confirm sensitive changes with
  their password (RequiresSudo); letting them ask here would send real codes and, through the account-wide lock,
  let a wrong code lock their own code sign-in.
* Only while a code could be owed: OTP_STEP_UP_ENFORCED or OTP_SIGNIN_ENFORCED is on, or - for
  `authenticator_change` alone - the person has an authenticator app on. The authenticator settings ask for a
  step-up whatever OTP_STEP_UP_ENFORCED says (force=True): setting one up needs OTP_SIGNIN_ENFORCED, already
  covered, but renewing recovery codes or turning it off must keep working for an app turned on before the switches
  went off. Anything else answers 409 {"code": "otp_off"} and sends nothing, so with every switch off these
  endpoints cannot be used to send anyone an email or a text."""
from rest_framework.response import Response
from rest_framework.views import APIView

from . import authenticator, flags, service, step_up
from .models import STEP_UP
from .service import OtpError
from .views import _body, _refused, _sent
from .views_authenticator import IsCustomerOrOwner

UNKNOWN_ACTION = "Choose what you are confirming."
OFF = "Confirming changes with a code isn't switched on."


def _action(body):
    action = body.get("action")
    return action if isinstance(action, str) and action in step_up.ACTIONS else None


def _codes_off(account, action):
    """True when no step-up could be asked of this person for `action`, so no code is sent (see the module text)."""
    if flags.step_up_enforced() or flags.sign_in_enforced():
        return False
    return not (action == step_up.AUTHENTICATOR_CHANGE and authenticator.is_enabled(account))


def _off():
    return Response({"detail": OFF, "code": "otp_off"}, status=409)


class StepUpSendView(APIView):
    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "otp_send"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        action = _action(body)
        if action is None:
            return Response({"action": [UNKNOWN_ACTION]}, status=400)
        if _codes_off(request.user, action):
            return _off()
        try:
            challenge = service.send(
                request.user, STEP_UP, body.get("channel"), action=action, ticket=step_up.session_key(request), request=request,
            )
        except OtpError as exc:
            return _refused(exc)
        return Response(_sent(challenge))


class StepUpVerifyView(APIView):
    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "otp_verify"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        action = _action(body)
        if action is None:
            return Response({"action": [UNKNOWN_ACTION]}, status=400)
        if _codes_off(request.user, action):
            return _off()
        try:
            service.verify(request.user, STEP_UP, body.get("code"), action=action, ticket=step_up.session_key(request), request=request)
        except OtpError as exc:
            return _refused(exc)
        return Response({
            "step_up_token": step_up.issue(request.user, action, request),
            "action": action,
            "expires_in": int(step_up.TOKEN_TTL.total_seconds()),
        })
