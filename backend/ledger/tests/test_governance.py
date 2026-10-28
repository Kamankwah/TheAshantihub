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

    def test_get_flags_defaults_and_lists_a_scheduled_change(self):
        now = timezone.now()
        MoneySetting.objects.create(key="pickup_window_hours", value=36, effective_from=now - timedelta(hours=1))
        MoneySetting.objects.create(key="pickup_window_hours", value=12, effective_from=now + timedelta(days=2))
        self.as_staff(self.accountant)
        rows = {row["key"]: row for row in self.client.get("/api/ledger/settings/").json()["settings"]}
        self.assertFalse(rows["pickup_window_hours"]["is_default"])
        self.assertEqual(rows["pickup_window_hours"]["value"], 36)
        self.assertEqual([s["value"] for s in rows["pickup_window_hours"]["scheduled"]], [12])
        self.assertTrue(rows["verification_overdue_hours"]["is_default"])
        self.assertEqual(rows["verification_overdue_hours"]["scheduled"], [])


class RiderSettingGovernanceTests(GovernanceBase):
    def test_rider_setting_consequence_text(self):
        from types import SimpleNamespace

        from ledger import approval_kinds

        said = approval_kinds.setting_consequences(SimpleNamespace(payload={"key": "rider_withdrawals_per_day"}))
        self.assertEqual(said, ["Applies to riders' withdrawals asked for after it starts. Withdrawals already made today still count."])
        self.assertEqual(approval_kinds.RIDER_SETTING_KEYS, ("rider_withdrawals_per_day",))
        self.assertEqual(
            approval_kinds.setting_consequences(SimpleNamespace(payload={"key": "rider_commission_bp"})),
            ["Applies only to orders paid after it starts."],
        )

    def test_rider_setting_needs_super_admin_and_sudo(self):
        self.as_staff(self.accountant)
        queued = self.client.post("/api/ledger/settings/", {"key": "rider_withdrawals_per_day", "value": 5}, format="json")
        self.assertEqual(queued.status_code, 201, queued.content)
        self.assertEqual(settings_store.current("rider_withdrawals_per_day"), 3)                 # waits for a Super Admin
        approval_id = queued.json()["approval_id"]
        self.as_staff(self.accountant, sudo=True)
        self.assertEqual(self.client.post(f"/api/approvals/{approval_id}/approve/", {}, format="json").status_code, 403)  # not theirs to decide
        self.as_staff(self.boss)                                                                  # a Super Admin without sudo
        refused = self.client.post(f"/api/approvals/{approval_id}/approve/", {}, format="json")
        self.assertEqual((refused.status_code, refused.json().get("code")), (403, "sudo_required"))
        self.assertEqual(settings_store.current("rider_withdrawals_per_day"), 3)
        self.as_staff(self.boss, sudo=True)
        done = self.client.post(f"/api/approvals/{approval_id}/approve/", {}, format="json")
        self.assertEqual(done.status_code, 200, done.content)
        self.assertEqual(settings_store.current("rider_withdrawals_per_day"), 5)


