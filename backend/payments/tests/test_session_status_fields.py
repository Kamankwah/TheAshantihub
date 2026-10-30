from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer
from payments.models import CheckoutSession


class SessionStatusFieldsTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(full_name="Yaw", phone="+233200994001", password_hash="x")
        self.other = Customer.objects.create(full_name="Esi", phone="+233200994002", password_hash="x")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")

    def session(self, **kwargs):
        defaults = dict(customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT, amount="102.00", purpose="Order")
        return CheckoutSession.objects.create(**{**defaults, **kwargs})

    def get(self, session):
        return self.client.get(f"/api/payments/checkout-sessions/{session.reference}/")

    def test_owner_sees_processing_fee_wallet_flag_and_order_id(self):
        momo = self.session(processing_fee="2.00", metadata={"order_id": 41, "secret": "internal"})
        body = self.get(momo).json()
        self.assertEqual((body["processing_fee"], body["wallet"], body["order_id"]), ("2.00", False, 41))
        self.assertNotIn("metadata", body)
        self.assertNotIn("secret", str(body))
        wallet = self.session(provider=CheckoutSession.WALLET, metadata={"order_id": 42})
        body = self.get(wallet).json()
        self.assertEqual((body["processing_fee"], body["wallet"], body["order_id"]), ("0.00", True, 42))

    def test_order_id_is_null_without_an_order(self):
        topup = self.session(kind=CheckoutSession.WALLET_TOPUP)
        self.assertIsNone(self.get(topup).json()["order_id"])
        junk = self.session(metadata={"order_id": "abc"})
        self.assertIsNone(self.get(junk).json()["order_id"])

    def test_another_customers_session_is_404(self):
        theirs = self.session(customer=self.other)
        self.assertEqual(self.get(theirs).status_code, 404)
