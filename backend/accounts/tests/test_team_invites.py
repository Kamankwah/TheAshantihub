from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Permission, Role, StaffUser
from accounts.testing import staff_token


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(),
        email=email,
        password_hash="x",
        role=Role.objects.get(name=role),
        **extra,
    )


class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.super_admin = make_staff("super_admin", "boss@example.com")
        self.ops = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.dm = make_staff("delivery_manager", "adwoa@example.com")

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=True)}")


class TeamInviteTests(Base):
    def invite(self, role, email="new@example.com", **extra):
        return self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "New Person", "email": email, "role": role, **extra},
            format="json",
        )

    def test_operations_invites_a_scout_who_reports_to_them(self):
        self.as_(self.ops)
        response = self.invite("scout")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(StaffUser.objects.get(email="new@example.com").manager, self.ops)
        self.assertEqual(len(mail.outbox), 1)

    def test_operations_invites_support(self):
        self.as_(self.ops)
        self.assertEqual(self.invite("support").status_code, 201)

    def test_operations_cannot_invite_other_roles(self):
        self.as_(self.ops)
        for role in ["marketing", "accountant", "dispatch", "operations", "super_admin"]:
            self.assertEqual(self.invite(role, email=f"{role}@example.com").status_code, 400, role)

    def test_delivery_manager_invites_dispatch_only(self):
        self.as_(self.dm)
        self.assertEqual(self.invite("dispatch").status_code, 201)
        self.assertEqual(self.invite("scout", email="s@example.com").status_code, 400)

    def test_role_without_team_invites_is_forbidden(self):
        self.as_(make_staff("support", "esi@example.com"))
        self.assertEqual(self.invite("scout").status_code, 403)

    def test_team_inviter_cannot_pick_another_manager(self):
        self.as_(self.ops)
        self.invite("scout", manager=self.other_ops.id)
        self.assertEqual(StaffUser.objects.get(email="new@example.com").manager, self.ops)

    def test_super_admin_can_set_any_manager(self):
        self.as_(self.super_admin)
        self.assertEqual(self.invite("scout", manager=self.other_ops.id).status_code, 201)
        self.assertEqual(StaffUser.objects.get(email="new@example.com").manager, self.other_ops)

    def test_an_invite_names_only_a_manager_who_can_lead(self):
        # Same rule as StaffManagerView: a Super Admin or staff.invite_team.
        self.as_(self.super_admin)
        support = make_staff("support", "esi@example.com")
        refused = self.invite("scout", manager=support.id)
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json(), {"manager": ["Choose a manager who can lead a team."]})
        self.assertFalse(StaffUser.objects.filter(email="new@example.com").exists())
        support.extra_permissions.add(Permission.objects.get(codename="staff.invite_team"))
        self.assertEqual(self.invite("scout", manager=support.id).status_code, 201)
        self.assertEqual(self.invite("scout", email="b@example.com", manager=self.super_admin.id).status_code, 201)
        self.assertEqual(self.invite("scout", email="c@example.com", manager=None).status_code, 201)


