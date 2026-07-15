from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer, Role, StaffUser


class LoginTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Owusu",
            phone="+233241234567",
            email="ama@example.com",
            password_hash=make_password("correct-horse-battery-staple"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Business",
            login_phone="+233201112233",
            email="kwame@example.com",
            password_hash=make_password("correct-horse-battery-staple"),
        )
        self.staff = StaffUser.objects.create(
            full_name="Support Staffer",
            email="support@example.com",
            password_hash=make_password("correct-horse-battery-staple"),
            role=Role.objects.get(name=Role.SUPPORT),
        )

    def test_customer_login_with_phone_succeeds(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["account_type"], "customer")
        self.assertEqual(data["id"], self.customer.id)
        self.assertEqual(data["full_name"], "Ama Owusu")
        self.assertTrue(data["token"])

    def test_customer_login_with_email_succeeds(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "ama@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_customer_login_wrong_password_rejected(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"non_field_errors": ["Invalid credentials"]})

    def test_customer_login_unknown_identifier_returns_same_error_as_wrong_password(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233200000000", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"non_field_errors": ["Invalid credentials"]})

    def test_business_owner_login_with_phone_succeeds(self):
        response = self.client.post(
            "/api/accounts/business-owners/login/",
            {"identifier": "+233201112233", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["account_type"], "business_owner")
        self.assertEqual(data["id"], self.owner.id)

    def test_business_owner_login_succeeds_while_kyc_pending(self):
        self.assertEqual(self.owner.kyc_status, BusinessOwner.PENDING)
        response = self.client.post(
            "/api/accounts/business-owners/login/",
            {"identifier": "kwame@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_staff_login_with_email_succeeds(self):
        response = self.client.post(
            "/api/accounts/staff/login/",
            {"identifier": "support@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["account_type"], "staff")
        self.assertEqual(data["id"], self.staff.id)

    def test_login_token_authenticates_against_me_endpoint(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "correct-horse-battery-staple"},
            format="json",
        )
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["id"], self.customer.id)

    def test_login_throttles_after_five_requests_per_minute(self):
        for _ in range(5):
            response = self.client.post(
                "/api/accounts/customers/login/",
                {"identifier": "+233241234567", "password": "wrong-password"},
                format="json",
            )
            self.assertNotEqual(response.status_code, 429)
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 429)

    def test_staff_login_response_includes_role_and_permissions(self):
        response = self.client.post(
            "/api/accounts/staff/login/",
            {"identifier": "support@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["role"], "support")
        self.assertCountEqual(
            data["permissions"],
            ["messaging.manage", "disputes.flag", "users.view", "reviews.moderate"],
        )

    def test_customer_login_response_has_no_role_or_permissions_keys(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "correct-horse-battery-staple"},
            format="json",
        )
        data = response.json()
        self.assertNotIn("role", data)
        self.assertNotIn("permissions", data)

    def test_business_owner_login_response_has_no_role_or_permissions_keys(self):
        response = self.client.post(
            "/api/accounts/business-owners/login/",
            {"identifier": "+233201112233", "password": "correct-horse-battery-staple"},
            format="json",
        )
        data = response.json()
        self.assertNotIn("role", data)
        self.assertNotIn("permissions", data)
