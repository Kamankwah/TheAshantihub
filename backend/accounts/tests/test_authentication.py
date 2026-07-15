from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer


class MultiAccountAuthenticationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Owusu",
            phone="+233241234567",
            email="ama@example.com",
            password_hash="unused-in-this-test",
        )

    def test_me_endpoint_requires_authentication(self):
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 401)

    def test_me_endpoint_resolves_customer_from_token(self):
        token = issue_token(self.customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"account_type": "customer", "id": self.customer.id, "full_name": "Ama Owusu"},
        )

    def test_invalid_token_is_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 401)

    def test_me_endpoint_includes_role_and_permissions_for_staff(self):
        from accounts.models import Role, StaffUser

        staff = StaffUser.objects.create(
            full_name="Akosua Support",
            email="akosua-me-test@example.com",
            password_hash="unused-in-this-test",
            role=Role.objects.get(name=Role.SUPPORT),
        )
        token = issue_token(staff, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["role"], "support")
        self.assertCountEqual(
            data["permissions"],
            ["messaging.manage", "disputes.flag", "users.view", "reviews.moderate", "contact_messages.manage"],
        )
