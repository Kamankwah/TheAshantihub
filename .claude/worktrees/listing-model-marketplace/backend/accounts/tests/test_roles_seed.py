from django.test import TestCase

from accounts.models import Permission, Role

DEFAULT_MATRIX = {
    "super_admin": None,  # None = all permissions
    "admin": {"kyc.approve", "listings.moderate", "users.view"},
    "accountant": {"escrow.view", "escrow.release", "disputes.resolve_financial", "transactions.report"},
    "marketing": {"promotions.manage", "analytics.view", "categories.manage"},
    "support": {"messaging.manage", "disputes.flag", "users.view"},
}


class RoleSeedTests(TestCase):
    def test_all_five_roles_exist(self):
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