class RedeliveryFeeGovernanceTests(GovernanceBase):
    """Director ruling 1 (2026-10-20): the re-delivery fee (`redelivery_fee_pesewas`, default GH₵ 15.00, 0 to GH₵ 200.00)
    is changed by Operations as well as the Super Admin. Operations proposes it (permission redelivery_fee.manage) and any
    other holder (Operations or a Super Admin) decides, never the maker; a Super Admin's own change applies at once.
    Every step is in the activity log like the other governed settings. Operations touches no other money setting."""

    KEY = "redelivery_fee_pesewas"

    def setUp(self):
        super().setUp()
        self.ops = make_staff("operations", "ops1@example.com")
        self.ops2 = make_staff("operations", "ops2@example.com")

    def propose(self, staff, value=2000, key=None):
        self.as_staff(staff)
        return self.client.post("/api/ledger/settings/", {"key": key or self.KEY, "value": value}, format="json")

    def test_permission_is_seeded_to_operations_and_super_admin(self):
        from accounts.models import Role

        holders = sorted(Role.objects.filter(permissions__codename="redelivery_fee.manage").values_list("name", flat=True))
        self.assertEqual(holders, ["operations", "super_admin"])

    def test_operations_proposes_and_another_operations_lead_approves(self):
        from activity.models import ActivityEvent

        response = self.propose(self.ops)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(settings_store.current(self.KEY), 1500)                       # nothing changes until decided
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual((approval.kind, approval.pool_permission, approval.status), ("ledger.redelivery_fee", "redelivery_fee.manage", "pending"))
        with self.assertRaises(approvals.MakerCannotDecide):
            approvals.approve(approval.pk, self.ops)
        approvals.approve(approval.pk, self.ops2)
        self.assertEqual(settings_store.current(self.KEY), 2000)
        row = MoneySetting.objects.get(key=self.KEY)
        self.assertEqual((row.created_by, row.approval_id), (self.ops2, approval.pk))
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.requested", actor_id=self.ops.pk).exists())
        applied = ActivityEvent.objects.get(verb="ledger.setting_applied")
        self.assertEqual((applied.actor_id, applied.after), (self.ops2.pk, {"key": self.KEY, "value": 2000}))

    def test_a_super_admin_can_decide_an_operations_change(self):
        response = self.propose(self.ops, 1000)
        approvals.approve(response.json()["approval_id"], self.boss)
        self.assertEqual(settings_store.current(self.KEY), 1000)

    def test_operations_decides_a_change_accounting_proposed(self):
        response = self.propose(self.accountant, 1800)
        self.assertEqual(response.status_code, 201, response.content)
        approvals.approve(response.json()["approval_id"], self.ops)
        self.assertEqual(settings_store.current(self.KEY), 1800)

    def test_a_super_admin_own_change_applies_at_once(self):
        self.as_staff(self.boss, sudo=True)
        response = self.client.post("/api/ledger/settings/", {"key": self.KEY, "value": 2500}, format="json")
        self.assertEqual((response.status_code, response.json()["status"]), (201, "approved"))
        self.assertEqual(settings_store.current(self.KEY), 2500)

    def test_deciding_needs_the_password_again(self):
        approval_id = self.propose(self.ops).json()["approval_id"]
        self.as_staff(self.ops2)
        refused = self.client.post(f"/api/approvals/{approval_id}/approve/", {}, format="json")
        self.assertEqual((refused.status_code, refused.json().get("code")), (403, "sudo_required"))
        self.as_staff(self.ops2, sudo=True)
        self.assertEqual(self.client.post(f"/api/approvals/{approval_id}/approve/", {}, format="json").status_code, 200)
        self.assertEqual(settings_store.current(self.KEY), 2000)

    def test_bounds_are_zero_to_two_hundred_cedis(self):
        self.assertEqual(self.propose(self.ops, 20001).status_code, 400)
        self.assertEqual(self.propose(self.ops, -1).status_code, 400)
        self.assertEqual(self.propose(self.ops, 0).status_code, 201)

    def test_operations_cannot_change_any_other_money_setting(self):
        self.assertEqual(self.propose(self.ops, 5, key="fee_cap_pesewas").status_code, 403)
        self.assertEqual(self.propose(self.ops, 5, key="pickup_window_hours").status_code, 403)
        self.assertEqual(self.client.post("/api/ledger/fees/", {"category": "service", "bands": TIERS}, format="json").status_code, 403)
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_operations_reads_only_the_redelivery_fee(self):
        self.propose(self.ops)
        self.as_staff(self.ops2)
        body = self.client.get("/api/ledger/settings/").json()
        self.assertEqual([row["key"] for row in body["settings"]], [self.KEY])
        self.assertEqual([(p["key"], p["value"]) for p in body["pending"]], [(self.KEY, 2000)])
        self.as_staff(self.accountant)                                                   # Accounting still sees everything
        body = self.client.get("/api/ledger/settings/").json()
        self.assertGreater(len(body["settings"]), 1)
        self.assertEqual([p["key"] for p in body["pending"]], [self.KEY])

    def test_one_pending_change_at_a_time_whoever_proposed_it(self):
        self.assertEqual(self.propose(self.ops).status_code, 201)
        self.assertEqual(self.propose(self.accountant, 1700).status_code, 409)
        self.assertEqual(self.propose(self.ops2, 1700).status_code, 409)

    def test_support_cannot_read_or_change_it(self):
        self.as_staff(self.support)
        self.assertEqual(self.client.get("/api/ledger/settings/").status_code, 403)
        self.assertEqual(self.propose(self.support).status_code, 403)

    def test_the_kind_is_operations_or_super_admin_with_sudo(self):
        from approvals.registry import get_kind

        kind = get_kind("ledger.redelivery_fee")
        self.assertEqual((kind.pool_permission, kind.chain_note, kind.requires_sudo), ("redelivery_fee.manage", "Operations or Super Admin", True))
        self.assertEqual(get_kind("ledger.setting").chain_note, "Super Admin only")      # every other money setting is unchanged
