"""The re-delivery fee's payment kind (Plan 7F-E Task 7): registered for wallet payment, finalised once, failure leaves
the request waiting, and the nightly reconciliation expects its journal."""
from decimal import Decimal

from django.test import override_settings

from delivery.models import Redelivery
from ledger.tests.redelivery_helpers import RedeliveryBase
from payments import services
from payments.models import CheckoutSession
from wallets import reconciliation


@override_settings(LEDGER_ENABLED=True)
class RedeliveryFinalizerTests(RedeliveryBase):
    def test_the_kind_is_registered(self):
        kind = CheckoutSession.REDELIVERY_FEE
        self.assertIn(kind, services.WALLET_KINDS)
        self.assertIn(kind, services.FINALIZERS)
        self.assertIn(kind, services.FAILURE_HANDLERS)
        self.assertIn(kind, reconciliation.LEDGER_KINDS)

    def simulated(self, row):
        return services.process_payment(
            kind=CheckoutSession.REDELIVERY_FEE, amount=Decimal("15.00"), purpose=f"Re-delivery of order #{row.order_id}",
            customer=self.customer, metadata={"redelivery_id": row.pk, "ledger": True},
        )

    def test_simulated_payment_finalises_at_once_and_only_once(self):
        row = self.ask(self.unavailable())
        result = self.simulated(row)
        self.assertEqual(result["mode"], "immediate")
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.PAID)
        services.finalize_success(result["session"])                 # a retried finalizer changes nothing
        row.refresh_from_db()
        self.assertEqual(row.pay_journal.key, f"redelivery-pay-{row.pk}")
        self.assertEqual(self.wallet(), 0)
        # The reconciliation expects exactly that journal for this mobile-money reference, and maps it back.
        line = type("Line", (), {"kind": "collection", "reference": result["session"].reference, "amount_pesewas": 1500})()
        self.assertEqual(reconciliation.expected_key(line), (row.pay_journal.key, None))
        self.assertEqual(reconciliation.provider_reference(row.pay_journal), result["session"].reference)

    def test_failure_leaves_the_request_waiting(self):
        row = self.ask(self.unavailable())
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.REDELIVERY_FEE, amount=Decimal("15.00"), purpose="x",
            metadata={"redelivery_id": row.pk, "ledger": True}, status=CheckoutSession.FAILED, provider="hubtel",
        )
        Redelivery.objects.filter(pk=row.pk).update(checkout_session=session)
        services.finalize_failure(session)
        row.refresh_from_db()
        self.assertEqual((row.status, row.checkout_session), (Redelivery.AWAITING_PAYMENT, None))
