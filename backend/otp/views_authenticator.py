"""Authenticator-app settings for customers and business owners (otp plan Task 9). Staff keep
/api/accounts/staff/two-factor/…. Setting it up is offered only while OTP_SIGNIN_ENFORCED is on (it replaces the
sign-in code, which exists only then); setting it up, turning it off and renewing recovery codes always need a
step-up code, whatever OTP_STEP_UP_ENFORCED says.

GET  authenticator/                  -> {"enabled", "enabled_at", "recovery_codes_left", "available"}
POST authenticator/setup/            (X-Step-Up-Token) -> {"secret", "otpauth_uri"}
POST authenticator/setup/confirm/    {code} -> {"recovery_codes"}
POST authenticator/recovery-codes/   (X-Step-Up-Token) -> {"recovery_codes"}
POST authenticator/disable/          (X-Step-Up-Token) -> 204"""
from django.db import transaction
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.two_factor import SecretUnreadable

from . import audit, authenticator, flags, step_up
from .models import AUTHENTICATOR, OtpEvent
from .views import UNREADABLE, _body, _text

OFF = "The authenticator app can be used once sign-in codes are switched on."
NOT_ON = "The authenticator app isn't on."
WRONG_FIRST = "That code isn't right. Check the app shows AshantiHub and try again."


class IsCustomerOrOwner(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, (Customer, BusinessOwner))


def _off():
    return Response({"detail": OFF, "code": "otp_off"}, status=409)


class AuthenticatorView(APIView):
    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        return Response({**authenticator.status(request.user), "available": flags.sign_in_enforced()})


class AuthenticatorSetupView(APIView):
    """A new secret to scan. One already on keeps working until the new one is confirmed."""

    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "two_factor"
    activity_exempt = True

    def post(self, request):
        if not flags.sign_in_enforced():
            return _off()
        with transaction.atomic():
            step_up.require(request, step_up.AUTHENTICATOR_CHANGE, force=True)
            secret, uri = authenticator.begin(request.user)
        return Response({"secret": secret, "otpauth_uri": uri})


class AuthenticatorConfirmView(APIView):
    """The app's first code switches it on; answers ten recovery codes, shown once."""

    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "two_factor"
    activity_exempt = True

    def post(self, request):
        if not flags.sign_in_enforced():
            return _off()
        try:
            codes = authenticator.confirm(request.user, _text(_body(request).get("code")) or "")
        except SecretUnreadable:
            return Response({"detail": UNREADABLE}, status=400)
        if codes is None:
            return Response({"detail": WRONG_FIRST, "code": "wrong_code"}, status=400)
        audit.log(OtpEvent.AUTHENTICATOR_ON, account=request.user, channel=AUTHENTICATOR, request=request)
        return Response({"recovery_codes": codes})


class AuthenticatorRecoveryCodesView(APIView):
    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "two_factor"
    activity_exempt = True

    def post(self, request):
        if not authenticator.is_enabled(request.user):
            return Response({"detail": NOT_ON}, status=400)
        with transaction.atomic():
            step_up.require(request, step_up.AUTHENTICATOR_CHANGE, force=True)
            codes = authenticator.regenerate_recovery_codes(request.user)
        return Response({"recovery_codes": codes})


class AuthenticatorDisableView(APIView):
    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "two_factor"
    activity_exempt = True

    def post(self, request):
        if not authenticator.is_enabled(request.user):
            return Response({"detail": NOT_ON}, status=400)
        with transaction.atomic():
            step_up.require(request, step_up.AUTHENTICATOR_CHANGE, force=True)
            authenticator.disable(request.user)
            audit.log(OtpEvent.AUTHENTICATOR_OFF, account=request.user, channel=AUTHENTICATOR, request=request)
        return Response(status=204)
