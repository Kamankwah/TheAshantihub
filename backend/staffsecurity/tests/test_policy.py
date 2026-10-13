import pyotp

from accounts import two_factor
from activity.models import ActivityEvent
from notifications.models import Notification
from staffsecurity import policy

from .base import SecurityBase


class PolicyTests(SecurityBase):
    def test_reading_needs_the_permission(self):
        self.as_staff(self.esi)
        self.assertEqual(self.client.get("/api/staff-security/policy/").status_code, 403)

    def test_it_reports_roles_counts_and_the_limits(self):
        secret, _ = two_factor.begin_enrolment(self.esi)
        with self.clock():
            two_factor.confirm_enrolment(self.esi, pyotp.TOTP(secret).at(self.t0))
        self.as_staff(self.boss)
        body = self.client.get("/api/staff-security/policy/").json()
        roles = {r["name"]: r for r in body["roles"]}
        self.assertEqual((roles["super_admin"]["required"], roles["super_admin"]["locked"]), (True, True))
        self.assertEqual((roles["support"]["people"], roles["support"]["using"], roles["support"]["required"]), (1, 1, False))
        self.assertEqual(body["limits"], {"idle_minutes": 30, "absolute_hours": 12, "password_window_minutes": 10})
        self.assertTrue(body["password_protected"])

    def test_changing_it_needs_the_password(self):
        self.as_staff(self.boss)
        response = self.client.patch("/api/staff-security/policy/", {"two_factor_roles": ["support"]}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "sudo_required"))
        self.assertFalse(policy.requires_two_factor("support"))

    def test_changing_it_is_saved_audited_and_enforced_at_sign_in(self):
        self.as_staff(self.boss, sudo=True)
        response = self.client.patch("/api/staff-security/policy/", {"two_factor_roles": ["support", "super_admin"]}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(next(r for r in response.json()["roles"] if r["name"] == "support")["required"])
        event = ActivityEvent.objects.get(verb="security.policy_changed")
        self.assertEqual((event.before, event.after), ({"two_factor_roles": []}, {"two_factor_roles": ["support"]}))
        self.assertEqual(ActivityEvent.objects.filter(verb="security.policy_changed").count(), 1)
        self.client.credentials()
        step = self.login("esi@example.com").json()
        self.assertEqual(set(step), {"two_factor_setup_required", "mfa_token"})
        self.assertIn("token", self.login("ama@example.com").json())

    def test_a_required_role_cannot_turn_it_off(self):
        policy.set_roles({"support"}, self.boss)
        secret, _ = two_factor.begin_enrolment(self.esi)
        with self.clock():
            two_factor.confirm_enrolment(self.esi, pyotp.TOTP(secret).at(self.t0))
        self.as_staff(self.esi, sudo=True)
        response = self.client.post("/api/accounts/staff/two-factor/disable/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("requires it", response.json()["detail"])

    def test_removing_a_role_lets_it_off_again_and_super_admin_cannot_be_removed(self):
        policy.set_roles({"support"}, self.boss)
        self.as_staff(self.boss, sudo=True)
        body = self.client.patch("/api/staff-security/policy/", {"two_factor_roles": []}, format="json").json()
        self.assertFalse(next(r for r in body["roles"] if r["name"] == "support")["required"])
        self.assertTrue(next(r for r in body["roles"] if r["name"] == "super_admin")["required"])
        self.assertTrue(two_factor.is_required(self.boss))

    def test_bad_input_is_refused(self):
        self.as_staff(self.boss, sudo=True)
        for bad in ("support", ["nonsense"], [1], None):
            response = self.client.patch("/api/staff-security/policy/", {"two_factor_roles": bad}, format="json")
            self.assertEqual(response.status_code, 400, bad)

    def test_another_super_admin_is_told_of_a_change(self):
        from accounts.testing import make_staff

        second = make_staff("super_admin", "second@example.com")
        self.as_staff(self.boss, sudo=True)
        self.client.patch("/api/staff-security/policy/", {"two_factor_roles": ["scout"]}, format="json")
        note = Notification.objects.get(staff=second, kind="security_policy_changed")
        self.assertIn("Scout", note.body)
        self.assertFalse(Notification.objects.filter(staff=self.boss, kind="security_policy_changed").exists())
        self.client.patch("/api/staff-security/policy/", {"two_factor_roles": ["scout"]}, format="json")
        self.assertEqual(Notification.objects.filter(kind="security_policy_changed").count(), 1)
