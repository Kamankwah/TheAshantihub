from django.test import TestCase

from accounts.models import Permission, Role

CODENAME = "orders.manage_delivery"


class OrdersManageDeliveryPermissionTests(TestCase):
    def test_permission_exists(self):
        self.assertTrue(Permission.objects.filter(codename=CODENAME).exists())

    def test_admin_has_permission(self):
        role = Role.objects.get(name="operations")
        self.assertTrue(role.permissions.filter(codename=CODENAME).exists())

    def test_support_no_longer_has_permission(self):
        # It could mark an order Delivered, which only the rider's code or a delivery manager may do.
        # Support uses the narrow orders.support_update instead (migration 0047).
        role = Role.objects.get(name="support")
        self.assertFalse(role.permissions.filter(codename=CODENAME).exists())
        self.assertTrue(role.permissions.filter(codename="orders.support_update").exists())

    def test_super_admin_has_permission(self):
        role = Role.objects.get(name="super_admin")
        self.assertTrue(role.permissions.filter(codename=CODENAME).exists())

    def test_other_roles_do_not_have_permission(self):
        for role_name in ("accountant", "marketing"):
            role = Role.objects.get(name=role_name)
            self.assertFalse(
                role.permissions.filter(codename=CODENAME).exists(),
                f"expected {role_name} not to have {CODENAME}",
            )
