from django.test import TestCase

from accounts.models import Permission, Role

NEW_CODENAMES = ("hero_media.approve", "event.approve")


class HeroAndEventApprovePermissionTests(TestCase):
    def test_permissions_exist(self):
        for codename in NEW_CODENAMES:
            self.assertTrue(Permission.objects.filter(codename=codename).exists())

    def test_admin_and_marketing_have_both_permissions(self):
        for role_name in ("admin", "marketing"):
            role = Role.objects.get(name=role_name)
            for codename in NEW_CODENAMES:
                self.assertTrue(
                    role.permissions.filter(codename=codename).exists(),
                    f"expected {role_name} to have {codename}",
                )

    def test_accountant_and_support_do_not_have_either_permission(self):
        for role_name in ("accountant", "support"):
            role = Role.objects.get(name=role_name)
            for codename in NEW_CODENAMES:
                self.assertFalse(role.permissions.filter(codename=codename).exists())

    def test_super_admin_effectively_has_both_permissions(self):
        # super_admin's "all permissions" matrix is seeded explicitly (see
        # 0002_seed_roles_permissions.py / 0006_seed_zones_manage_permission.py) —
        # it is not derived dynamically from role name, so it must be seeded
        # onto super_admin explicitly here too, same as every other permission.
        super_admin = Role.objects.get(name="super_admin")
        for codename in NEW_CODENAMES:
            self.assertTrue(super_admin.permissions.filter(codename=codename).exists())
