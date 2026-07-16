from django.core import mail
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer


class CustomerSecondaryEmailVerificationTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200002222", email="ama@example.com", password_hash="x",
        )
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}"
        )

    def test_request_sets_pending_email_and_sends_a_real_email(self):
        response = self.client.post(
            "/api/accounts/customers/me/secondary-email/",
            {"secondary_email": "recovery@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["secondary_email"], "recovery@example.com")
        self.assertNotIn("demo_code", body)

        self.customer.refresh_from_db()
        self.assertEqual(self.customer.secondary_email, "recovery@example.com")
        self.assertFalse(self.customer.secondary_email_verified)
        self.assertRegex(self.customer.secondary_email_verify_code, r"^\d{6}$")
        self.assertIsNotNone(self.customer.secondary_email_verify_expires_at)

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ["recovery@example.com"])
        self.assertIn(self.customer.secondary_email_verify_code, sent.body)

    def test_request_rejects_same_as_primary_email(self):
        response = self.client.post(
            "/api/accounts/customers/me/secondary-email/",
            {"secondary_email": "ama@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_confirm_with_correct_code_marks_verified(self):
        self.client.post(
            "/api/accounts/customers/me/secondary-email/",
            {"secondary_email": "recovery@example.com"},
            format="json",
        )
        self.customer.refresh_from_db()
        code = self.customer.secondary_email_verify_code

        response = self.client.post(
            "/api/accounts/customers/me/secondary-email/confirm/", {"code": code}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["secondary_email_verified"])

        self.customer.refresh_from_db()
        self.assertTrue(self.customer.secondary_email_verified)
        self.assertIsNone(self.customer.secondary_email_verify_code)
        self.assertIsNone(self.customer.secondary_email_verify_expires_at)

    def test_confirm_with_wrong_code_fails(self):
        self.client.post(
            "/api/accounts/customers/me/secondary-email/",
            {"secondary_email": "recovery@example.com"},
            format="json",
        )
        response = self.client.post(
            "/api/accounts/customers/me/secondary-email/confirm/", {"code": "000000"}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.customer.refresh_from_db()
        self.assertFalse(self.customer.secondary_email_verified)

    def test_confirm_with_expired_code_fails(self):
        self.client.post(
            "/api/accounts/customers/me/secondary-email/",
            {"secondary_email": "recovery@example.com"},
            format="json",
        )
        self.customer.refresh_from_db()
        self.customer.secondary_email_verify_expires_at = timezone.now() - timezone.timedelta(minutes=1)
        self.customer.save(update_fields=["secondary_email_verify_expires_at"])

        response = self.client.post(
            "/api/accounts/customers/me/secondary-email/confirm/",
            {"code": self.customer.secondary_email_verify_code},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_confirm_without_a_pending_request_fails(self):
        response = self.client.post(
            "/api/accounts/customers/me/secondary-email/confirm/", {"code": "123456"}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_business_owner_cannot_access_endpoint(self):
        owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207662001", password_hash="x",
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        response = client.post(
            "/api/accounts/customers/me/secondary-email/",
            {"secondary_email": "x@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)


class CustomerSecondaryPhoneVerificationTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200002222", password_hash="x",
        )
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}"
        )

    def test_request_sets_pending_phone_and_returns_demo_code(self):
        response = self.client.post(
            "/api/accounts/customers/me/secondary-phone/",
            {"secondary_phone": "+233200003333"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["secondary_phone"], "+233200003333")
        self.assertRegex(body["demo_code"], r"^\d{6}$")

    def test_request_rejects_same_as_primary_phone(self):
        response = self.client.post(
            "/api/accounts/customers/me/secondary-phone/",
            {"secondary_phone": "+233200002222"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_confirm_with_correct_code_marks_verified(self):
        request_response = self.client.post(
            "/api/accounts/customers/me/secondary-phone/",
            {"secondary_phone": "+233200003333"},
            format="json",
        )
        code = request_response.json()["demo_code"]

        response = self.client.post(
            "/api/accounts/customers/me/secondary-phone/confirm/", {"code": code}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["secondary_phone_verified"])

        self.customer.refresh_from_db()
        self.assertTrue(self.customer.secondary_phone_verified)
        self.assertIsNone(self.customer.secondary_phone_verify_code)

    def test_confirm_with_wrong_code_fails(self):
        self.client.post(
            "/api/accounts/customers/me/secondary-phone/",
            {"secondary_phone": "+233200003333"},
            format="json",
        )
        response = self.client.post(
            "/api/accounts/customers/me/secondary-phone/confirm/", {"code": "000000"}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
