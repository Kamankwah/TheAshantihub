from django.test import TestCase

from accounts.models import Permission, Role


class ZonesManagePermissionTests(TestCase):
    def test_zones_manage_permission_exists(self):
        self.assertTrue(Permission.objects.filter(codename="zones.manage").exists())

    def test_admin_and_marketing_have_zones_manage(self):
        for role_name in ("admin", "marketing"):
            role = Role.objects.get(name=role_name)
            self.assertTrue(role.permissions.filter(codename="zones.manage").exists())

    def test_accountant_and_support_do_not_have_zones_manage(self):
        for role_name in ("accountant", "support"):
            role = Role.objects.get(name=role_name)
            self.assertFalse(role.permissions.filter(codename="zones.manage").exists())

    def test_super_admin_has_zones_manage(self):
        super_admin = Role.objects.get(name="super_admin")
        self.assertTrue(super_admin.permissions.filter(codename="zones.manage").exists())
