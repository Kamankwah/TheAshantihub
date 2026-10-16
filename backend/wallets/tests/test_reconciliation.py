"""The nightly reconciliation (wallets plan 3b, Task 6; spec §2 "compares the ledger to the provider statement and flags
differences"). Review Focus 7: no false alarms, and a real difference opens one case."""
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from billing.models import Transaction
from fraud.models import FraudFlag
from ledger import escrow, posting
from ledger.models import Account
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from payments.services import process_payment
from wallets import payouts, reconciliation, tasks, withdrawals
from wallets.models import ReconciliationRun

from .helpers import Holder, destination


@override_settings(LEDGER_ENABLED=True)
class ReconciliationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.ama = Holder(self.customer, "customer")
        self.owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        self.kente = self.listing("60.00")
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.today = timezone.localdate()

    def listing(self, price):
        return Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name=f"Item {price}", description="D.", contact_phone=self.owner.login_phone, price_amount=Decimal(price), status=Listing.PUBLISHED,
        )

    def buy(self, method="momo", listing=None):
        self.ama.client.post("/api/cart/items/", {"listing": (listing or self.kente).pk, "quantity": 1}, format="json")
        response = self.ama.client.post("/api/orders/checkout/", {"payment_method": method}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["id"]

    def top_up(self, amount):
        self.assertEqual(self.ama.client.post("/api/wallet/top-up/", {"amount": amount}, format="json").status_code, 201)

    def test_a_clean_day_matches(self):
        self.top_up("100.00")
        self.buy("momo")
        self.buy("wallet")
        with transaction.atomic():
            held = withdrawals.request(self.customer, destination_id=destination(self.customer).pk, amount_pesewas=2000, request_id="req-recon-0001")
        payouts.submit(held.pk)
        run = reconciliation.reconcile(self.today)
        self.assertEqual((run.status, run.differences), (ReconciliationRun.MATCHED, []))
        self.assertEqual((run.statement_in_pesewas, run.ledger_in_pesewas), (16000, 16000))           # top-up 100.00 + MoMo order 60.00
        self.assertEqual((run.statement_out_pesewas, run.ledger_out_pesewas), (2000, 2000))
        self.assertEqual(run.in_transit_pesewas, 0)
        self.assertFalse(FraudFlag.objects.exists())

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_the_processing_charge_the_provider_kept_is_not_a_difference(self):
        self.top_up("50.00")
        self.buy("momo")
        run = reconciliation.reconcile(self.today)
        self.assertEqual((run.status, run.statement_in_pesewas, run.ledger_in_pesewas), (ReconciliationRun.MATCHED, 11000, 11000))

    def test_review_focus_payments_the_ledger_was_not_asked_to_record_are_not_differences(self):
        with override_settings(LEDGER_ENABLED=False):
            self.buy("momo")                                                                          # paid while the ledger was off
        self.buy("momo", listing=self.listing("0.00"))                                                 # a GH₵ 0.00 order
        process_payment(kind=CheckoutSession.SUBSCRIPTION, amount=Decimal("50.00"), purpose="Plan", business_owner=self.owner, metadata={})
        run = reconciliation.reconcile(self.today)
        self.assertEqual((run.status, run.differences), (ReconciliationRun.MATCHED, []))

    def test_review_focus_a_payment_with_no_journal_is_a_difference_and_opens_one_case(self):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount=Decimal("60.00"))
        OrderItem.objects.create(order=order, listing=self.kente, quantity=1, unit_price=Decimal("60.00"), line_total=Decimal("60.00"))
        txn = Transaction.objects.create(customer=self.customer, amount=Decimal("60.00"), purpose="Order", reference="AH-ORDER_CHECKOUT-LOST000001")
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount=Decimal("60.00"), purpose="Order", reference=txn.reference,
            status=CheckoutSession.SUCCESS, transaction=txn, metadata={"order_id": order.pk, "ledger": True},
        )                                                                                              # paid, but its finalizer never posted
        run = reconciliation.reconcile(self.today)
        self.assertEqual(run.status, ReconciliationRun.MISMATCHED)
        self.assertEqual(run.differences, [{"reference": txn.reference, "kind": "collection", "problem": "missing_in_ledger", "ledger": None, "statement": 6000}])
        flag = FraudFlag.objects.get(dedupe_key=f"reconciliation-{self.today.isoformat()}")
        self.assertEqual(run.flag_id, flag.pk)
        self.assertEqual(Notification.objects.filter(staff=self.accountant, kind="reconciliation_mismatch").count(), 1)
        reconciliation.reconcile(self.today)                                                          # the same day again
        self.assertEqual(FraudFlag.objects.filter(dedupe_key=f"reconciliation-{self.today.isoformat()}").count(), 1)
        self.assertEqual(Notification.objects.filter(staff=self.accountant, kind="reconciliation_mismatch").count(), 1)
        self.assertEqual(ReconciliationRun.objects.count(), 1)

    def test_a_clearing_entry_with_no_provider_record_is_a_difference(self):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount=Decimal("60.00"))
        OrderItem.objects.create(order=order, listing=self.kente, quantity=1, unit_price=Decimal("60.00"), line_total=Decimal("60.00"))
        escrow.record_order_payment(order)                                                            # no checkout session behind it
        run = reconciliation.reconcile(self.today)
        self.assertEqual(run.differences, [{"reference": f"order-pay-{order.pk}", "kind": "collection", "problem": "missing_on_statement", "ledger": 6000, "statement": None}])

    def test_review_focus_a_payment_confirmed_before_midnight_is_not_a_difference_either_day(self):
        self.buy("momo")
        session = CheckoutSession.objects.get(kind=CheckoutSession.ORDER_CHECKOUT)
        Transaction.objects.filter(pk=session.transaction_id).update(created_at=timezone.now() - timedelta(days=1))
        self.assertEqual(reconciliation.reconcile(self.today - timedelta(days=1)).differences, [])
        self.assertEqual(reconciliation.reconcile(self.today).differences, [])

    def test_in_transit_must_equal_the_open_withdrawals(self):
        self.top_up("10.00")
        posting.post(key="stray", kind="test", lines=[
            posting.debit(posting.account_for(Account.CUSTOMER_WALLET, self.customer), 500),
            posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 500),
        ])
        run = reconciliation.reconcile(self.today)
        self.assertEqual(run.differences, [{"reference": "withdrawal_in_transit", "kind": "payout", "problem": "in_transit_differs", "ledger": 500, "statement": 0}])

    @override_settings(PAYMENTS_PROVIDER="hubtel")
    def test_a_provider_without_a_statement_is_recorded_as_unavailable(self):
        run = reconciliation.reconcile(self.today)
        self.assertEqual((run.status, run.provider), (ReconciliationRun.UNAVAILABLE, "hubtel"))
        self.assertFalse(FraudFlag.objects.exists())

    @override_settings(PAYMENTS_PROVIDER="hubtel")
    def test_with_no_statement_in_transit_is_still_checked(self):
        posting.post(key="stray", kind="test", lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), 500),
            posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 500),
        ])
        run = reconciliation.reconcile(self.today)
        self.assertEqual(run.status, ReconciliationRun.MISMATCHED)
        self.assertEqual(run.differences, [{"reference": "withdrawal_in_transit", "kind": "payout", "problem": "in_transit_differs", "ledger": 500, "statement": 0}])
        self.assertTrue(FraudFlag.objects.filter(dedupe_key=f"reconciliation-{self.today.isoformat()}").exists())

    def test_the_nightly_task_reconciles_yesterday(self):
        self.assertEqual(tasks.reconcile_yesterday(), ReconciliationRun.MATCHED)
        self.assertTrue(ReconciliationRun.objects.filter(day=self.today - timedelta(days=1)).exists())
        self.assertEqual(settings.CELERY_BEAT_SCHEDULE["wallets-reconcile"]["task"], "wallets.tasks.reconcile_yesterday")

    def test_staff_read_the_runs(self):
        reconciliation.reconcile(self.today)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.accountant)}")
        body = client.get("/api/wallet/staff/reconciliation/").json()
        self.assertEqual((body["results"][0]["day"], body["results"][0]["status"]), (self.today.isoformat(), "matched"))
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('support', 'esi@example.com'))}")
        self.assertEqual(client.get("/api/wallet/staff/reconciliation/").status_code, 403)


class ReconciliationLedgerOffTests(TestCase):
    def test_the_task_does_nothing_while_the_ledger_is_off(self):
        self.assertIsNone(tasks.reconcile_yesterday())
        self.assertFalse(ReconciliationRun.objects.exists())
