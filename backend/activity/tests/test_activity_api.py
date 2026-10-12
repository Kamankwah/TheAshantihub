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

    def test_impossible_dates_and_bad_actor_are_400s(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.boss, 'staff')}")
        for query in ("since=2026-02-30", "until=2026-13-01", "actor=abc"):
            self.assertEqual(self.client.get(f"/api/activity/?{query}").status_code, 400, query)

    def test_non_staff_is_refused(self):
        customer = Customer.objects.create(full_name="Yaw", phone="0240000001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertEqual(self.client.get("/api/activity/").status_code, 403)


class ActivityBadInputTests(TestCase):
    def test_unicode_digit_actor_is_400_not_500(self):
        boss = make_staff("super_admin", "boss@example.com")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(boss, 'staff')}")
        self.assertEqual(client.get("/api/activity/?actor=\u00b2").status_code, 400)


class ActivityFiltersExportAndChainTests(ActivityApiTests):
    def test_several_verb_prefixes_filter_together(self):
        rows = self.verbs_for(self.boss, "?verb=kyc,commission.")
        self.assertEqual(sorted(verb for _, verb in rows), ["commission.batch_prepared", "kyc-approve"])

    def test_the_person_list_is_only_who_the_caller_can_see(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.ops, 'staff')}")
        names = {row["name"] for row in self.client.get("/api/activity/people/").json()}
        self.assertIn("Kwame", names)
        self.assertNotIn("Boss", names)
        self.assertIn("Efua", names)  # Operations sees every scout, not only their own team


    def test_the_export_is_the_callers_filtered_view_and_is_itself_recorded(self):
        from activity.models import ActivityEvent

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.ops, 'staff')}")
        response = self.client.get("/api/activity/export/?format=csv&role=scout&actor=" + str(self.scout.pk))
        self.assertEqual(response.status_code, 200)
        text = response.content.decode("utf-8-sig")
        self.assertIn("Kwame", text)
        self.assertNotIn("Efua", text)  # filtered to one person
        self.assertIn("Time,Role,Who,Action,On,Detail", text)
        export_event = ActivityEvent.objects.filter(verb="report.exported").latest("id")
        self.assertEqual(export_event.actor_id, self.ops.pk)
        self.assertEqual(export_event.after["kind"], "staff-activity")

    def test_a_cell_that_starts_like_a_formula_is_escaped(self):
        from activity import services as activity_services

        activity_services.record(self.ops, "=cmd", summary="@SUM(1)")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.ops, 'staff')}")
        text = self.client.get("/api/activity/export/?format=csv").content.decode("utf-8-sig")
        self.assertIn("'=cmd", text)
        self.assertIn("'@SUM(1)", text)

    def test_the_export_can_be_an_excel_file_and_other_formats_are_refused(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.ops, 'staff')}")
        xlsx = self.client.get("/api/activity/export/?format=xlsx")
        self.assertEqual(xlsx.status_code, 200)
        self.assertTrue(xlsx.content.startswith(b"PK"))
        self.assertEqual(self.client.get("/api/activity/export/?format=pdf").status_code, 400)

    def test_chain_status_says_nothing_until_a_check_has_run(self):
        from django.core.management import call_command

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.ops, 'staff')}")
        self.assertEqual(self.client.get("/api/activity/chain-status/").json(), {"checked": False})
        call_command("verify_activity_chain")
        body = self.client.get("/api/activity/chain-status/").json()
        self.assertTrue(body["checked"])
        self.assertTrue(body["ok"])
        self.assertGreaterEqual(body["events"], 9)
