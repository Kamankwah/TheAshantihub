import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff, staff_token
from listings.models import Zone

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

    def test_customer_me_includes_email_and_phone(self):
        customer = Customer.objects.create(
            full_name="Ama", phone="+233200002222", email="ama@example.com", password_hash="x",
        )
        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["phone"], "+233200002222")
        self.assertEqual(body["email"], "ama@example.com")

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


class StaffMeManagerAndAreasTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)

    def me(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        return self.client.get("/api/accounts/me/").json()

    def business(self, n, zone, kyc="verified"):
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {n}", login_phone=f"+2332000099{n:02d}", password_hash="x",
            account_manager=self.scout, kyc_status=kyc,
        )
        if zone:
            BusinessOwnerProfile.objects.create(business_owner=owner, business_name=f"Shop {n}", zone=zone)
        return owner

    def test_the_manager_is_named_and_a_leadless_staffer_gets_null(self):
        body = self.me(self.scout)
        self.assertEqual(body["manager"], {"id": self.lead.pk, "full_name": self.lead.full_name, "role": "operations"})
        self.assertIsNone(self.me(self.lead)["manager"])

    def test_a_scout_gets_the_top_two_areas_and_the_business_count(self):
        asafo, bantama, adum = (Zone.objects.get_or_create(name=n)[0] for n in ("Asafo", "Bantama", "Adum"))
        for n, zone in enumerate([asafo, asafo, bantama, bantama, bantama, adum], start=1):
            self.business(n, zone)
        self.business(7, adum, kyc="rejected")  # rejected businesses count for nothing
        self.business(8, None)
        body = self.me(self.scout)
        self.assertEqual(body["areas"], ["Bantama", "Asafo"])
        self.assertEqual(body["portfolio_count"], 7)

    def test_a_scout_with_no_businesses_has_no_areas(self):
        body = self.me(self.scout)
        self.assertEqual((body["areas"], body["portfolio_count"]), ([], 0))

    def test_other_roles_do_not_get_scout_fields(self):
        body = self.me(self.lead)
        self.assertNotIn("areas", body)
        self.assertNotIn("portfolio_count", body)
