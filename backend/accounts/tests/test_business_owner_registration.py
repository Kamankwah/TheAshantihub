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


class BusinessOwnerRegistrationEmailTests(TestCase):
    """A self-registering business must give an email: the go-live rule needs a confirmed one, and the confirmation
    link is sent at sign-up."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.payload = {
            "full_name": "Abena Boateng", "login_phone": "+233245551133", "email": "abena2@example.com",
            "password": "correct-horse-battery-staple",
        }

    def register(self, **changes):
        payload = {**self.payload, **changes}
        payload = {key: value for key, value in payload.items() if value is not ...}
        return self.client.post("/api/accounts/business-owners/register/", payload, format="json")

    def test_a_missing_email_is_refused_in_plain_words(self):
        response = self.register(email=...)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["email"], ["Enter your email so we can send you a confirmation link."])
        self.assertFalse(BusinessOwner.objects.filter(login_phone="+233245551133").exists())

    def test_a_blank_or_null_email_is_refused_in_the_same_words(self):
        for value in ("", "   ", None):
            response = self.register(email=value)
            self.assertEqual(response.status_code, 400, (value, response.content))
            self.assertEqual(response.json()["email"], ["Enter your email so we can send you a confirmation link."])

    def test_a_malformed_email_is_refused(self):
        response = self.register(email="not-an-email")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("email", response.json())

    def test_a_valid_email_registers(self):
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(BusinessOwner.objects.get(login_phone="+233245551133").email, "abena2@example.com")
