"""System checks for the otp app (registered when otp.apps.OtpConfig is ready). `manage.py check`, `migrate` and
`test` run them, so a mistyped OTP_SMS_PROVIDER stops a deploy instead of failing every text at the first send."""
from django.conf import settings
from django.core import checks

from .senders import PROVIDERS


@checks.register()
def check_sms_provider(app_configs, **kwargs):
    # An empty value means the default, "simulated", exactly as otp.senders.sms_provider() reads it.
    provider = getattr(settings, "OTP_SMS_PROVIDER", "simulated") or "simulated"
    if provider in PROVIDERS:
        return []
    return [checks.Error(
        f"OTP_SMS_PROVIDER is {provider!r}; it must be one of {', '.join(sorted(PROVIDERS))}.",
        hint="Use 'simulated' until Hubtel SMS is set up, then 'hubtel'. 'locmem' is for tests.",
        id="otp.E001",
    )]
