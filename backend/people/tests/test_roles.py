from accounts.models import Permission, Role, StaffUser
from accounts.testing import make_staff
from activity.models import ActivityEvent

from .base import PeopleTestCase

URL = "/api/people/roles/"


def change(role, permission, grant=True):
    return {"role": role, "permission": permission, "grant": grant}


class RoleMatrixTests(PeopleTestCase):
    def test_lists_every_role_and_every_real_permission_grouped(self):
        self.sign_in()
        data = self.client.get(URL).json()
        roles = {r["name"]: r for r in data["roles"]}
        self.assertTrue(roles["super_admin"]["locked"])
        self.assertEqual(roles["operations"]["people"], 2)
        codes = {p["codename"]: p for g in data["groups"] for p in g["permissions"]}
        self.assertEqual(len(codes), Permission.objects.count())
        self.assertEqual(data["permission_count"], Permission.objects.count())
        self.assertTrue(codes["kyc.approve"]["roles"]["operations"])
        self.assertFalse(codes["kyc.approve"]["roles"]["scout"])
        # Permissions a later phase has not created are not invented.
        self.assertNotIn("payouts.prepare", codes)
        self.assertNotIn("campaigns.send", codes)
        self.assertIn("super_admin", codes["kyc.approve"]["locked_for"])

    def test_individual_exceptions_are_counted_per_role(self):
        self.kwame.extra_permissions.add(Permission.objects.get(codename="orders.manage_delivery"))
        self.kwame.revoked_permissions.add(Permission.objects.get(codename="calls.log"))
        self.sign_in()
        scout = next(r for r in self.client.get(URL).json()["roles"] if r["name"] == "scout")
        self.assertEqual((scout["grants"], scout["revokes"]), (1, 1))

    def test_needs_staff_manage(self):
        self.sign_in(self.ama)
        self.assertEqual(self.client.get(URL).status_code, 403)


class PreviewTests(PeopleTestCase):
    def preview(self, *changes):
        return self.client.post(URL + "preview/", {"changes": list(changes)}, format="json")

    def test_says_exactly_what_would_change_and_saves_nothing(self):
        perm = Permission.objects.get(codename="orders.manage_delivery")
        self.kwame.extra_permissions.add(perm)
        self.sign_in()
        data = self.preview(change("scout", "orders.manage_delivery"), change("operations", "kyc.approve", False)).json()
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["people_affected"], 3)  # one scout, two operations
        grant = next(c for c in data["changes"] if c["role"] == "scout")
        self.assertIn("Kwame already had this as an individual grant", grant["effect"])
        self.assertEqual(grant["exceptions"], [{"name": "Kwame", "kind": "granted individually"}])
        self.assertFalse(Role.objects.get(name="scout").permissions.filter(codename="orders.manage_delivery").exists())
        self.assertTrue(Role.objects.get(name="operations").permissions.filter(codename="kyc.approve").exists())

    def test_changes_that_change_nothing_are_dropped(self):
        self.sign_in()
        data = self.preview(change("operations", "kyc.approve", True)).json()
        self.assertEqual(data["count"], 0)

    def test_guards_are_explained(self):
        self.sign_in()
        cases = [
            change("super_admin", "kyc.approve", False),
            change("operations", "roles.manage"),
            change("operations", "staff.manage"),
            change("operations", "approvals.cosign"),
            change("cosigner", "kyc.approve"),
            change("cosigner", "approvals.cosign", False),
            change("operations", "no.such"),
            change("nobody", "kyc.approve"),
        ]
        for case in cases:
            with self.subTest(case=case):
                response = self.preview(case)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json()["detail"])


class SaveTests(PeopleTestCase):
    def save(self, *changes):
        return self.client.post(URL + "save/", {"changes": list(changes)}, format="json")

    def test_needs_the_password(self):
        self.sign_in()
        response = self.save(change("scout", "orders.manage_delivery"))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "sudo_required")

    def test_applies_at_once_and_records_before_and_after(self):
        self.sign_in(sudo=True)
        response = self.save(change("scout", "orders.manage_delivery"), change("operations", "kyc.approve", False))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"saved": 2, "people_affected": 3})
        self.assertTrue(Role.objects.get(name="scout").permissions.filter(codename="orders.manage_delivery").exists())
        self.assertFalse(Role.objects.get(name="operations").permissions.filter(codename="kyc.approve").exists())
        # the effective set follows immediately
        self.assertIn("orders.manage_delivery", StaffUser.objects.get(pk=self.kwame.pk).effective_permission_codenames())
        self.assertNotIn("kyc.approve", StaffUser.objects.get(pk=self.ama.pk).effective_permission_codenames())
        event = ActivityEvent.objects.get(verb="role.permissions_changed")
        self.assertEqual(event.before["scout"], {"orders.manage_delivery": "no"})
        self.assertEqual(event.after["scout"], {"orders.manage_delivery": "yes"})
        self.assertEqual(event.after["operations"], {"kyc.approve": "no"})
        self.assertEqual(ActivityEvent.objects.filter(verb__startswith="role").count(), 1)

    def test_refused_changes_save_nothing(self):
        self.sign_in(sudo=True)
        response = self.save(change("scout", "orders.manage_delivery"), change("operations", "roles.manage"))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Role.objects.get(name="scout").permissions.filter(codename="orders.manage_delivery").exists())
        self.assertEqual(ActivityEvent.objects.filter(verb="role.permissions_changed").count(), 0)

    def test_nothing_to_save_is_a_400(self):
        self.sign_in(sudo=True)
        self.assertEqual(self.save(change("operations", "kyc.approve", True)).status_code, 400)

    def test_super_admin_role_still_holds_every_permission_after_any_save(self):
        self.sign_in(sudo=True)
        self.save(change("scout", "orders.manage_delivery"))
        held = set(Role.objects.get(name="super_admin").permissions.values_list("codename", flat=True))
        self.assertEqual(held, set(Permission.objects.values_list("codename", flat=True)))

    def test_only_roles_manage_holders_can_save(self):
        # staff.manage alone (granted by hand to a non Super Admin) is not enough.
        self.ama.extra_permissions.add(Permission.objects.get(codename="staff.manage"))
        self.sign_in(self.ama, sudo=True)
        self.assertEqual(self.save(change("scout", "orders.manage_delivery")).status_code, 403)
