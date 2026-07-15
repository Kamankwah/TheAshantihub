from django.test import TestCase

from accounts.models import Permission, Role

CODENAME = "site_settings.manage"


class SiteSettingsManagePermissionTests(TestCase):
    def test_permission_exists(self):
        self.assertTrue(Permission.objects.filter(codename=CODENAME).exists())

    def test_admin_has_permission(self):
        role = Role.objects.get(name="admin")
        self.assertTrue(role.permissions.filter(codename=CODENAME).exists())

    def test_super_admin_has_permission(self):
        role = Role.objects.get(name="super_admin")
        self.assertTrue(role.permissions.filter(codename=CODENAME).exists())

    def test_other_roles_do_not_have_permission(self):
        for role_name in ("accountant", "marketing", "support"):
            role = Role.objects.get(name=role_name)
            self.assertFalse(
                role.permissions.filter(codename=CODENAME).exists(),
                f"expected {role_name} not to have {CODENAME}",
            )
