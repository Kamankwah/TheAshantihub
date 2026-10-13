"""Co-signer separation and the Super-Admin-only permissions: per-person grants
(accounts StaffPermissionsView) and role changes (people ChangeRoleView)."""
from accounts.models import Permission, Role, StaffSession
from accounts.testing import make_staff
from people.roles import SUPER_ADMIN_ONLY, refusal

from .base import PeopleTestCase

NEW_SA_ONLY = ("commission.tax_ruling", "security.manage", "exports.schedule", "announcements.send", "system.view")


class GrantSeparationTests(PeopleTestCase):
    def setUp(self):
        super().setUp()
        self.cosigner = make_staff("cosigner", "cosign@example.com")

    def grant(self, staff, codes):
        return self.client.post(f"/api/accounts/staff/{staff.pk}/permissions/", {"grant": codes, "revoke": []}, format="json")

    def test_cosign_cannot_be_granted_to_anyone_outside_the_cosigner_role(self):
        self.sign_in(sudo=True)
        response = self.grant(self.kojo, ["approvals.cosign"])
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(self.kojo.extra_permissions.exists())

    def test_nothing_can_be_granted_to_the_cosigner(self):
        self.sign_in(sudo=True)
        for codes in (["kyc.approve"], ["approvals.cosign"]):
            self.assertEqual(self.grant(self.cosigner, codes).status_code, 400)
        self.assertFalse(self.cosigner.extra_permissions.exists())

    def test_the_super_admin_only_permissions_are_listed_and_not_grantable_by_others(self):
        for code in NEW_SA_ONLY:
            self.assertIn(code, SUPER_ADMIN_ONLY)
            self.assertTrue(refusal("operations", code, True))
        # A non Super Admin holding staff.manage by an individual grant.
        self.ama.extra_permissions.add(Permission.objects.get(codename="staff.manage"))
        self.sign_in(self.ama, sudo=True)
        for code in NEW_SA_ONLY:
            self.assertEqual(self.grant(self.kojo, [code]).status_code, 403, code)
        self.assertFalse(self.kojo.extra_permissions.exists())


class ChangeRoleSeparationTests(PeopleTestCase):
    def url(self, staff):
        return f"/api/people/staff/{staff.pk}/role/"

    def change(self, staff, role):
        return self.client.post(self.url(staff), {"role": role, "reason": "Because"}, format="json")

    def test_a_person_with_individual_grants_cannot_become_the_cosigner(self):
        self.kojo.extra_permissions.add(Permission.objects.get(codename="kyc.approve"))
        self.sign_in(sudo=True)
        self.assertEqual(self.change(self.kojo, "cosigner").status_code, 400)
        self.kojo.refresh_from_db()
        self.assertEqual(self.kojo.role.name, "operations")
        self.kojo.extra_permissions.clear()
        self.assertEqual(self.change(self.kojo, "cosigner").status_code, 200)

    def test_leaving_the_cosigner_role_clears_any_extras(self):
        cosigner = make_staff("cosigner", "cosign@example.com")
        # Not reachable through the API; defensive for rows that predate the rule.
        cosigner.extra_permissions.add(Permission.objects.get(codename="approvals.cosign"))
        self.sign_in(sudo=True)
        self.assertEqual(self.change(cosigner, "support").status_code, 200)
        self.assertFalse(cosigner.extra_permissions.exists())


class ChangeRoleSessionTests(PeopleTestCase):
    def live(self, staff):
        from accounts.testing import staff_token

        staff_token(staff)
        return StaffSession.objects.filter(staff=staff, revoked_at__isnull=True)

    def test_becoming_super_admin_ends_live_sessions(self):
        self.assertTrue(self.live(self.kojo).exists())
        self.sign_in(sudo=True)
        response = self.client.post(f"/api/people/staff/{self.kojo.pk}/role/", {"role": "super_admin", "reason": "Deputy"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(StaffSession.objects.filter(staff=self.kojo, revoked_at__isnull=True).exists())

    def test_moving_into_a_two_step_role_ends_sessions_but_other_moves_do_not(self):
        from staffsecurity import policy

        policy.set_roles(["marketing"], self.boss)
        self.assertTrue(self.live(self.esi).exists())
        self.sign_in(sudo=True)
        self.assertEqual(self.client.post(f"/api/people/staff/{self.esi.pk}/role/", {"role": "scout", "reason": "x"}, format="json").status_code, 200)
        self.assertTrue(StaffSession.objects.filter(staff=self.esi, revoked_at__isnull=True).exists())
        self.assertEqual(self.client.post(f"/api/people/staff/{self.esi.pk}/role/", {"role": "marketing", "reason": "x"}, format="json").status_code, 200)
        self.assertFalse(StaffSession.objects.filter(staff=self.esi, revoked_at__isnull=True).exists())
