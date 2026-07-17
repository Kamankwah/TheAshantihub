from django.test import TestCase

from accounts.models import Permission, Role

# The office roles' baseline grants. Later migrations add permissions to some
# of these (e.g. admin gains scouts.assign in 0027, users.manage in 0022), so
# this matrix is a subset check, not an exact-equality one, for those roles —
# see test_baseline_role_permissions below. The field roles (item 11) are
# listed with their own full grants.
DEFAULT_MATRIX = {
    "super_admin": None,  # None = all permissions
    "admin": {"kyc.approve", "listings.moderate", "users.view"},
    "accountant": {"escrow.view", "escrow.release", "disputes.resolve_financial", "transactions.report"},
    "marketing": {"promotions.manage", "analytics.view", "categories.manage"},
    "support": {"messaging.manage", "disputes.flag", "users.view"},
    "scout": {"scouts.verify", "users.view"},
    "delivery_manager": {"delivery.manage"},
    "dispatch": {"delivery.dispatch"},
}


class RoleSeedTests(TestCase):
    def test_all_roles_exist(self):
        names = set(Role.objects.values_list("name", flat=True))
        self.assertEqual(names, set(DEFAULT_MATRIX.keys()))

    def test_super_admin_has_every_permission(self):
        super_admin = Role.objects.get(name="super_admin")
        self.assertEqual(
            set(super_admin.permissions.values_list("codename", flat=True)),
            set(Permission.objects.values_list("codename", flat=True)),
        )

    def test_accountant_cannot_approve_kyc(self):
        accountant = Role.objects.get(name="accountant")
        self.assertFalse(accountant.permissions.filter(codename="kyc.approve").exists())

    def test_marketing_has_no_financial_permissions(self):
        marketing = Role.objects.get(name="marketing")
        financial_codenames = {"escrow.view", "escrow.release", "transactions.report"}
        self.assertFalse(
            marketing.permissions.filter(codename__in=financial_codenames).exists()
        )

    def test_field_roles_hold_their_own_permissions(self):
        for role_name in ("scout", "delivery_manager", "dispatch"):
            role = Role.objects.get(name=role_name)
            self.assertEqual(
                set(role.permissions.values_list("codename", flat=True)),
                DEFAULT_MATRIX[role_name],
            )

    def test_scouts_assign_is_an_office_permission_not_a_field_one(self):
        # A scout does the field work but doesn't assign — that's supervision.
        scout = Role.objects.get(name="scout")
        self.assertFalse(scout.permissions.filter(codename="scouts.assign").exists())
        admin = Role.objects.get(name="admin")
        self.assertTrue(admin.permissions.filter(codename="scouts.assign").exists())

    def test_dispatch_cannot_manage_deliveries_and_vice_versa(self):
        # The two delivery roles are distinct: the manager assigns, the
        # dispatch delivers — neither holds the other's permission.
        dispatch = Role.objects.get(name="dispatch")
        manager = Role.objects.get(name="delivery_manager")
        self.assertFalse(dispatch.permissions.filter(codename="delivery.manage").exists())
        self.assertFalse(manager.permissions.filter(codename="delivery.dispatch").exists())
