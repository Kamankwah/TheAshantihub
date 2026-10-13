from dataclasses import replace

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from approvals import registry, services
from approvals.tests.kinds import RENAME_STAFF

# No pool permission, so the request goes straight to a Super Admin.
TO_SUPER_ADMIN = replace(RENAME_STAFF, key="test.to_super_admin", pool_permission="")
from fraud.models import FraudFlag
from fraud.services import raise_flag

URL = "/api/operations/superadmin-overview/"


class SuperAdminOverviewTests(TestCase):
    def setUp(self):
        cache.clear()
        registry.register(TO_SUPER_ADMIN)
        self.addCleanup(registry.unregister, TO_SUPER_ADMIN.key)
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")
        self.accountant = make_staff("accountant", "kwabena@example.com")

    def get(self, who):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who)}")
        return self.client.get(URL)

    def test_only_a_super_admin_reads_it(self):
        self.assertEqual(self.get(self.lead).status_code, 403)
        self.assertEqual(self.get(self.boss).status_code, 200)

    def test_decisions_waiting_and_staff_online_are_real_counts(self):
        services.submit(self.accountant, TO_SUPER_ADMIN.key, target=self.esi, title="Rename Esi", payload={"full_name": "Esi N"})
        data = self.get(self.boss).json()
        self.assertEqual(data["kpis"]["decisions"]["waiting"], 1)
        self.assertEqual(data["waiting"][0]["title"], "Rename Esi")
        self.assertIsNone(data["waiting"][0]["amount"])
        # Only the boss holds a live session (the token above); nobody else is online.
        self.assertEqual(data["kpis"]["staff_online"]["online"], 1)
        teams = {t["role"]: t for t in data["teams"]}
        self.assertEqual(teams["operations"]["online"], 0)
        self.assertEqual(teams["operations"]["staff"], 1)
        self.assertIn("1 request(s) waiting on someone", teams["accountant"]["work"])
        self.assertEqual(teams["operations"]["step_in"], "step-in-operations")

    def test_fraud_open_counts_open_flags(self):
        self.assertEqual(self.get(self.boss).json()["kpis"]["fraud_open"], 0)
        raise_flag(FraudFlag.OUTSIDE_RADIUS, title="Outside", staff_subject=self.scout)
        self.assertEqual(self.get(self.boss).json()["kpis"]["fraud_open"], 1)

    def test_platform_strip_is_honest_about_what_is_not_connected(self):
        status = {c["key"]: c for c in self.get(self.boss).json()["platform"]}
        self.assertEqual(status["database"]["state"], "ok")
        self.assertEqual(status["sms"]["state"], "not_connected")
        self.assertEqual(status["payments"]["state"], "simulated")
        self.assertEqual(status["audit"]["state"], "not_tracked")
        self.assertNotIn("service time limits", " ".join(c["name"].lower() for c in status.values()))