class TeamScopeTests(Base):
    def setUp(self):
        super().setUp()
        self.scout = make_staff("scout", "kwame@example.com", manager=self.ops)
        self.other_scout = make_staff("scout", "efua@example.com", manager=self.other_ops)
        self.pending = make_staff(
            "scout", "pending@example.com", manager=self.ops, invite_token="t" * 43
        )

    def post(self, path, data=None):
        return self.client.post(path, data or {}, format="json")

    def test_manager_suspends_and_unsuspends_own_report(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.scout.id}/suspend/", {"reason": "x"}).status_code, 200)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.scout.id}/unsuspend/").status_code, 200)

    def test_manager_cannot_suspend_someone_elses_report(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.other_scout.id}/suspend/").status_code, 403)

    def test_manager_cannot_suspend_self_or_super_admin(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.ops.id}/suspend/").status_code, 400)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.super_admin.id}/suspend/").status_code, 403)

    def test_manager_cannot_act_on_non_invitable_roles_even_if_they_manage_them(self):
        boss2 = make_staff("super_admin", "boss2@example.com", manager=self.ops)
        accountant = make_staff("accountant", "acc@example.com", manager=self.ops, invite_token="a" * 43)
        self.as_(self.ops)
        for target in (boss2, accountant):
            for action in ("suspend", "unsuspend", "resend-invite"):
                response = self.post(f"/api/accounts/staff/{target.id}/{action}/")
                self.assertEqual(response.status_code, 403, (target.role.name, action))

    def test_manager_cannot_unsuspend_another_teams_report(self):
        self.other_scout.is_suspended = True
        self.other_scout.save(update_fields=["is_suspended"])
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.other_scout.id}/unsuspend/").status_code, 403)

    def test_manager_cannot_deactivate(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.scout.id}/deactivate/").status_code, 403)

    def test_manager_resends_only_own_teams_invites(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.pending.id}/resend-invite/").status_code, 200)
        self.other_scout.invite_token = "u" * 43
        self.other_scout.save(update_fields=["invite_token"])
        self.assertEqual(self.post(f"/api/accounts/staff/{self.other_scout.id}/resend-invite/").status_code, 403)

    def test_deactivating_a_manager_with_active_reports_is_refused(self):
        self.as_(self.super_admin)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.ops.id}/deactivate/").status_code, 400)
        StaffUser.objects.filter(manager=self.ops).update(manager=self.other_ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.ops.id}/deactivate/").status_code, 200)

    def test_team_list_shows_only_direct_reports(self):
        self.as_(self.ops)
        response = self.client.get("/api/accounts/staff/team/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({row["email"] for row in response.json()}, {"kwame@example.com", "pending@example.com"})
        self.assertEqual(response.json()[0]["manager_name"], self.ops.full_name)

    def test_invitable_roles(self):
        self.as_(self.ops)
        self.assertEqual(self.client.get("/api/accounts/staff/invitable-roles/").json(), ["scout", "support"])
        self.as_(self.super_admin)
        self.assertEqual(
            self.client.get("/api/accounts/staff/invitable-roles/").json(),
            sorted(Role.objects.values_list("name", flat=True)),
        )


class ManagerAssignmentTests(Base):
    def set_manager(self, staff, manager_id):
        return self.client.post(f"/api/accounts/staff/{staff.id}/manager/", {"manager": manager_id}, format="json")

    def test_super_admin_sets_and_clears_a_manager(self):
        self.as_(self.super_admin)
        scout = make_staff("scout", "kwame@example.com")
        self.assertEqual(self.set_manager(scout, self.ops.id).json()["manager"], self.ops.id)
        self.assertIsNone(self.set_manager(scout, None).json()["manager"])

    def test_own_manager_and_cycles_are_refused(self):
        self.as_(self.super_admin)
        self.assertEqual(self.set_manager(self.ops, self.ops.id).status_code, 400)
        self.set_manager(self.other_ops, self.ops.id)
        self.assertEqual(self.set_manager(self.ops, self.other_ops.id).status_code, 400)

    def test_a_manager_must_be_able_to_lead_a_team(self):
        self.as_(self.super_admin)
        scout = make_staff("scout", "kwame@example.com")
        support = make_staff("support", "esi@example.com")
        refused = self.set_manager(scout, support.id)
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json(), {"detail": "Choose a manager who can lead a team."})
        scout.refresh_from_db()
        self.assertIsNone(scout.manager)

    def test_a_revoked_invite_team_permission_disqualifies_a_manager(self):
        self.as_(self.super_admin)
        self.ops.revoked_permissions.add(Permission.objects.get(codename="staff.invite_team"))
        scout = make_staff("scout", "kwame@example.com")
        self.assertEqual(self.set_manager(scout, self.ops.id).status_code, 400)

    def test_an_individual_invite_team_grant_qualifies_a_manager(self):
        self.as_(self.super_admin)
        support = make_staff("support", "esi@example.com")
        support.extra_permissions.add(Permission.objects.get(codename="staff.invite_team"))
        scout = make_staff("scout", "kwame@example.com")
        self.assertEqual(self.set_manager(scout, support.id).json()["manager"], support.id)

    def test_a_super_admin_can_always_lead(self):
        self.as_(self.super_admin)
        boss2 = make_staff("super_admin", "boss2@example.com")
        scout = make_staff("scout", "kwame@example.com")
        self.assertEqual(self.set_manager(scout, boss2.id).json()["manager"], boss2.id)

    def test_clearing_a_manager_is_always_allowed(self):
        scout = make_staff("scout", "kwame@example.com", manager=make_staff("support", "esi@example.com"))
        self.as_(self.super_admin)
        response = self.set_manager(scout, None)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["manager"])

    def test_only_staff_manage_can_set_managers(self):
        self.as_(self.ops)
        self.assertEqual(self.set_manager(self.other_ops, self.ops.id).status_code, 403)
