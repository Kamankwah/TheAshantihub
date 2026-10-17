"""Step-up codes for signed-in customers, business owners and third-party riders (otp plan Task 8, wallets Plan 5).

POST step-up/send/   {action, channel} -> {"channel", "hint", "expires_in", "resend_in"}
POST step-up/verify/ {action, code}    -> {"step_up_token", "action", "expires_in"}
The token goes once in the X-Step-Up-Token header of the change it was asked for (otp.step_up.require). The code
is bound to the access token's jti, like the token it buys.

Who may ask (final review F2):
* Customers and business owners (401 without a sign-in). Staff confirm sensitive changes with their password
  (RequiresSudo) and get 403, except a third-party rider (wallets Plan 5): a rider company's rider holds a wallet, so
  they may ask for `withdrawal` and `payout_destination` codes, and nothing else, while LEDGER_ENABLED is on.
* Only while a code could be owed: OTP_STEP_UP_ENFORCED or OTP_SIGNIN_ENFORCED is on, or - for
  `authenticator_change` alone - the person has an authenticator app on, or - for `withdrawal`,
  `payout_destination` and `contact_change` - LEDGER_ENABLED is on (the wallet endpoints and adding a customer's
  recovery email or phone always ask then: spec §8 and §11). The authenticator settings ask for a
  step-up whatever OTP_STEP_UP_ENFORCED says (force=True): setting one up needs OTP_SIGNIN_ENFORCED, already
  covered, but renewing recovery codes or turning it off must keep working for an app turned on before the switches
  went off. Anything else answers 409 {"code": "otp_off"} and sends nothing, so with every switch off these
  endpoints cannot be used to send anyone an email or a text."""
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer, StaffUser
from ledger import escrow

from . import authenticator, flags, service, step_up
from .models import STEP_UP
from .service import OtpError
from .views import _body, _refused, _sent

UNKNOWN_ACTION = "Choose what you are confirming."
OFF = "Confirming changes with a code isn't switched on."


def _action(body):
    action = body.get("action")
    return action if isinstance(action, str) and action in step_up.ACTIONS else None


# Wallet money actions (wallets plan 3b), and the one change that adds a code channel (a customer's recovery email,
# otp.identity.contacts): while the ledger is on these always ask for a code (force=True), so a code can be sent for
# them whatever the OTP switches say.
WALLET_ACTIONS = (step_up.WITHDRAWAL, step_up.PAYOUT_DESTINATION, step_up.CONTACT_CHANGE)
# A third-party rider's wallet actions (wallets Plan 5): the only codes a staff account may ask for.
RIDER_ACTIONS = (step_up.WITHDRAWAL, step_up.PAYOUT_DESTINATION)


class IsCustomerOwnerOrWalletRider(BasePermission):
    """Customers, business owners, and staff who are third-party riders (their wallet is on)."""

    def has_permission(self, request, view):
        user = request.user
        if isinstance(user, (Customer, BusinessOwner)):
            return True
        if isinstance(user, StaffUser):
            from delivery import employment

            # the same gate as the rider wallet endpoints: the Dispatch role AND delivery.dispatch still in force
            return (
                employment.wallet_rider(user) is not None and "delivery.dispatch" in user.effective_permission_codenames()
            )
        return False


def _codes_off(account, action):
    """True when no step-up could be asked of this person for `action`, so no code is sent (see the module text)."""
    if isinstance(account, StaffUser):
        return not (action in RIDER_ACTIONS and escrow.enabled())
    if flags.step_up_enforced() or flags.sign_in_enforced():
        return False
    if action in WALLET_ACTIONS and escrow.enabled() and (action != step_up.CONTACT_CHANGE or isinstance(account, Customer)):
        return False  # a business owner has no endpoint that asks for a contact_change code, so none is sent for one
    return not (action == step_up.AUTHENTICATOR_CHANGE and authenticator.is_enabled(account))


def _off():
    return Response({"detail": OFF, "code": "otp_off"}, status=409)


class StepUpSendView(APIView):
    permission_classes = [IsCustomerOwnerOrWalletRider]
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
    permission_classes = [IsCustomerOwnerOrWalletRider]
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
