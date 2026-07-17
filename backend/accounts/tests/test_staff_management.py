from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Permission, Role, StaffUser


class StaffManagementTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = Role.objects.get(name="super_admin")
        self.support_role = Role.objects.get(name="support")
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-staffmgmt@example.com", password_hash="x",
            role=self.super_admin,
        )
        self.target = StaffUser.objects.create(
            full_name="Target Person", email="target-staffmgmt@example.com", password_hash="x",
            role=self.support_role,
        )
        self.no_perm = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-staffmgmt@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

    def _auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")


class StaffSuspendDeactivateTests(StaffManagementTestsBase):
    def test_suspend_requires_staff_manage(self):
        self._auth(self.no_perm)
        response = self.client.post(f"/api/accounts/staff/{self.target.id}/suspend/", {"reason": "x"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_suspend_records_reason_and_flips_status(self):
        self._auth(self.admin)
        response = self.client.post(f"/api/accounts/staff/{self.target.id}/suspend/", {"reason": "Under review"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.target.refresh_from_db()
        self.assertTrue(self.target.is_suspended)
        self.assertEqual(self.target.suspension_reason, "Under review")
        self.assertEqual(response.json()["status"], "suspended")

    def test_unsuspend_clears_it(self):
        self.target.is_suspended = True
        self.target.suspension_reason = "x"
        self.target.save()
        self._auth(self.admin)
        response = self.client.post(f"/api/accounts/staff/{self.target.id}/unsuspend/")
        self.assertEqual(response.status_code, 200, response.content)
        self.target.refresh_from_db()
        self.assertFalse(self.target.is_suspended)

    def test_deactivate_and_reactivate(self):
        self._auth(self.admin)
        deactivate = self.client.post(f"/api/accounts/staff/{self.target.id}/deactivate/")
        self.assertEqual(deactivate.status_code, 200, deactivate.content)
        self.target.refresh_from_db()
        self.assertFalse(self.target.is_active)
        self.assertEqual(deactivate.json()["status"], "deactivated")

        reactivate = self.client.post(f"/api/accounts/staff/{self.target.id}/reactivate/")
        self.assertEqual(reactivate.status_code, 200, reactivate.content)
        self.target.refresh_from_db()
        self.assertTrue(self.target.is_active)

    def test_cannot_suspend_or_deactivate_self(self):
        self._auth(self.admin)
        self.assertEqual(
            self.client.post(f"/api/accounts/staff/{self.admin.id}/suspend/", {}, format="json").status_code, 400
        )
        self.assertEqual(
            self.client.post(f"/api/accounts/staff/{self.admin.id}/deactivate/").status_code, 400
        )


class SuspendedStaffLoginAndTokenTests(StaffManagementTestsBase):
    """A suspended/deactivated staffer must be stopped at login AND have any
    still-valid token refused mid-session (item 10).
    """

    def setUp(self):
        super().setUp()
        # A real password so the login endpoint can be exercised.
        from django.contrib.auth.hashers import make_password
        self.target.password_hash = make_password("secret-pass")
        self.target.save()

    def _login(self):
        return self.client.post(
            "/api/accounts/staff/login/",
            {"identifier": self.target.email, "password": "secret-pass"}, format="json",
        )

    def test_active_staff_can_log_in(self):
        self.assertEqual(self._login().status_code, 200)

    def test_suspended_staff_cannot_log_in(self):
        self.target.is_suspended = True
        self.target.save()
        self.assertEqual(self._login().status_code, 400)

    def test_deactivated_staff_cannot_log_in(self):
        self.target.is_active = False
        self.target.save()
        self.assertEqual(self._login().status_code, 400)

    def test_existing_token_refused_after_suspension(self):
        """A staffer suspended mid-session is cut immediately, not only at
        their next login.
        """
        token = issue_token(self.target, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 200)

        self.target.is_suspended = True
        self.target.save()
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 401)


class StaffPermissionOverrideTests(StaffManagementTestsBase):
    """Per-staffer grant/revoke, and that the effective set drives BOTH the
    server-side gate and the /me/ permissions list (item 9).
    """

    def test_granting_an_extra_permission_takes_effect_server_side(self):
        # The support role does NOT hold kyc.approve, so the KYC queue 403s.
        target_token = issue_token(self.target, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {target_token}")
        self.assertEqual(self.client.get("/api/accounts/kyc/pending/").status_code, 403)

        # Grant it individually.
        self._auth(self.admin)
        grant = self.client.post(
            f"/api/accounts/staff/{self.target.id}/permissions/",
            {"grant": ["kyc.approve"], "revoke": []}, format="json",
        )
        self.assertEqual(grant.status_code, 200, grant.content)

        # Now the same staffer can reach it.
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {target_token}")
        self.assertEqual(self.client.get("/api/accounts/kyc/pending/").status_code, 200)

    def test_revoking_a_role_permission_takes_effect_server_side(self):
        # Support holds users.view — revoke it individually.
        self._auth(self.admin)
        self.client.post(
            f"/api/accounts/staff/{self.target.id}/permissions/",
            {"grant": [], "revoke": ["users.view"]}, format="json",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.target, 'staff')}")
        self.assertEqual(self.client.get("/api/accounts/customers/").status_code, 403)

    def test_me_permissions_reflects_the_effective_set(self):
        self._auth(self.admin)
        self.client.post(
            f"/api/accounts/staff/{self.target.id}/permissions/",
            {"grant": ["kyc.approve"], "revoke": ["users.view"]}, format="json",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.target, 'staff')}")
        perms = self.client.get("/api/accounts/me/").json()["permissions"]
        self.assertIn("kyc.approve", perms)
        self.assertNotIn("users.view", perms)

    def test_grant_and_revoke_cannot_overlap(self):
        self._auth(self.admin)
        response = self.client.post(
            f"/api/accounts/staff/{self.target.id}/permissions/",
            {"grant": ["kyc.approve"], "revoke": ["kyc.approve"]}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_unknown_permission_is_rejected(self):
        self._auth(self.admin)
        response = self.client.post(
            f"/api/accounts/staff/{self.target.id}/permissions/",
            {"grant": ["not.a.real.permission"], "revoke": []}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_edit_own_permissions(self):
        self._auth(self.admin)
        response = self.client.post(
            f"/api/accounts/staff/{self.admin.id}/permissions/",
            {"grant": [], "revoke": ["staff.manage"]}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_permission_catalog_lists_every_permission(self):
        self._auth(self.admin)
        response = self.client.get("/api/accounts/permissions/")
        self.assertEqual(response.status_code, 200, response.content)
        codenames = {p["codename"] for p in response.json()}
        self.assertEqual(codenames, set(Permission.objects.values_list("codename", flat=True)))

    def test_permission_catalog_requires_staff_manage(self):
        self._auth(self.no_perm)
        self.assertEqual(self.client.get("/api/accounts/permissions/").status_code, 403)


class StaffListStatusTests(StaffManagementTestsBase):
    def test_roster_surfaces_suspended_and_deactivated_status(self):
        self.target.is_suspended = True
        self.target.save()
        self._auth(self.admin)
        rows = {r["id"]: r for r in self.client.get("/api/accounts/staff/").json()["results"]}
        self.assertEqual(rows[self.target.id]["status"], "suspended")

    def test_roster_includes_effective_permissions(self):
        self.target.extra_permissions.set(Permission.objects.filter(codename="kyc.approve"))
        self._auth(self.admin)
        rows = {r["id"]: r for r in self.client.get("/api/accounts/staff/").json()["results"]}
        self.assertIn("kyc.approve", rows[self.target.id]["permissions"])
