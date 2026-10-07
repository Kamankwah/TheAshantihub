from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffUser
from activity import services


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class ActivityApiTests(TestCase):
    def setUp(self):
        self.boss = make_staff("super_admin", "boss@example.com")
        self.ops = make_staff("operations", "ama@example.com")
        self.dm = make_staff("delivery_manager", "adwoa@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.ops)
        self.other_scout = make_staff("scout", "efua@example.com")
        self.marketer = make_staff("marketing", "akua@example.com")
        self.accountant = make_staff("accountant", "kwabena@example.com")
        self.rider = make_staff("dispatch", "kofi@example.com", manager=self.dm)
        for actor, verb in [
            (self.ops, "kyc-approve"), (self.scout, "scout.checked_in"), (self.other_scout, "scout.checked_in"),
            (self.marketer, "promotion-approve"), (self.accountant, "commission.batch_prepared"),
            (self.accountant, "escrow-release"), (self.dm, "order-assign-dispatch"), (self.dm, "shift.planned"),
            (self.rider, "delivery-pickup"),
        ]:
            services.record(actor, verb)
        self.client = APIClient()

    def verbs_for(self, staff, query=""):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        response = self.client.get(f"/api/activity/{query}")
        self.assertEqual(response.status_code, 200)
        return sorted((row["actor_label"], row["verb"]) for row in response.json()["results"])

    def test_a_scout_sees_only_their_own_events(self):
        self.assertEqual(self.verbs_for(self.scout), [("Kwame", "scout.checked_in")])

    def test_operations_sees_overseen_roles_and_relevant_finance_and_delivery(self):
        got = self.verbs_for(self.ops)
        self.assertIn(("Ama", "kyc-approve"), got)
        self.assertIn(("Efua", "scout.checked_in"), got)
        self.assertIn(("Akua", "promotion-approve"), got)
        self.assertIn(("Kwabena", "commission.batch_prepared"), got)
        self.assertIn(("Adwoa", "order-assign-dispatch"), got)
        self.assertIn(("Kofi", "delivery-pickup"), got)
        self.assertNotIn(("Kwabena", "escrow-release"), got)
        self.assertNotIn(("Adwoa", "shift.planned"), got)

    def test_delivery_manager_sees_own_and_team(self):
        self.assertEqual(
            self.verbs_for(self.dm),
            [("Adwoa", "order-assign-dispatch"), ("Adwoa", "shift.planned"), ("Kofi", "delivery-pickup")],
        )

    def test_super_admin_sees_everything(self):
        self.assertEqual(len(self.verbs_for(self.boss)), 9)

    def test_filters(self):
        self.assertEqual(self.verbs_for(self.boss, "?verb=scout."), [("Efua", "scout.checked_in"), ("Kwame", "scout.checked_in")])
        self.assertEqual(self.verbs_for(self.ops, "?mine=1"), [("Ama", "kyc-approve")])
        self.assertEqual(self.verbs_for(self.boss, "?role=dispatch"), [("Kofi", "delivery-pickup")])

    def test_bad_date_is_a_400(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.boss, 'staff')}")
        self.assertEqual(self.client.get("/api/activity/?since=yesterday").status_code, 400)

    def test_non_staff_is_refused(self):
        customer = Customer.objects.create(full_name="Yaw", phone="0240000001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertEqual(self.client.get("/api/activity/").status_code, 403)
