"""A third-party rider cannot leave the Dispatch role or be deactivated while still third-party (Plan 5 Task 6 ruling): their
wallet opens only through the Dispatch role, so they are switched back to AshantiHub's own first (which checks their money).
An AshantiHub-own rider is unaffected."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from ledger.tests import rider_helpers


class LeavingAThirdPartyRiderTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        self.swift = rider_helpers.rider()
        self.own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")

    def role(self, rider, role="operations"):
        return self.client.post(f"/api/people/staff/{rider.staff.pk}/role/", {"role": role, "reason": "Moving"}, format="json")

    def deactivate(self, rider):
        return self.client.post(f"/api/accounts/staff/{rider.staff.pk}/deactivate/")

    def test_a_third_party_rider_keeps_the_dispatch_role(self):
        response = self.role(self.swift)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "third_party_rider"))
        self.assertIn("AshantiHub's own first", response.json()["detail"])
        self.swift.staff.refresh_from_db()
        self.assertEqual(self.swift.staff.role.name, "dispatch")

    def test_a_third_party_rider_cannot_be_deactivated(self):
        response = self.deactivate(self.swift)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "third_party_rider"))
        self.swift.staff.refresh_from_db()
        self.assertTrue(self.swift.staff.is_active)

    def test_an_ashantihub_own_rider_is_unaffected(self):
        self.assertEqual(self.role(self.own).status_code, 200)
        other = rider_helpers.rider("own2@example.com", third_party=False, phone="+233244000008")
        self.assertEqual(self.deactivate(other).status_code, 200)
