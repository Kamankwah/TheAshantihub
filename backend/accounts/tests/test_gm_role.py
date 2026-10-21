"""The General Manager role (owner ruling 2026-10-19): Operations' desk work as a checker, Super Admin's read views,
listing approvals; never money rules, ledger settings, withdrawals or any sudo-money permission."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role, StaffUser
from accounts.testing import make_staff, staff_token
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
        makers = {"businesses.register", "users.manage", "listings.stage"}  # users.manage would rewrite an owner's phone and email
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
        # Operations may invite (staff.invite_team + invite rules) but not a GM: validate_role refuses it
        lead = make_staff("operations", "lead@example.com", manager=self.boss)
        response = self.invite(lead, manager=self.boss.pk)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Only a super_admin can invite a General Manager", str(response.json()["role"]))
        self.assertFalse(StaffUser.objects.filter(email="gina@example.com").exists())

    def test_a_gm_invites_what_operations_invites_and_no_gm_or_super_admin(self):
        gm = make_staff("general_manager", "gm2@example.com", manager=self.boss)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(gm, sudo=True)}")
        ok = self.client.post("/api/accounts/staff/invite/", {"full_name": "Sam Scout", "email": "sam@example.com", "role": "scout"}, format="json")
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(StaffUser.objects.get(email="sam@example.com").manager, gm)
        for role in ("super_admin", "general_manager"):
            refused = self.client.post("/api/accounts/staff/invite/", {"full_name": "No One", "email": f"{role}@example.com", "role": role}, format="json")
            self.assertEqual(refused.status_code, 400, role)
            self.assertFalse(StaffUser.objects.filter(email=f"{role}@example.com").exists())


class GmManagerRuleTests(TestCase):
    """A General Manager's manager is an active Super Admin and never nobody, on every path that sets it."""

    def setUp(self):
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.second = make_staff("super_admin", "boss2@example.com")
        self.lead = make_staff("operations", "ama@example.com", manager=self.boss)
        self.gm = make_staff("general_manager", "gm@example.com", manager=self.boss)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")

    def assert_still_under_boss(self):
        self.gm.refresh_from_db()
        self.assertEqual(self.gm.manager, self.boss)

    def test_staff_manager_view_refuses_a_non_super_admin_or_nobody(self):
        url = f"/api/accounts/staff/{self.gm.pk}/manager/"
        for body in ({"manager": self.lead.pk}, {"manager": None}, {"manager": ""}):
            self.assertEqual(self.client.post(url, body, format="json").status_code, 400, body)
            self.assert_still_under_boss()
        self.assertEqual(self.client.post(url, {"manager": self.second.pk}, format="json").status_code, 200)
        self.gm.refresh_from_db()
        self.assertEqual(self.gm.manager, self.second)

    def test_reassign_refuses_a_non_super_admin_manager(self):
        response = self.client.post("/api/people/teams/reassign/", {"staff": self.gm.pk, "manager": self.lead.pk, "reason": "move"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assert_still_under_boss()
        ok = self.client.post("/api/people/teams/reassign/", {"staff": self.gm.pk, "manager": self.second.pk, "reason": "move"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)

    def test_change_role_to_gm_needs_a_super_admin_manager(self):
        under_lead = make_staff("scout", "yaw@example.com", manager=self.lead)
        orphan = make_staff("scout", "efua@example.com")
        for person in (under_lead, orphan):
            response = self.client.post(f"/api/people/staff/{person.pk}/role/", {"role": "general_manager", "reason": "promoted"}, format="json")
            self.assertEqual(response.status_code, 400, person.email)
            person.refresh_from_db()
            self.assertEqual(person.role.name, "scout")
        under_boss = make_staff("scout", "kojo@example.com", manager=self.boss)
        response = self.client.post(f"/api/people/staff/{under_boss.pk}/role/", {"role": "general_manager", "reason": "promoted"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)


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

    def test_gm_cannot_change_an_owners_login_phone_or_email(self):
        from django.contrib.auth.hashers import make_password
        from accounts.models import BusinessOwner
        owner = BusinessOwner.objects.create(full_name="Kwame Trader", login_phone="+233201112233", email="kwame@example.com", password_hash=make_password("x"))
        self.as_(self.gm, sudo=True)
        for body in ({"login_phone": "+233209998877"}, {"email": "new@example.com"}, {"full_name": "Someone Else"}):
            self.assertEqual(self.client.patch(f"/api/accounts/business-owners/{owner.pk}/", body, format="json").status_code, 403, body)
        owner.refresh_from_db()
        self.assertEqual((owner.login_phone, owner.email), ("+233201112233", "kwame@example.com"))
