"""Staff users.view reads never carry a full phone: list and detail are masked,
only the users.manage PATCH response echoes the saved full values, and the
full phone comes from the sudo-gated reveal endpoints."""
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, Role, StaffUser


class UsersPiiMaskingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233241234567", email="amabuyer@example.com",
            address="12 Ash Road", password_hash=make_password("x"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233201112233", email="kwametrader@example.com",
            password_hash=make_password("x"),
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, business_kind="product", business_contact_phone="0209998877",
        )

    def _as(self, role):
        staff = StaffUser.objects.create(
            full_name=f"{role} P", email=f"{role}-pii@example.com", password_hash="x",
            role=Role.objects.get(name=role),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def test_customer_list_masks_phone_and_email(self):
        self._as("support")
        row = self.client.get("/api/accounts/customers/").json()["results"][0]
        self.assertEqual(row["phone"], "024 *** 4567")
        self.assertNotIn("1234567", str(row))
        self.assertEqual(row["email"], "am•••@example.com")

    def test_owner_list_masks_phone_and_email(self):
        self._as("support")
        row = self.client.get("/api/accounts/business-owners/").json()["results"][0]
        self.assertEqual(row["login_phone"], "020 *** 2233")
        self.assertEqual(row["email"], "kw•••@example.com")

    def test_customer_detail_masks_phone_for_view_and_manage(self):
        for role in ("support", "operations"):
            self._as(role)
            body = self.client.get(f"/api/accounts/customers/{self.customer.id}/").json()
            self.assertEqual(body["phone"], "024 *** 4567")

    def test_owner_detail_masks_login_and_contact_phone(self):
        self._as("operations")
        body = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/").json()
        self.assertEqual(body["login_phone"], "020 *** 2233")
        self.assertEqual(body["profile"]["business_contact_phone"], "020 *** 8877")

    def test_manage_patch_response_carries_full_values(self):
        self._as("operations")
        response = self.client.patch(
            f"/api/accounts/customers/{self.customer.id}/", {"full_name": "Ama B"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["phone"], "+233241234567")

    def test_patch_with_the_masked_phone_is_refused(self):
        self._as("operations")
        response = self.client.patch(
            f"/api/accounts/customers/{self.customer.id}/", {"phone": "024 *** 4567"}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, "+233241234567")
        response = self.client.patch(
            f"/api/accounts/business-owners/{self.owner.id}/", {"login_phone": "020 *** 2233"}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_reveal_is_sudo_gated(self):
        self._as("support")
        response = self.client.post(f"/api/marketplace/customers/{self.customer.id}/reveal-phone/", {}, format="json")
        self.assertIn(response.status_code, (401, 403))
        self.assertNotIn("1234567", response.content.decode())
