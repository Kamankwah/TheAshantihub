from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from approvals import services as approvals
from ledger import fees, settings_store
from ledger.models import FeeRuleSet, MoneySetting

TIERS = [
    {"lower": 0, "upper": 99999, "percent_bp": 150, "flat": None},
    {"lower": 100000, "upper": None, "percent_bp": None, "flat": 2500},
]


class GovernanceBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.support = make_staff("support", "esi@example.com")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")


class FeeRulesTests(GovernanceBase):
    def test_accounting_proposes_and_nothing_changes_until_a_super_admin_approves(self):
        self.as_staff(self.accountant)
        before = FeeRuleSet.objects.count()
        response = self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(FeeRuleSet.objects.count(), before)
        approvals.approve(response.json()["approval_id"], self.boss)
        applied = fees.rule_set_in_force("service")
        self.assertEqual(applied.created_by_id, self.boss.pk)
        self.assertEqual(fees.band_fee(list(applied.bands.all()), 1000), 15)       # 1.5% of GHS 10.00
        self.assertEqual(fees.band_fee(list(applied.bands.all()), 100000), 2500)

    def test_a_super_admin_proposal_applies_at_once(self):
        self.as_staff(self.boss, sudo=True)
        response = self.client.post("/api/ledger/fees/", {"category": "event", "bands": TIERS}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(fees.band_fee(list(fees.rule_set_in_force("event").bands.all()), 1000), 15)

    def test_a_malformed_ladder_is_refused_and_nothing_is_queued(self):
        self.as_staff(self.accountant)
        bad = [{"lower": 5, "upper": None, "percent_bp": 100, "flat": None}]
        response = self.client.post("/api/ledger/fees/", {"category": "product", "bands": bad}, format="json")
        self.assertEqual(response.status_code, 400, response.content)

    def test_an_unknown_category_is_refused(self):
        self.as_staff(self.accountant)
        response = self.client.post("/api/ledger/fees/", {"category": "gold", "bands": TIERS}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_an_effective_time_in_the_past_never_backdates(self):
        self.as_staff(self.boss, sudo=True)
        yesterday = (timezone.now() - timedelta(days=1)).isoformat()
        self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS, "effective_from": yesterday}, format="json")
        applied = fees.rule_set_in_force("service")
        self.assertGreaterEqual(applied.effective_from, timezone.now() - timedelta(minutes=1))

    def test_only_fees_permission_holders_can_read_or_propose(self):
        self.as_staff(self.support)
        self.assertEqual(self.client.get("/api/ledger/fees/").status_code, 403)
        self.assertEqual(self.client.post("/api/ledger/fees/", {"category": "product", "bands": TIERS}, format="json").status_code, 403)

    def test_get_lists_the_rules_in_force_and_what_is_pending(self):
        self.as_staff(self.accountant)
        self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json")
        body = self.client.get("/api/ledger/fees/").json()
        self.assertEqual({row["category"] for row in body["current"]}, {"product", "service", "event"})
        self.assertEqual(len(body["pending"]), 1)
        self.assertEqual(body["pending"][0]["category"], "service")

    def test_a_second_pending_proposal_for_the_same_category_is_a_conflict(self):
        self.as_staff(self.accountant)
        self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json")
        again = self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json")
        self.assertEqual(again.status_code, 409)


class SettingsTests(GovernanceBase):
    def test_accounting_proposes_a_cap_and_a_super_admin_approves(self):
        self.as_staff(self.accountant)
        response = self.client.post("/api/ledger/settings/", {"key": "fee_cap_pesewas", "value": 5000000}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(settings_store.current("fee_cap_pesewas"))
        approvals.approve(response.json()["approval_id"], self.boss)
        self.assertEqual(settings_store.current("fee_cap_pesewas"), 5000000)

    def test_a_blank_cap_removes_the_cap(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=100, effective_from=timezone.now() - timedelta(days=1))
        self.as_staff(self.boss, sudo=True)
        self.client.post("/api/ledger/settings/", {"key": "fee_cap_pesewas", "value": None}, format="json")
        self.assertIsNone(settings_store.current("fee_cap_pesewas"))

    def test_an_out_of_range_or_unknown_setting_is_refused(self):
        self.as_staff(self.accountant)
        self.assertEqual(self.client.post("/api/ledger/settings/", {"key": "pickup_window_hours", "value": 9999}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/ledger/settings/", {"key": "nope", "value": 1}, format="json").status_code, 400)

    def test_get_shows_each_setting_with_its_value_in_force(self):
        self.as_staff(self.accountant)
        body = self.client.get("/api/ledger/settings/").json()
        keys = {row["key"]: row["value"] for row in body["settings"]}
        self.assertEqual(keys["pickup_window_hours"], 24)
        self.assertEqual(keys["verification_overdue_hours"], 72)
        self.assertIn("fee_cap_pesewas", keys)
        self.assertIsNone(keys["fee_cap_pesewas"])
