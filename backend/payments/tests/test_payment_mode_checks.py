"""Review finding BE-03: a payment mode that lets orders succeed with no money moving must stop the deploy."""
from django.test import SimpleTestCase, override_settings

from payments import hubtel_client
from payments.checks import check_payment_mode

HUBTEL_OK = dict(
    HUBTEL_CLIENT_ID="id", HUBTEL_CLIENT_SECRET="secret", HUBTEL_MERCHANT_ACCOUNT="acct",
    HUBTEL_WEBHOOK_SECRET="whsec", HUBTEL_CALLBACK_URL="https://api.example.com/api/payments/webhook/hubtel/",
)
PROD = dict(TESTING=False, DEBUG=False)


def ids(messages):
    return sorted(m.id for m in messages)


class PaymentModeChecksTests(SimpleTestCase):
    @override_settings(**PROD, PAYMENTS_PROVIDER="simulated", PAYMENTS_PROVIDER_EXPLICIT="simulated", LEDGER_ENABLED=False)
    def test_explicit_simulated_with_ledger_off_is_clean(self):
        self.assertEqual(check_payment_mode(None), [])

    @override_settings(**PROD, PAYMENTS_PROVIDER="hubtel", PAYMENTS_PROVIDER_EXPLICIT="hubtel", LEDGER_ENABLED=True, **HUBTEL_OK)
    def test_hubtel_with_every_credential_is_clean(self):
        self.assertEqual(check_payment_mode(None), [])

    @override_settings(**PROD, PAYMENTS_PROVIDER="hubtel", PAYMENTS_PROVIDER_EXPLICIT="hubtel", LEDGER_ENABLED=True,
                       **{**HUBTEL_OK, "HUBTEL_CLIENT_ID": ""})
    def test_hubtel_with_a_blank_credential_is_an_error_not_a_silent_simulation(self):
        self.assertEqual(ids(check_payment_mode(None)), ["payments.E002"])

    @override_settings(**PROD, PAYMENTS_PROVIDER="simulated", PAYMENTS_PROVIDER_EXPLICIT="simulated", LEDGER_ENABLED=True,
                       PAYMENTS_ALLOW_SIMULATED=False)
    def test_ledger_on_with_simulated_money_is_an_error(self):
        self.assertEqual(ids(check_payment_mode(None)), ["payments.E003"])

    @override_settings(**PROD, PAYMENTS_PROVIDER="simulated", PAYMENTS_PROVIDER_EXPLICIT="simulated", LEDGER_ENABLED=True,
                       PAYMENTS_ALLOW_SIMULATED=True)
    def test_staging_can_opt_in_to_ledger_with_simulated_money(self):
        self.assertEqual(check_payment_mode(None), [])

    @override_settings(**PROD, PAYMENTS_PROVIDER="simulated", PAYMENTS_PROVIDER_EXPLICIT="", LEDGER_ENABLED=False)
    def test_an_unset_mode_warns_because_it_is_guessed(self):
        self.assertEqual(ids(check_payment_mode(None)), ["payments.W001"])

    @override_settings(**PROD, PAYMENTS_PROVIDER="paypal", PAYMENTS_PROVIDER_EXPLICIT="paypal")
    def test_unknown_mode_is_an_error(self):
        self.assertEqual(ids(check_payment_mode(None)), ["payments.E001"])

    @override_settings(TESTING=True, DEBUG=False, PAYMENTS_PROVIDER="paypal")
    def test_checks_are_skipped_under_the_test_runner(self):
        self.assertEqual(check_payment_mode(None), [])

    @override_settings(HUBTEL_CLIENT_ID="", HUBTEL_CLIENT_SECRET="")
    def test_create_checkout_refuses_blank_credentials(self):
        from django.core.exceptions import ImproperlyConfigured
        with self.assertRaises(ImproperlyConfigured):
            hubtel_client.create_checkout(session=None)
