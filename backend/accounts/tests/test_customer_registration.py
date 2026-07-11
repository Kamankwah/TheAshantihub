from django.contrib.auth.hashers import check_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Customer


class CustomerRegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.valid_payload = {
            "full_name": "Kofi Mensah",
            "phone": "+233201112233",
            "email": "kofi@example.com",
            "password": "correct-horse-battery-staple",
        }

    def test_registration_creates_customer_with_hashed_password(self):
        response = self.client.post(
            "/api/accounts/customers/register/", self.valid_payload, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("password", response.json())
        self.assertNotIn("password_hash", response.json())

        customer = Customer.objects.get(phone="+233201112233")
        self.assertTrue(check_password("correct-horse-battery-staple", customer.password_hash))

    def test_duplicate_phone_is_rejected(self):
        Customer.objects.create(
            full_name="Existing", phone="+233201112233", password_hash="x"
        )
        response = self.client.post(
            "/api/accounts/customers/register/", self.valid_payload, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("phone", response.json())

    def test_registration_requires_phone_or_email(self):
        payload = {
            "full_name": "John Doe",
            "password": "correct-horse-battery-staple",
        }
        response = self.client.post(
            "/api/accounts/customers/register/", payload, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_registration_response_includes_a_working_token(self):
        response = self.client.post(
            "/api/accounts/customers/register/", self.valid_payload, format="json"
        )
        self.assertEqual(response.status_code, 201)
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["account_type"], "customer")
