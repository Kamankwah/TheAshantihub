from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from approvals import services as approvals
from approvals.models import ApprovalRequest
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
        self.assertEqual(ApprovalRequest.objects.count(), 0)

    def test_malformed_bodies_are_400_never_500(self):
        self.as_staff(self.accountant)
        big = 10**12 + 1
        for bands in ([1], ["x"], [None], "abc", {"a": 1}, 5, True,
                      [{"lower": 0, "upper": None, "percent_bp": None, "flat": big}],
                      [{"lower": 0, "upper": big, "percent_bp": 1, "flat": None}, {"lower": big + 1, "upper": None, "percent_bp": 1, "flat": None}]):
            response = self.client.post("/api/ledger/fees/", {"category": "product", "bands": bands}, format="json")
            self.assertEqual(response.status_code, 400, (bands, response.content))
        for category in (["product"], {}, 5):
            response = self.client.post("/api/ledger/fees/", {"category": category, "bands": TIERS}, format="json")
            self.assertEqual(response.status_code, 400, category)
        bad_date = "2026-13-45T10:00:00"
        self.assertEqual(self.client.post("/api/ledger/fees/", {"category": "product", "bands": TIERS, "effective_from": bad_date}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/ledger/settings/", {"key": "fee_cap_pesewas", "value": 5, "effective_from": bad_date}, format="json").status_code, 400)
        for key in (["holdback"], {}):
            self.assertEqual(self.client.post("/api/ledger/settings/", {"key": key, "value": 1}, format="json").status_code, 400)
        self.assertEqual(ApprovalRequest.objects.count(), 0)

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


class SparseLadderTests(GovernanceBase):
    """A ladder that leaves out its null keys must not lock fee governance for the category."""

    ONE = [{"lower": 0, "percent_bp": 150}]
    TWO = [{"lower": 0, "upper": 99999, "percent_bp": 150}, {"lower": 100000, "flat": 2500}]
    FULL = {"lower", "upper", "percent_bp", "flat"}

    def propose(self, bands, category="service"):
        self.as_staff(self.accountant)
        response = self.client.post("/api/ledger/fees/", {"category": category, "bands": bands}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["approval_id"]

    def test_a_sparse_ladder_is_stored_with_all_four_keys(self):
        for bands in (self.ONE, self.TWO):
            approval = ApprovalRequest.objects.get(pk=self.propose(bands, "event" if bands is self.ONE else "service"))
            for band in approval.payload["bands"]:
                self.assertEqual(set(band), self.FULL)

    def test_its_approval_can_be_viewed_and_approved(self):
        approval_id = self.propose(self.TWO)
        self.as_staff(self.boss)
        self.assertEqual(self.client.get(f"/api/approvals/{approval_id}/").status_code, 200)
        approvals.approve(approval_id, self.boss)
        bands = list(fees.rule_set_in_force("service").bands.all())
        self.assertEqual(fees.band_fee(bands, 1000), 15)
        self.assertEqual(fees.band_fee(bands, 100000), 2500)
        self.assertIsNone(bands[1].upper_pesewas)

    def test_a_single_open_ended_sparse_band_is_approved(self):
        approvals.approve(self.propose(self.ONE), self.boss)
        self.assertEqual(fees.band_fee(list(fees.rule_set_in_force("service").bands.all()), 1000), 15)

    def test_it_can_be_rejected_and_cancelled_then_reproposed(self):
        first = self.propose(self.ONE)
        approvals.reject(first, self.boss, "Not now")
        second = self.propose(self.TWO)
        self.assertEqual(self.client.get(f"/api/approvals/{second}/").status_code, 200)
        approvals.cancel(second, self.accountant)
        self.assertEqual(ApprovalRequest.objects.get(pk=second).status, ApprovalRequest.CANCELLED)
        self.propose(self.ONE)

    def test_a_sparse_payload_that_bypassed_the_view_does_not_raise(self):
        from ledger import approval_kinds
        request = ApprovalRequest(payload={"category": "service", "bands": self.TWO}, before={"bands": self.ONE})
        diff = approval_kinds.fee_diff(request)
        self.assertIn("and above", diff[0]["after"])
        self.assertIn("1.5%", diff[0]["before"])
        approval = approvals.submit(
            self.accountant, approval_kinds.FEE_RULES_KEY, title="x", payload={"category": "product", "bands": self.TWO},
            target_type="ledger.feeruleset", target_id="product", target_label="Products",
        )
        approvals.approve(approval.pk, self.boss)
        applied = fees.rule_set_in_force("product")
        self.assertEqual(applied.created_by_id, self.boss.pk)
        self.assertEqual(applied.bands.count(), 2)

    def test_approve_itself_refuses_a_bad_payload(self):
        from ledger import approval_kinds
        approval = approvals.submit(
            self.accountant, approval_kinds.FEE_RULES_KEY, title="x",
            payload={"category": "product", "bands": [{"lower": 5, "upper": None, "percent_bp": 100, "flat": None}]},
            target_type="ledger.feeruleset", target_id="product", target_label="Products",
        )
        seeded = fees.rule_set_in_force("product").pk
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(approval.pk, self.boss)
        self.assertEqual(fees.rule_set_in_force("product").pk, seeded)
        self.assertEqual(ApprovalRequest.objects.get(pk=approval.pk).status, ApprovalRequest.PENDING)


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
