from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from core.models import SiteSettings

URL = "/api/core/site-settings/"


class SiteSettingsAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _staff(self, role_name, suffix):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person",
            email=f"{role_name}-{suffix}@example.com",
            password_hash="x",
            role=Role.objects.get(name=role_name),
        )
        return issue_token(staff, "staff")

    # --- GET (public) ---

    def test_get_is_public_and_unauthenticated(self):
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200)

    def test_get_returns_expected_fields(self):
        SiteSettings.objects.create(
            contact_email="hello@theashantihub.com",
            contact_phone="+233 20 000 0000",
            contact_address="Kumasi, Ghana",
            facebook_url="https://facebook.com/theashantihub",
            instagram_url="https://instagram.com/theashantihub",
            linkedin_url="https://linkedin.com/company/theashantihub",
            twitter_url="https://twitter.com/theashantihub",
            warranty_returns_policy="Returns accepted within 7 days.",
            service_dispute_policy="Contact support to raise a dispute.",
        )
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "contact_email": "hello@theashantihub.com",
                "contact_phone": "+233 20 000 0000",
                "contact_address": "Kumasi, Ghana",
                "facebook_url": "https://facebook.com/theashantihub",
                "instagram_url": "https://instagram.com/theashantihub",
                "linkedin_url": "https://linkedin.com/company/theashantihub",
                "twitter_url": "https://twitter.com/theashantihub",
                "warranty_returns_policy": "Returns accepted within 7 days.",
                "service_dispute_policy": "Contact support to raise a dispute.",
            },
        )

    def test_get_self_heals_when_no_row_exists(self):
        # The 0002 data migration seeds one row up front; delete it to
        # simulate the "row doesn't exist yet" case this test targets.
        SiteSettings.objects.all().delete()
        self.assertEqual(SiteSettings.objects.count(), 0)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["contact_email"], "")
        self.assertEqual(SiteSettings.objects.count(), 1)

    # --- PATCH (staff-only, site_settings.manage) ---

    def test_patch_unauthenticated_is_401(self):
        response = self.client.patch(URL, {"contact_email": "x@example.com"}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_patch_staff_without_permission_is_403(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('support', 1)}")
        response = self.client.patch(URL, {"contact_email": "x@example.com"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_patch_admin_succeeds(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 1)}")
        response = self.client.patch(URL, {"contact_email": "new@example.com"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(SiteSettings.load().contact_email, "new@example.com")

    def test_patch_super_admin_succeeds(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('super_admin', 1)}")
        response = self.client.patch(URL, {"contact_phone": "+233 55 123 4567"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(SiteSettings.load().contact_phone, "+233 55 123 4567")

    def test_patch_is_partial_update_only_touches_given_fields(self):
        SiteSettings.objects.create(
            contact_email="hello@theashantihub.com",
            contact_phone="+233 20 000 0000",
            facebook_url="https://facebook.com/theashantihub",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 2)}")
        response = self.client.patch(URL, {"contact_phone": "+233 24 999 9999"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

        settings = SiteSettings.load()
        self.assertEqual(settings.contact_phone, "+233 24 999 9999")
        self.assertEqual(settings.contact_email, "hello@theashantihub.com")
        self.assertEqual(settings.facebook_url, "https://facebook.com/theashantihub")

    def test_patch_creates_row_if_missing(self):
        # The 0002 data migration seeds one row up front; delete it to
        # simulate the "row doesn't exist yet" case this test targets.
        SiteSettings.objects.all().delete()
        self.assertEqual(SiteSettings.objects.count(), 0)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 3)}")
        response = self.client.patch(URL, {"contact_email": "fresh@example.com"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(SiteSettings.objects.count(), 1)
        self.assertEqual(SiteSettings.load().contact_email, "fresh@example.com")
