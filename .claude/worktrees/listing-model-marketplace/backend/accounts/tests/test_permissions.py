from django.test import TestCase

from accounts.models import Role, StaffUser
from accounts.permissions import HasRolePermission


class FakeRequest:
    def __init__(self, user):
        self.user = user


class HasRolePermissionTests(TestCase):
    def test_role_with_permission_is_granted(self):
        admin_role = Role.objects.get(name="admin")
        staff = StaffUser.objects.create(
            full_name="Adwoa Admin", email="adwoa@example.com", password_hash="x", role=admin_role
        )
        permission = HasRolePermission("kyc.approve")
        self.assertTrue(permission.has_permission(FakeRequest(staff), None))

    def test_role_without_permission_is_denied(self):
        accountant_role = Role.objects.get(name="accountant")
        staff = StaffUser.objects.create(
            full_name="Yaw Accounts", email="yaw@example.com", password_hash="x", role=accountant_role
        )
        permission = HasRolePermission("kyc.approve")
        self.assertFalse(permission.has_permission(FakeRequest(staff), None))

    def test_non_staff_account_is_denied(self):
        from accounts.models import Customer

        customer = Customer.objects.create(full_name="Ama", phone="+233200000000", password_hash="x")
        permission = HasRolePermission("kyc.approve")
        self.assertFalse(permission.has_permission(FakeRequest(customer), None))
