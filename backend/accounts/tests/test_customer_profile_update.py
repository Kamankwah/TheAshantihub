import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _real_jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("avatar.jpg", buf.read(), content_type="image/jpeg")


def _spoofed_executable():
    return SimpleUploadedFile(
        "fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes", content_type="image/jpeg"
    )


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class CustomerProfileUpdateTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200002222", password_hash="x",
        )
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}"
        )

    def test_customer_can_update_full_name(self):
        response = self.client.patch(
            "/api/accounts/customers/me/profile/", {"full_name": "Ama Owusu"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.full_name, "Ama Owusu")

    def test_customer_can_upload_avatar(self):
        response = self.client.patch(
            "/api/accounts/customers/me/profile/",
            {"avatar": _real_jpeg()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertTrue(bool(self.customer.avatar))
        self.assertIn("customer_avatars/", response.json()["avatar"])

    def test_spoofed_avatar_image_is_rejected(self):
        response = self.client.patch(
            "/api/accounts/customers/me/profile/",
            {"avatar": _spoofed_executable()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("avatar", response.json())

    def test_response_includes_read_only_phone_and_email(self):
        response = self.client.patch(
            "/api/accounts/customers/me/profile/", {"full_name": "Ama Owusu"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["phone"], "+233200002222")
        self.assertIsNone(body["email"])

    def test_cannot_change_primary_phone_or_email_via_patch(self):
        response = self.client.patch(
            "/api/accounts/customers/me/profile/",
            {"phone": "+233200009999", "email": "new@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, "+233200002222")
        self.assertIsNone(self.customer.email)

    def test_customer_can_update_address_gender_and_date_of_birth(self):
        response = self.client.patch(
            "/api/accounts/customers/me/profile/",
            {"address": "12 Prempeh II St, Kumasi", "gender": "female", "date_of_birth": "1998-04-02"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.address, "12 Prempeh II St, Kumasi")
        self.assertEqual(self.customer.gender, "female")
        self.assertEqual(str(self.customer.date_of_birth), "1998-04-02")

    def test_customer_can_toggle_notification_preferences(self):
        response = self.client.patch(
            "/api/accounts/customers/me/profile/",
            {"email_notifications_enabled": False, "sms_notifications_enabled": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertFalse(self.customer.email_notifications_enabled)
        self.assertFalse(self.customer.sms_notifications_enabled)

    def test_cannot_set_secondary_email_or_phone_via_patch(self):
        # secondary_email/secondary_phone are read-only on this serializer —
        # only CustomerSecondaryEmail/PhoneRequestView (its own endpoint) may
        # set them, since doing so must also kick off verification.
        response = self.client.patch(
            "/api/accounts/customers/me/profile/",
            {"secondary_email": "recovery@example.com", "secondary_phone": "+233200003333"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertIsNone(self.customer.secondary_email)
        self.assertIsNone(self.customer.secondary_phone)

    def test_customer_can_fetch_their_own_profile(self):
        response = self.client.get("/api/accounts/customers/me/profile/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["full_name"], "Ama Buyer")

    def test_business_owner_cannot_access_endpoint(self):
        owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207662001", password_hash="x",
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        response = client.patch(
            "/api/accounts/customers/me/profile/", {"full_name": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_access_endpoint(self):
        client = APIClient()
        response = client.patch(
            "/api/accounts/customers/me/profile/", {"full_name": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_cannot_update_another_customers_profile(self):
        other = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200002233", password_hash="x",
        )
        response = self.client.patch(
            "/api/accounts/customers/me/profile/", {"full_name": "Hijacked"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        other.refresh_from_db()
        self.assertEqual(other.full_name, "Yaw Buyer")
