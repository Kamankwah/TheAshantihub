import datetime

from django.contrib.auth.hashers import check_password, make_password
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer, PasswordResetToken, Role, StaffUser


class PasswordResetRequestTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer",
            phone="+233200002222",
            email="ama@example.com",
            password_hash=make_password("old-password"),
        )

    def test_request_creates_a_token_and_sends_an_email_when_the_account_exists(self):
        response = self.client.post(
            "/api/accounts/password-reset/request/",
            {"email": "ama@example.com", "account_type": "customer"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

        token = PasswordResetToken.objects.get(account_type="customer", account_id=self.customer.id)
        self.assertIsNotNone(token.token)
        self.assertIsNone(token.used_at)
        self.assertGreater(token.expires_at, timezone.now())

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ["ama@example.com"])
        self.assertIn(token.token, sent.body)
        self.assertIn("https://theashantihub.com/reset-password?token=", sent.body)

    def test_request_is_silent_and_generic_when_the_account_does_not_exist(self):
        response = self.client.post(
            "/api/accounts/password-reset/request/",
            {"email": "nobody@example.com", "account_type": "customer"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(PasswordResetToken.objects.exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_request_is_generic_when_the_email_matches_a_different_account_type(self):
        # ama@example.com exists as a customer, not a business owner.
        response = self.client.post(
            "/api/accounts/password-reset/request/",
            {"email": "ama@example.com", "account_type": "business_owner"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(PasswordResetToken.objects.exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_request_rejects_an_unknown_account_type(self):
        response = self.client.post(
            "/api/accounts/password-reset/request/",
            {"email": "ama@example.com", "account_type": "superuser"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class PasswordResetConfirmTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer",
            phone="+233200002222",
            email="ama@example.com",
            password_hash=make_password("old-password"),
        )
        self.other_customer = Customer.objects.create(
            full_name="Kojo Buyer",
            phone="+233200004444",
            email="kojo@example.com",
            password_hash=make_password("kojo-password"),
        )
        self.staff = StaffUser.objects.create(
            full_name="Kwame Support",
            email="kwame@example.com",
            password_hash=make_password("staff-password"),
            role=Role.objects.get(name="support"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader",
            login_phone="+233207662001",
            email="kofi@example.com",
            password_hash=make_password("owner-password"),
        )

    def _make_token(self, account_type, account_id, **overrides):
        defaults = {
            "account_type": account_type,
            "account_id": account_id,
            "token": "a-valid-token-123",
            "expires_at": timezone.now() + datetime.timedelta(hours=1),
        }
        defaults.update(overrides)
        return PasswordResetToken.objects.create(**defaults)

    def test_confirm_works_with_a_valid_token(self):
        token = self._make_token("customer", self.customer.id)
        response = self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": token.token, "account_type": "customer", "password": "brand-new-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

        self.customer.refresh_from_db()
        self.assertTrue(check_password("brand-new-password", self.customer.password_hash))

        token.refresh_from_db()
        self.assertIsNotNone(token.used_at)

    def test_confirm_actually_changes_the_password_can_log_in_with_new_password(self):
        token = self._make_token("customer", self.customer.id)
        self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": token.token, "account_type": "customer", "password": "brand-new-password"},
            format="json",
        )

        old_login = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "ama@example.com", "password": "old-password"},
            format="json",
        )
        self.assertEqual(old_login.status_code, 400)

        new_login = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "ama@example.com", "password": "brand-new-password"},
            format="json",
        )
        self.assertEqual(new_login.status_code, 200, new_login.content)

    def test_confirm_works_for_business_owner_and_staff_account_types(self):
        owner_token = self._make_token("business_owner", self.owner.id, token="owner-token-abc")
        response = self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": owner_token.token, "account_type": "business_owner", "password": "new-owner-pass"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.owner.refresh_from_db()
        self.assertTrue(check_password("new-owner-pass", self.owner.password_hash))

        staff_token = self._make_token("staff", self.staff.id, token="staff-token-abc")
        response = self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": staff_token.token, "account_type": "staff", "password": "new-staff-pass"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.staff.refresh_from_db()
        self.assertTrue(check_password("new-staff-pass", self.staff.password_hash))

    def test_confirm_rejects_expired_token(self):
        token = self._make_token(
            "customer", self.customer.id,
            expires_at=timezone.now() - datetime.timedelta(minutes=1),
        )
        response = self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": token.token, "account_type": "customer", "password": "brand-new-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.customer.refresh_from_db()
        self.assertTrue(check_password("old-password", self.customer.password_hash))

    def test_confirm_rejects_already_used_token(self):
        token = self._make_token(
            "customer", self.customer.id, used_at=timezone.now() - datetime.timedelta(minutes=5),
        )
        response = self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": token.token, "account_type": "customer", "password": "brand-new-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.customer.refresh_from_db()
        self.assertTrue(check_password("old-password", self.customer.password_hash))

    def test_confirm_rejects_a_token_issued_for_a_different_account_type(self):
        token = self._make_token("customer", self.customer.id)
        response = self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": token.token, "account_type": "business_owner", "password": "brand-new-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.customer.refresh_from_db()
        self.assertTrue(check_password("old-password", self.customer.password_hash))

    def test_confirm_rejects_an_unknown_token(self):
        response = self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": "does-not-exist", "account_type": "customer", "password": "brand-new-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_confirm_does_not_leak_another_customers_password_reset(self):
        token = self._make_token("customer", self.customer.id)
        self.client.post(
            "/api/accounts/password-reset/confirm/",
            {"token": token.token, "account_type": "customer", "password": "brand-new-password"},
            format="json",
        )
        self.other_customer.refresh_from_db()
        self.assertTrue(check_password("kojo-password", self.other_customer.password_hash))
