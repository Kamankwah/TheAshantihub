from django.test import TestCase

from accounts.models import Permission, Role
from accounts.permissions import staff_holding
from accounts.testing import make_staff

# Staff phase 2 (spec S12): who holds each new permission besides Super Admin.
PHASE2_GRANTS = {
    "businesses.register": {"scout", "operations"},
    "businesses.manage_portfolio": {"scout"},
    "portfolio.manage": {"operations"},
    "targets.manage": {"operations"},
    "targets.limits": set(),
    "calendar.manage": set(),
    "leave.record": {"operations"},
    "commission.view_own": {"scout"},
    "commission.view_all": {"accountant"},
    "commission.policy": {"accountant"},
    "fraud.manage": {"operations"},
    "fraud.flag": {"support", "operations"},
}


class Phase2PermissionSeedTests(TestCase):
    def test_every_phase2_permission_exists_with_a_description(self):
        for codename in PHASE2_GRANTS:
            with self.subTest(codename=codename):
                self.assertTrue(Permission.objects.get(codename=codename).description.strip())

    def test_each_goes_to_exactly_its_roles_and_super_admin(self):
        for codename, roles in PHASE2_GRANTS.items():
            with self.subTest(codename=codename):
                holders = set(Role.objects.filter(permissions__codename=codename).values_list("name", flat=True))
                self.assertEqual(holders, roles | {"super_admin"})

    def test_staff_hold_them_through_their_role(self):
        scout = make_staff("scout", "kwame@example.com")
        lead = make_staff("operations", "ama@example.com")
        support = make_staff("support", "esi@example.com")
        accountant = make_staff("accountant", "kofi@example.com")
        scout_perms = scout.effective_permission_codenames()
        self.assertLessEqual({"businesses.register", "businesses.manage_portfolio", "commission.view_own"}, scout_perms)
        self.assertFalse({"portfolio.manage", "fraud.flag", "fraud.manage"} & scout_perms)
        self.assertIn("fraud.flag", support.effective_permission_codenames())
        self.assertNotIn("fraud.manage", support.effective_permission_codenames())
        self.assertLessEqual({"commission.view_all", "commission.policy"}, accountant.effective_permission_codenames())
        self.assertIn(lead, staff_holding("fraud.manage"))
        self.assertNotIn(support, staff_holding("fraud.manage"))
        self.assertIn(support, staff_holding("fraud.flag"))
        self.assertNotIn(lead, staff_holding("targets.limits"))
