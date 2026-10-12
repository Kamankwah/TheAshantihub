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

    def test_operations_can_read_service_issues_but_not_reply_or_manage_deliveries(self):
        perms = set(Role.objects.get(name="operations").permissions.values_list("codename", flat=True))
        self.assertIn("service_issues.view", perms)
        self.assertNotIn("messaging.manage", perms)
        self.assertNotIn("delivery.manage", perms)
        self.assertNotIn("service_issues.view", set(Role.objects.get(name="support").permissions.values_list("codename", flat=True)))
        self.assertIn("service_issues.view", set(Role.objects.get(name="super_admin").permissions.values_list("codename", flat=True)))
