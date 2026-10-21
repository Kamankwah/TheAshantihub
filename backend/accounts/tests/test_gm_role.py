"""The General Manager role (owner ruling 2026-10-19): Operations' desk work as a checker, Super Admin's read views,
listing approvals; never money rules, ledger settings, withdrawals or any sudo-money permission."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role, StaffUser
from accounts.testing import make_staff, staff_token
from approvals import registry, services
from approvals.models import ApprovalRequest


def perms(role):
    return set(Role.objects.get(name=role).permissions.values_list("codename", flat=True))


class GmSeedTests(TestCase):
    def test_the_role_exists_with_its_label(self):
        self.assertEqual(Role.GENERAL_MANAGER, "general_manager")
        self.assertEqual(dict(Role.NAME_CHOICES)["general_manager"], "General Manager")
        self.assertTrue(Role.objects.filter(name="general_manager").exists())

    def test_gm_holds_operations_desk_work_but_not_client_onboarding(self):
        gm = perms("general_manager")
        makers = {"businesses.register"}
        self.assertEqual((perms("operations") - makers) - gm, set())
        self.assertEqual(gm & makers, set())
        self.assertTrue({"kyc.approve", "listings.moderate", "event.approve", "hero_media.approve"} <= gm)

    def test_gm_decides_every_non_money_kind_and_approves_staffed_listings(self):
        gm = perms("general_manager")
        self.assertIn("approvals.view_all", gm)
        self.assertIn("listings.approve_staffed", gm)

    def test_gm_reads_the_super_admin_dashboards(self):
        self.assertTrue({"activity.view_all", "analytics.view", "calls.view_all", "calls.view_peers", "commission.view_all",
                         "escrow.view", "fees.view", "wallets.view", "reports.view_all"} <= perms("general_manager"))

    def test_gm_never_holds_a_money_or_configuration_permission(self):
        never = {
            "ledger.setting", "ledger.fee_rules", "fees.manage", "wallets.manage", "escrow.release", "escrow.refund",
            "commission.policy", "commission.tax_ruling", "coupons.manage", "delivery.rates", "delivery.cash",
            "disputes.resolve_financial", "otp.recovery", "approvals.manage_rules", "approvals.cosign", "roles.manage",
            "staff.manage", "security.manage", "staff.view_as", "delivery_promo.fund", "credit.manage",
            "event_pricing.approve", "subscription_plans.approve", "transactions.report",
        }
        self.assertEqual(perms("general_manager") & never, set())


class GmInviteTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.other = make_staff("operations", "ops@example.com", manager=self.boss)

    def invite(self, who, **extra):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who, sudo=True)}")
        return self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "Gina Manager", "email": "gina@example.com", "role": "general_manager", **extra}, format="json",
        )

    def test_gm_requires_super_admin_manager(self):
        for extra in ({}, {"manager": self.other.pk}):
            response = self.invite(self.boss, **extra)
            self.assertEqual(response.status_code, 400, extra)
            self.assertIn("manager", response.json())
        self.assertFalse(StaffUser.objects.filter(email="gina@example.com").exists())
        response = self.invite(self.boss, manager=self.boss.pk)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(StaffUser.objects.get(email="gina@example.com").manager, self.boss)

    def test_only_a_super_admin_may_invite_a_gm(self):
        lead = make_staff("operations", "lead@example.com", manager=self.boss)
        Role.objects.get(name="operations")  # an Operations lead can invite team members, not a GM
        response = self.invite(lead, manager=self.boss.pk)
        self.assertIn(response.status_code, (400, 403))
        self.assertFalse(StaffUser.objects.filter(email="gina@example.com").exists())


class GmCannotTouchMoneyTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.gm = make_staff("general_manager", "gm@example.com", manager=self.boss)
        self.accountant = make_staff("accountant", "acc@example.com", manager=self.boss)

    def as_(self, staff, **kw):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, **kw)}")

    def test_gm_cannot_edit_money_rules_or_approve_pending_setting(self):
        self.as_(self.accountant)
        response = self.client.post("/api/ledger/settings/", {"key": "pickup_window_hours", "value": 48}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        pending = ApprovalRequest.objects.get(kind="ledger.setting", status=ApprovalRequest.PENDING)

        self.as_(self.gm, sudo=True)
        self.assertEqual(self.client.post("/api/ledger/settings/", {"key": "pickup_window_hours", "value": 24}, format="json").status_code, 403)
        self.assertEqual(self.client.post("/api/ledger/fees/", {"category": "product", "bands": []}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/approvals/{pending.pk}/approve/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/approvals/{pending.pk}/reject/", {"note": "no"}, format="json").status_code, 403)
        self.assertEqual(ApprovalRequest.objects.get(pk=pending.pk).status, ApprovalRequest.PENDING)
        # the GM may read the money views
        self.assertEqual(self.client.get("/api/ledger/settings/").status_code, 200)

    def test_gm_reads_the_command_center_a_super_admin_reads(self):
        self.as_(self.gm)
        for path in ("/api/approvals/", "/api/approvals/counts/"):
            self.assertEqual(self.client.get(path).status_code, 200, path)
