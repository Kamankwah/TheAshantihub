from django.test import TestCase, override_settings

from accounts.models import Customer
from payments.models import CheckoutSession
from payments.services import process_payment


class WalletNeedsLedgerTests(TestCase):
    @override_settings(LEDGER_ENABLED=False)
    def test_a_wallet_payment_is_refused_while_the_ledger_is_off(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233241234567", password_hash="x")
        with self.assertRaises(ValueError):
            process_payment(kind=CheckoutSession.ORDER_CHECKOUT, amount="10.00", purpose="x", customer=customer, wallet=True)
        self.assertFalse(CheckoutSession.objects.exists())
