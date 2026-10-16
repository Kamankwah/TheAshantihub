"""The three OTP switches (docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md §9). Each defaults
off in settings, so merging this app changes nothing: sign-in, sign-up and every sensitive endpoint behave
exactly as before until a switch is turned on. Read at call time, so override_settings works in tests."""
from django.conf import settings


def sign_in_enforced():
    return bool(getattr(settings, "OTP_SIGNIN_ENFORCED", False))


def step_up_enforced():
    return bool(getattr(settings, "OTP_STEP_UP_ENFORCED", False))


def sign_up_enforced():
    return bool(getattr(settings, "OTP_SIGNUP_VERIFICATION_ENFORCED", False))
