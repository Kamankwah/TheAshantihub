from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer

import tempfile
import io
from PIL import Image

TEST_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class BusinessOwnerProfileUpdateTests(TestCase):
    def _make_owner(self, kyc_status, **profile_overrides):
        owner = BusinessOwner.objects.create(
            full_name="Adjoa Seller", login_phone="+233208889900", password_hash="x",
            kyc_status=kyc_status,
            kyc_rejection_reason="Blurry Ghana Card" if kyc_status == BusinessOwner.REJECTED else None,
        )
        defaults = dict(
            business_owner=owner,
            ghana_card_number="GHA-777888999-0",
            gps_address="AK-039-5050",
            business_contact_phone="+233208889900",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233208889900",
            payout_momo_name="Adjoa Seller",
        )
        defaults.update(profile_overrides)
        BusinessOwnerProfile.objects.create(**defaults)
        return owner

    def _token(self, owner):
        return issue_token(owner, "business_owner")

    def test_rejected_owner_can_edit_and_resubmits_to_pending(self):
        owner = self._make_owner(BusinessOwner.REJECTED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"gps_address": "AK-039-9999"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        owner.refresh_from_db()
        owner.profile.refresh_from_db()
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)
        self.assertIsNone(owner.kyc_rejection_reason)
        self.assertEqual(owner.profile.gps_address, "AK-039-9999")

    def test_pending_owner_can_edit_without_status_change(self):
        owner = self._make_owner(BusinessOwner.PENDING)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"gps_address": "AK-039-1111"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        owner.refresh_from_db()
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)

    def test_non_ashanti_gps_address_is_rejected(self):
        owner = self._make_owner(BusinessOwner.PENDING)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"gps_address": "GA-543-0125"},  # Greater Accra — not Ashanti
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("gps_address", response.json())

    def test_malformed_gps_address_is_rejected(self):
        owner = self._make_owner(BusinessOwner.PENDING)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"gps_address": "not-a-code"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("gps_address", response.json())

    def test_blank_ghana_card_number_is_rejected(self):
        owner = self._make_owner(BusinessOwner.PENDING, ghana_card_number="")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"business_contact_phone": "+233208889901"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("ghana_card_number", response.json())

    def test_verified_owner_cannot_edit(self):
        owner = self._make_owner(BusinessOwner.VERIFIED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"gps_address": "AK-039-2222"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_toggling_is_formal_true_without_documents_is_rejected(self):
        owner = self._make_owner(BusinessOwner.REJECTED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"is_formal": "true"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("business_reg_certificate", response.json())

    def test_customer_cannot_access_endpoint(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200002222", password_hash="x")
        token = issue_token(customer, "customer")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/", {"gps_address": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_disallowed_ghana_card_image_format_is_rejected(self):
        owner = self._make_owner(BusinessOwner.REJECTED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")

        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, format="GIF")
        buf.seek(0)

        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"ghana_card_front_image": SimpleUploadedFile("front.gif", buf.read(), content_type="image/gif")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("ghana_card_front_image", response.json())
        self.assertIn("Unsupported file type", response.json()["ghana_card_front_image"][0])

    def test_spoofed_ghana_card_image_is_rejected(self):
        owner = self._make_owner(BusinessOwner.REJECTED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"ghana_card_front_image": SimpleUploadedFile(
                "fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes", content_type="image/jpeg"
            )},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("ghana_card_front_image", response.json())

    def test_owner_can_fetch_their_own_profile(self):
        owner = self._make_owner(BusinessOwner.PENDING)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.get("/api/accounts/business-owners/me/profile/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ghana_card_number"], "GHA-777888999-0")
