"""System checks for the payments app. `manage.py check`, `migrate` (so every deploy) and `test` run them: a payment
mode that would let orders succeed without money moving stops the deploy instead of failing open at the first order."""
from django.conf import settings
from django.core import checks

HUBTEL_REQUIRED = (
    "HUBTEL_CLIENT_ID", "HUBTEL_CLIENT_SECRET", "HUBTEL_MERCHANT_ACCOUNT", "HUBTEL_WEBHOOK_SECRET", "HUBTEL_CALLBACK_URL",
)


@checks.register()
def check_payment_mode(app_configs, **kwargs):
    if getattr(settings, "TESTING", False):
        return []
    provider = settings.PAYMENTS_PROVIDER
    errors = []
    if provider not in ("simulated", "hubtel"):
        errors.append(checks.Error(
            f"PAYMENTS_PROVIDER is {provider!r}; it must be 'simulated' or 'hubtel'.", id="payments.E001",
        ))
        return errors
    if provider == "hubtel":
        missing = [name for name in HUBTEL_REQUIRED if not getattr(settings, name, "")]
        if missing:
            errors.append(checks.Error(
                "PAYMENTS_PROVIDER is 'hubtel' but these are blank: " + ", ".join(missing) + ".",
                hint="Set all five HUBTEL_* values, or set PAYMENTS_PROVIDER=simulated.", id="payments.E002",
            ))
    elif (
        not settings.DEBUG and settings.LEDGER_ENABLED and not settings.PAYMENTS_ALLOW_SIMULATED
    ):
        errors.append(checks.Error(
            "LEDGER_ENABLED is on but payments are simulated: every order would be recorded as paid with no money moved.",
            hint="Configure Hubtel (PAYMENTS_PROVIDER=hubtel), or on a staging server set PAYMENTS_ALLOW_SIMULATED=true.",
            id="payments.E003",
        ))
    if not settings.DEBUG and not settings.PAYMENTS_PROVIDER_EXPLICIT:
        errors.append(checks.Warning(
            "PAYMENTS_PROVIDER is not set, so the mode is guessed from HUBTEL_CLIENT_ID and a blank id turns payments "
            "into free successes.",
            hint="Set PAYMENTS_PROVIDER=simulated or hubtel explicitly.", id="payments.W001",
        ))
    return errors
