from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, Role, StaffUser
from accounts.serializers import mask_but_last
from payments.models import CheckoutSession


class MaskHelperTests(TestCase):
    def test_masks_all_but_last_five(self):
        self.assertEqual(mask_but_last("0244123456"), "•••••23456")

    def test_short_value_is_fully_masked(self):
        # A value no longer than the keep length reveals nothing.
        self.assertEqual(mask_but_last("1234"), "••••")

    def test_empty_is_none(self):
        self.assertIsNone(mask_but_last(""))
        self.assertIsNone(mask_but_last(None))


class StaffUserDetailTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-detail@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233241234567", email="ama-detail@example.com",
            address="12 Ash Road, Kumasi", password_hash=make_password("x"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233201112233", email="kwame-detail@example.com",
            password_hash=make_password("x"),
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner, business_kind="product", gps_address="AK-039-5028",
            tin="C0001234567", is_formal=True,
            payout_momo_network="MTN", payout_momo_name="Kwame Trader",
            payout_momo_number="0244999888", default_payout_method="momo",
        )
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT,
            amount="150.00", purpose="Order #5", status=CheckoutSession.SUCCESS,
        )

    def _auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.admin, 'staff')}")

    def test_customer_detail_includes_address_and_payment_history(self):
        self._auth()
        response = self.client.get(f"/api/accounts/customers/{self.customer.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["address"], "12 Ash Road, Kumasi")
        self.assertEqual(len(body["payment_history"]), 1)
        row = body["payment_history"][0]
        self.assertEqual(row["purpose"], "Order #5")
        self.assertEqual(row["amount"], "150.00")
        self.assertEqual(row["status"], "success")

    def test_customer_detail_never_ships_a_card_number_or_payment_type(self):
        """No payment-instrument model exists — the detail must not fabricate a
        'payment type' or 'last 5 digits' field for a customer.
        """
        self._auth()
        body = self.client.get(f"/api/accounts/customers/{self.customer.id}/").json()
        self.assertNotIn("payment_type", body)
        self.assertNotIn("card_last_5", body)

    def test_business_owner_detail_surfaces_profile_and_masks_payout_number(self):
        self._auth()
        response = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        profile = response.json()["profile"]
        self.assertEqual(profile["business_kind"], "product")
        self.assertEqual(profile["gps_address"], "AK-039-5028")
        self.assertEqual(profile["tin"], "C0001234567")
        self.assertEqual(profile["payout_momo_number_masked"], "•••••99888")

    def test_business_owner_detail_never_ships_the_full_payout_number(self):
        self._auth()
        raw = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/").content.decode()
        self.assertNotIn("0244999888", raw)

    def test_business_owner_without_profile_is_tolerated(self):
        ownerless = BusinessOwner.objects.create(
            full_name="No Profile", login_phone="+233209990000", password_hash="x",
        )
        self._auth()
        response = self.client.get(f"/api/accounts/business-owners/{ownerless.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(response.json()["profile"])
