from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from core.models import SiteSettings

URL = "/api/core/site-settings/pickup-address/"


class PickupAddressTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = make_staff("super_admin", "sa@example.com")
        self.ops = make_staff("operations", "ops@example.com")

    def as_staff(self, staff, sudo=True):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def test_pickup_address_is_blank_until_a_super_admin_sets_it(self):
        self.assertEqual(self.client.get("/api/core/site-settings/").json()["pickup_office_address"], "")
        self.assertEqual(SiteSettings.load().pickup_office_address, "")

    def test_only_a_super_admin_sets_the_pickup_address(self):
        self.as_staff(self.ops)
        self.assertEqual(self.client.patch(URL, {"pickup_office_address": "Adum"}, format="json").status_code, 403)
        general = self.client.patch("/api/core/site-settings/", {"pickup_office_address": "Adum"}, format="json")
        self.assertEqual(general.status_code, 200, general.content)
        self.assertEqual(SiteSettings.load().pickup_office_address, "")
        self.client.credentials()
        self.assertIn(self.client.patch(URL, {"pickup_office_address": "Adum"}, format="json").status_code, (401, 403))

    def test_setting_the_address_needs_the_password_and_is_recorded(self):
        self.as_staff(self.super_admin, sudo=False)
        refused = self.client.patch(URL, {"pickup_office_address": "Adum, Kumasi"}, format="json")
        self.assertEqual((refused.status_code, refused.json()["code"]), (403, "sudo_required"))
        self.assertEqual(SiteSettings.load().pickup_office_address, "")
        self.as_staff(self.super_admin)
        done = self.client.patch(URL, {"pickup_office_address": "  Adum, Kumasi  "}, format="json")
        self.assertEqual((done.status_code, done.json()), (200, {"pickup_office_address": "Adum, Kumasi"}))
        self.assertEqual(self.client.get("/api/core/site-settings/").json()["pickup_office_address"], "Adum, Kumasi")
        event = ActivityEvent.objects.get(verb="site_settings.updated")
        self.assertEqual(event.after, {"pickup_office_address": "Adum, Kumasi"})
        history = self.client.get("/api/core/site-settings/history/").json()
        self.assertEqual(history[0]["changes"], [
            {"field": "pickup_office_address", "label": "Pickup office address", "before": "", "after": "Adum, Kumasi"}])

    def test_a_non_object_body_is_a_400_not_a_500(self):
        self.as_staff(self.super_admin)
        for body in ([], ["x"], "text", 5):
            response = self.client.patch(URL, body, format="json")
            self.assertEqual(response.status_code, 400, body)

    def test_a_blank_address_clears_it_and_301_characters_are_refused(self):
        self.as_staff(self.super_admin)
        self.client.patch(URL, {"pickup_office_address": "Adum"}, format="json")
        too_long = self.client.patch(URL, {"pickup_office_address": "x" * 301}, format="json")
        self.assertEqual(too_long.status_code, 400)
        self.assertIn("pickup_office_address", too_long.json())
        self.assertEqual(SiteSettings.load().pickup_office_address, "Adum")
        self.assertEqual(self.client.patch(URL, {"pickup_office_address": "x" * 300}, format="json").status_code, 200)
        cleared = self.client.patch(URL, {"pickup_office_address": "   "}, format="json")
        self.assertEqual((cleared.status_code, cleared.json()), (200, {"pickup_office_address": ""}))
        self.assertEqual(SiteSettings.load().pickup_office_address, "")
