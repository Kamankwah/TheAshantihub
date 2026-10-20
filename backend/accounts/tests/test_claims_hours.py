import json

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts import claims
from accounts.models import BusinessHours, BusinessOwner
from accounts.testing import make_staff, session_of, staff_token
from accounts.tests.test_hours_api import client_for, make_owner
from accounts.tests.test_owner_claim import PASSWORD, scout_owner
from portfolio.tests.test_registration import REGISTER_URL, WEEK, RegistrationBase


class ScoutRegistrationHoursTests(RegistrationBase):
    def test_scout_claim_without_hours_is_400_hours_required(self):
        self.as_(self.scout)
        data = self.form()
        del data["hours"]
        response = self.client.post(REGISTER_URL, data, format="multipart")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "hours_required")
        self.assertFalse(BusinessOwner.objects.filter(login_phone="+233241234567").exists())

    def test_invalid_hours_is_400_and_writes_nothing(self):
        bad = [dict(day) for day in WEEK]
        bad[0].update(opens="18:00", closes="08:00")
        response = self.register(hours=json.dumps(bad))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "hours_invalid")
        self.assertFalse(BusinessOwner.objects.filter(login_phone="+233241234567").exists())
        for junk in ("not json", json.dumps(WEEK[:3])):
            self.assertEqual(self.register(hours=junk).status_code, 400)

    def test_scout_claim_with_hours_creates_businesshours(self):
        response = self.register()
        self.assertEqual(response.status_code, 201, response.content)
        rows = BusinessHours.objects.filter(business_owner_id=response.json()["id"]).order_by("weekday")
        self.assertEqual(rows.count(), 7)
        self.assertTrue(rows[6].closed)
        self.assertEqual(rows[0].opens.strftime("%H:%M"), "08:00")


class HourlessOwnersTests(TestCase):
    def setUp(self):
        cache.clear()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)

    def test_existing_hourless_live_business_is_not_blocked_from_dashboard(self):
        owner = make_owner(phone="+233201110077", business_name="Old shop")
        owner.kyc_status = BusinessOwner.VERIFIED
        owner.save(update_fields=["kyc_status"])
        client = client_for(owner)
        self.assertEqual(client.get("/api/accounts/business/hours/").json(), {"days": [], "has_hours": False})
        self.assertEqual(client.get("/api/accounts/business-owners/me/profile/").status_code, 200)

    def test_hourless_scout_business_cannot_be_claimed_until_hours_are_added(self):
        owner = scout_owner(self.scout)
        BusinessHours.objects.filter(business_owner=owner).delete()
        token = staff_token(self.scout)
        raw, _ = claims.start_handover(owner, self.scout, session_of(token))
        phone = APIClient()
        phone.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        body = {"token": raw, "password": PASSWORD, "password_confirm": PASSWORD, "accept_terms": True}
        response = phone.post("/api/accounts/business-owners/claim/", body, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "hours_required")
        self.assertEqual(response.json()["detail"], claims.HOURS_REQUIRED)
        self.assertIn("account manager", claims.HOURS_REQUIRED)
        owner.refresh_from_db()
        self.assertIsNone(owner.claimed_at)
