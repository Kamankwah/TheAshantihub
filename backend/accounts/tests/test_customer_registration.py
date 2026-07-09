from django.contrib.auth.hashers import check_password
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Customer


class CustomerRegistrationTests(TestCase):
    def setUp(self):
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
