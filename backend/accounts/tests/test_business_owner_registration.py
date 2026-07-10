from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from PIL import Image

from accounts.models import BusinessOwner

import io
import tempfile

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="card.jpg"):
    # serializers.ImageField validates real image content via Pillow, so the
    # fixture must be genuine image bytes rather than an arbitrary placeholder.
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def _pdf(name="cert.pdf"):
    # validate_document_content_type sniffs real bytes via python-magic, so the
    # fixture must be genuine PDF bytes rather than an arbitrary placeholder.
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
    return SimpleUploadedFile(name, pdf_bytes, content_type="application/pdf")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class BusinessOwnerRegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.base_payload = {
            "full_name": "Abena Boateng",
            "login_phone": "+233245551122",
            "email": "abena@example.com",
            "password": "correct-horse-battery-staple",
            "ghana_card_number": "GHA-111222333-4",
            "ghana_card_front_image": _image("front.jpg"),
            "ghana_card_back_image": _image("back.jpg"),
            "gps_address": "AK-039-5028",
            "business_contact_phone": "+233209990000",
            "default_payout_method": "momo",
            "payout_momo_network": "MTN",
            "payout_momo_number": "+233209990000",
            "payout_momo_name": "Abena Boateng",
        }

    def test_informal_business_registers_without_documents(self):
        payload = {**self.base_payload, "is_formal": "false"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["kyc_status"], "pending")
        owner = BusinessOwner.objects.get(login_phone="+233245551122")
        self.assertFalse(owner.profile.is_formal)
        self.assertFalse(owner.profile.business_reg_certificate)

    def test_formal_business_without_certificate_is_rejected(self):
        payload = {**self.base_payload, "is_formal": "true", "tin": "C0012345678"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("business_reg_certificate", response.json())

    def test_formal_business_with_documents_succeeds(self):
        payload = {
            **self.base_payload,
            "is_formal": "true",
            "tin": "C0012345678",
            "business_reg_certificate": _pdf(),
        }
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_default_payout_method_must_match_populated_fields(self):
        payload = {**self.base_payload, "is_formal": "false", "default_payout_method": "bank"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("default_payout_method", response.json())

    def test_spoofed_ghana_card_image_is_rejected(self):
        payload = {
            **self.base_payload,
            "is_formal": "false",
            "ghana_card_front_image": SimpleUploadedFile(
                "fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes", content_type="image/jpeg"
            ),
        }
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("ghana_card_front_image", response.json())
