import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer

TEST_MEDIA_ROOT = tempfile.mkdtemp()


class MeEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_customer_me_has_no_business_fields(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200002222", password_hash="x")
        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["account_type"], "customer")
        self.assertNotIn("kyc_status", body)
        self.assertNotIn("registration_step", body)

    def test_customer_me_has_null_avatar_when_unset(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200002222", password_hash="x")
        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["avatar"])

    @override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
    def test_customer_me_has_avatar_url_when_set(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200002222", password_hash="x")
        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, format="JPEG")
        buf.seek(0)
        customer.avatar = SimpleUploadedFile("avatar.jpg", buf.read(), content_type="image/jpeg")
        customer.save()

        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        avatar_url = response.json()["avatar"]
        self.assertIsNotNone(avatar_url)
        self.assertIn("customer_avatars/", avatar_url)
        self.assertTrue(avatar_url.startswith("http"))

    def test_fresh_business_owner_me_reports_business_info_step(self):
        owner = BusinessOwner.objects.create(
            full_name="Kojo Trader", login_phone="+233209990002", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(business_owner=owner)
        token = issue_token(owner, "business_owner")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["kyc_status"], "pending")
        self.assertIsNone(body["kyc_rejection_reason"])
        self.assertEqual(body["registration_step"], "business_info")

    def test_rejected_business_owner_me_reports_reason_and_complete_step(self):
        owner = BusinessOwner.objects.create(
            full_name="Yaa Trader", login_phone="+233209990003", password_hash="x",
            kyc_status=BusinessOwner.REJECTED, kyc_rejection_reason="Blurry Ghana Card",
        )
        BusinessOwnerProfile.objects.create(business_owner=owner)
        token = issue_token(owner, "business_owner")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        body = response.json()
        self.assertEqual(body["kyc_status"], "rejected")
        self.assertEqual(body["kyc_rejection_reason"], "Blurry Ghana Card")
        self.assertEqual(body["registration_step"], "complete")
