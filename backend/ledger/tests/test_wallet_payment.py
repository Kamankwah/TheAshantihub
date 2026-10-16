"""Paying for an order from the AshantiHub wallet, and the payment-processing line on a MoMo payment (wallets plan 3a,
Task 3). Review Focus 1 (double spend), 2 (a wallet that covers only part) and 7 (ledger off)."""
import threading
from decimal import Decimal

from django.core.cache import cache
from django.db import connection, transaction
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from cart.models import Cart
from ledger import escrow, posting
from ledger.models import Account, Journal, OrderFeeSnapshot
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem
from payments.models import CheckoutSession

from .test_order_payment import OrderPaymentBase


def fund(customer, pesewas, key):
    """Put money in a customer's wallet the way a top-up does: provider clearing in, the wallet credited."""
    posting.post(key=key, kind="wallet_top_up", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas),
        posting.credit(posting.account_for(Account.CUSTOMER_WALLET, customer), pesewas),
    ])


class CheckoutBase(OrderPaymentBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.kofi = self.owner("Kofi")
        self.item = self.listing(self.kofi, "60.00")
        self.item.stock_quantity = 5
        self.item.save(update_fields=["stock_quantity"])

    def add_to_cart(self, quantity=2):
        added = self.client.post("/api/cart/items/", {"listing": self.item.id, "quantity": quantity}, format="json")
        self.assertIn(added.status_code, (200, 201), added.content)

    def checkout(self, **body):
        return self.client.post("/api/orders/checkout/", body, format="json")

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)


@override_settings(LEDGER_ENABLED=True)
class WalletCheckoutTests(CheckoutBase):
    def test_an_order_paid_from_the_wallet_debits_the_wallet_not_the_provider(self):
        fund(self.customer, 15000, "fund-1")
        self.add_to_cart(2)                                                              # GH₵ 120.00
        response = self.checkout(payment_method="wallet")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["payment_method"], body["payment_processing"]), ("wallet", "0.00"))
        order = Order.objects.get(pk=body["id"])
        self.assertEqual(order.status, Order.PAID)
        self.assertEqual(self.wallet(), 3000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 12000)
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 15000)                 # only the top-up came through the provider
        session = CheckoutSession.objects.get(metadata__order_id=order.pk)
        self.assertEqual((session.provider, session.amount, session.processing_fee), ("wallet", Decimal("120.00"), Decimal("0.00")))
        self.assertTrue(session.metadata["ledger"])
        self.assertEqual(Transaction.objects.get(reference=session.reference).amount, Decimal("120.00"))
        self.assertFalse(Cart.objects.get(customer=self.customer).items.exists())

    def test_review_focus_a_wallet_that_covers_only_part_pays_nothing_and_changes_nothing(self):
        fund(self.customer, 5000, "fund-1")
        self.add_to_cart(2)
        response = self.checkout(payment_method="wallet")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "insufficient_funds"), response.content)
        self.assertFalse(Order.objects.exists())
        self.assertFalse(CheckoutSession.objects.exists())
        self.assertFalse(OrderFeeSnapshot.objects.exists())
        self.assertEqual(self.wallet(), 5000)
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock_quantity, 5)                                    # the reservation was undone
        self.assertEqual(Cart.objects.get(customer=self.customer).items.count(), 1)      # the cart is kept

    def test_a_wallet_payment_never_redirects_even_with_hubtel(self):
        fund(self.customer, 15000, "fund-1")
        self.add_to_cart(2)
        with override_settings(PAYMENTS_PROVIDER="hubtel"):
            response = self.checkout(payment_method="wallet")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("mode", response.json())
        self.assertEqual(self.wallet(), 3000)

    def test_an_unknown_payment_method_is_refused(self):
        self.add_to_cart(1)
        response = self.checkout(payment_method="card")
        self.assertEqual(response.status_code, 400)
        self.assertIn("payment_method", response.json())
        self.assertFalse(Order.objects.exists())

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_momo_adds_payment_processing_on_top_and_the_ledger_records_the_net(self):
        self.add_to_cart(2)
        response = self.checkout()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["payment_method"], body["payment_processing"], body["total_amount"]), ("momo", "2.40", "120.00"))
        session = CheckoutSession.objects.get(metadata__order_id=body["id"])
        self.assertEqual((session.amount, session.processing_fee, session.provider), (Decimal("122.40"), Decimal("2.40"), "simulated"))
        self.assertEqual(Transaction.objects.get(reference=session.reference).amount, Decimal("122.40"))
        self.assertEqual(self.balance(Account.PROVIDER_CLEARING), 12000)                 # the provider kept GH₵ 2.40

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_a_wallet_payment_carries_no_processing_charge(self):
        fund(self.customer, 12000, "fund-1")
        self.add_to_cart(2)
        response = self.checkout(payment_method="wallet")
        self.assertEqual((response.status_code, response.json()["payment_processing"]), (201, "0.00"))
        self.assertEqual(self.wallet(), 0)


class LedgerOffCheckoutTests(CheckoutBase):
    def test_review_focus_with_the_ledger_off_checkout_is_exactly_as_before(self):
        self.add_to_cart(2)
        response = self.checkout()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("payment_method", response.json())
        self.assertNotIn("payment_processing", response.json())
        session = CheckoutSession.objects.get(metadata__order_id=response.json()["id"])
        self.assertEqual((session.amount, session.processing_fee, session.provider), (Decimal("120.00"), Decimal("0.00"), "simulated"))
        self.assertNotIn("ledger", session.metadata)
        self.assertFalse(Account.objects.exists())

    def test_paying_from_the_wallet_is_refused_while_the_ledger_is_off(self):
        self.add_to_cart(1)
        response = self.checkout(payment_method="wallet")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertFalse(Order.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class WalletDoubleSpendTests(TransactionTestCase):
    serialized_rollback = True

    def test_review_focus_two_wallet_payments_at_once_never_spend_one_balance_twice(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990001", password_hash="x")
        listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Kente", description="D.", contact_phone=owner.login_phone, price_amount=Decimal("100.00"), status=Listing.PUBLISHED,
        )
        fund(customer, 15000, "fund-1")
        orders = []
        for _ in range(2):
            order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("100.00"))
            OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=Decimal("100.00"), line_total=Decimal("100.00"))
            orders.append(order)
        results, barrier = [], threading.Barrier(2)

        def pay(order):
            try:
                barrier.wait()
                with transaction.atomic():
                    escrow.record_order_payment(order, wallet=True)
                results.append("paid")
            except posting.InsufficientFunds:
                results.append("refused")
            finally:
                connection.close()

        threads = [threading.Thread(target=pay, args=(order,)) for order in orders]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(sorted(results), ["paid", "refused"])
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, customer), 5000)
        self.assertEqual(Journal.objects.filter(kind="order_payment").count(), 1)
        self.assertEqual(OrderFeeSnapshot.objects.count(), 1)
