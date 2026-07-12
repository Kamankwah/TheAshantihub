from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser


class UsersListTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        Customer.objects.create(
            full_name="Ama Owusu", phone="+233241234567", email="ama@example.com",
            password_hash=make_password("x"),
        )
        BusinessOwner.objects.create(
            full_name="Kwame Business", login_phone="+233201112233", email="kwame@example.com",
            password_hash=make_password("x"),
        )

    def _staff(self, role_name, suffix):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person", email=f"{role_name}-{suffix}@example.com",
            password_hash="x", role=Role.objects.get(name=role_name),
        )
        return issue_token(staff, "staff")

    def test_admin_can_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["full_name"], "Ama Owusu")
        self.assertNotIn("password_hash", data["results"][0])

    def test_support_can_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('support', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 200)

    def test_marketing_cannot_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_list_business_owners(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 2)}")
        response = self.client.get("/api/accounts/business-owners/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["full_name"], "Kwame Business")
        self.assertEqual(data["results"][0]["kyc_status"], "pending")
        self.assertNotIn("password_hash", data["results"][0])

    def test_marketing_cannot_list_business_owners(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 2)}")
        response = self.client.get("/api/accounts/business-owners/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 401)
