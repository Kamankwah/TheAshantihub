from django.test import TestCase

from accounts.models import Role


class OperationsRoleTests(TestCase):
    def test_admin_role_is_renamed_to_operations(self):
        self.assertTrue(Role.objects.filter(name="operations").exists())
        self.assertFalse(Role.objects.filter(name="admin").exists())

    def test_operations_keeps_every_permission_admin_had(self):
        perms = set(Role.objects.get(name="operations").permissions.values_list("codename", flat=True))
        self.assertTrue(
            {"kyc.approve", "listings.moderate", "scouts.assign", "users.manage", "site_settings.manage"} <= perms
        )

    def test_label_is_operations(self):
        self.assertEqual(dict(Role.NAME_CHOICES)["operations"], "Operations")
