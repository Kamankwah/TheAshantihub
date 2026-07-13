from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner


class BusinessOwnerRegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.payload = {
            "full_name": "Abena Boateng",
            "login_phone": "+233245551122",
            "email": "abena@example.com",
            "password": "correct-horse-battery-staple",
        }

    def test_registration_creates_an_owner_with_an_empty_profile(self):
        response = self.client.post(
            "/api/accounts/business-owners/register/", self.payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["kyc_status"], "pending")
        owner = BusinessOwner.objects.get(login_phone="+233245551122")
        self.assertIsNotNone(owner.profile)
        self.assertFalse(owner.profile.ghana_card_number)
        self.assertEqual(owner.compute_registration_step(), "business_info")

    def test_registration_does_not_require_or_accept_kyc_fields(self):
        payload = {**self.payload, "ghana_card_number": "GHA-000000000-0"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        owner = BusinessOwner.objects.get(login_phone="+233245551122")
        self.assertFalse(owner.profile.ghana_card_number)

    def test_registration_response_includes_a_working_token(self):
        response = self.client.post(
            "/api/accounts/business-owners/register/", self.payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["account_type"], "business_owner")

    def test_password_too_short_is_rejected(self):
        payload = {**self.payload, "password": "short"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json())
