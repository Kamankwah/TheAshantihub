"""The General Manager approves listings and other non-money items, and never a money kind
(owner ruling 2026-10-19). The exclusion lives in the engine, keyed on ApprovalKind.money."""
from dataclasses import replace

from django.test import TestCase
from django.utils import timezone

from accounts.testing import make_staff
from approvals import registry, services
from approvals.models import ApprovalRequest
from approvals.tests.kinds import RENAME_STAFF

# Every kind that governs or moves money, or controls who can reach money. A new kind is a conscious decision:
# add it here when it is money, or leave it out on purpose.
MONEY_KINDS = {
    "business.detail_change", "commission.policy", "delivery.auto_assign", "delivery.rate_card",
    "delivery.refund_request", "delivery.rider_employment", "delivery.time_limits", "ledger.fee_rules",
    "ledger.setting", "marketing.coupon", "marketing.delivery_promo_funding", "otp.recovery",
    "wallets.holder_details_edit", "wallets.withdrawal_resolution",
}
NOT_MONEY_KINDS = {
    "business.kyc", "business.update", "listing.create", "listing.photos", "marketing.banner",
    "marketing.campaign", "marketing.send_policy", "targets.cut",
}
MONEY_RENAME = replace(RENAME_STAFF, key="test.money_rename", money=True)


class MoneyKindSetTests(TestCase):
    def test_the_money_kinds_are_exactly_these(self):
        registered = registry.all_kinds()
        self.assertEqual({k for k, v in registered.items() if v.money}, MONEY_KINDS)
        self.assertEqual({k for k, v in registered.items() if not v.money} - {"test.rename_staff"}, NOT_MONEY_KINDS)

    def test_every_sudo_kind_is_money(self):
        self.assertEqual({k for k, v in registry.all_kinds().items() if v.requires_sudo} - MONEY_KINDS, set())


class Base(TestCase):
    def setUp(self):
        for kind in (RENAME_STAFF, MONEY_RENAME):
            registry.register(kind)
            self.addCleanup(registry.unregister, kind.key)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.gm = make_staff("general_manager", "gm@example.com", manager=self.boss)
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")

    def submit(self, kind, maker=None):
        return services.submit(maker or self.scout, kind.key, target=self.esi, title="Rename Esi", payload={"full_name": "Esi N"})


class ListingKindsTests(Base):
    def test_gm_can_approve_listing_kinds(self):
        # a non-money kind: the GM decides at the manager stage, the pool stage and the Super Admin stage (approvals.view_all)
        for stage in (ApprovalRequest.MANAGER, ApprovalRequest.POOL, ApprovalRequest.SUPER_ADMIN):
            approval = self.submit(RENAME_STAFF)
            ApprovalRequest.objects.filter(pk=approval.pk).update(stage=stage)
            approval.refresh_from_db()
            self.assertTrue(services.can_decide(approval, self.gm), stage)
            if stage == ApprovalRequest.POOL:  # the GM holds kyc.approve; at the manager stage another person is named
                self.assertIn(self.gm, services.approvers_for(approval))
                self.assertIn(approval.pk, services.waiting_for(self.gm).values_list("pk", flat=True))
            services.approve(approval.pk, self.gm)
            approval.refresh_from_db()
            self.assertEqual((approval.status, approval.decided_by), ("approved", self.gm))

    def test_real_listing_kinds_are_not_money(self):
        for key in ("listing.create", "listing.photos", "business.kyc"):
            self.assertFalse(registry.get_kind(key).money, key)

    def test_gm_cannot_approve_own_listing_request(self):
        approval = self.submit(RENAME_STAFF, maker=self.gm)
        self.assertEqual((approval.stage, approval.assigned_to), (ApprovalRequest.MANAGER, self.boss))
        self.assertFalse(services.can_decide(approval, self.gm))
        with self.assertRaises(services.MakerCannotDecide):
            services.approve(approval.pk, self.gm)
        self.assertEqual(ApprovalRequest.objects.get(pk=approval.pk).status, ApprovalRequest.PENDING)


class MoneyKindsTests(Base):
    def test_gm_never_in_chain_for_money_kinds(self):
        approval = self.submit(MONEY_RENAME)
        for stage in (ApprovalRequest.MANAGER, ApprovalRequest.POOL, ApprovalRequest.SUPER_ADMIN):
            ApprovalRequest.objects.filter(pk=approval.pk).update(stage=stage)
            approval.refresh_from_db()
            self.assertFalse(services.can_decide(approval, self.gm), stage)
            self.assertNotIn(self.gm, services.approvers_for(approval))
            self.assertFalse(services.was_eligible(approval, self.gm))
            self.assertNotIn(approval.pk, services.waiting_for(self.gm).values_list("pk", flat=True))
            with self.assertRaises(services.NotYourDecision):
                services.approve(approval.pk, self.gm)
            with self.assertRaises(services.NotYourDecision):
                services.reject(approval.pk, self.gm, "no")
        # a Super Admin still decides it, so the exclusion is the GM's alone
        self.assertTrue(services.can_decide(approval, self.boss))

    def test_gm_who_is_the_makers_manager_is_not_the_approver_of_a_money_kind(self):
        scout = make_staff("scout", "yaw@example.com", manager=self.gm)
        approval = self.submit(MONEY_RENAME, maker=scout)
        self.assertNotEqual(approval.assigned_to, self.gm)
        self.assertNotEqual(approval.stage, ApprovalRequest.MANAGER)
        self.assertFalse(services.can_decide(approval, self.gm))
        listing = self.submit(RENAME_STAFF, maker=scout)
        self.assertEqual((listing.stage, listing.assigned_to), (ApprovalRequest.MANAGER, self.gm))
        self.assertTrue(services.can_decide(listing, self.gm))

    def test_money_kinds_the_gm_could_otherwise_see_in_the_pool_stay_out_of_its_inbox(self):
        # delivery_promo.approve is an Operations permission the GM inherits; the money flag still wins
        kind = registry.get_kind("marketing.delivery_promo_funding")
        self.assertTrue(kind.money)
        self.assertIn(kind.pool_permission, self.gm.effective_permission_codenames())
        approval = ApprovalRequest.objects.create(
            kind=kind.key, title="Promo", maker=self.scout, pool_permission=kind.pool_permission,
            stage=ApprovalRequest.POOL, due_at=timezone.now(),
        )
        self.assertFalse(services.can_decide(approval, self.gm))
        self.assertNotIn(approval.pk, services.waiting_for(self.gm).values_list("pk", flat=True))
