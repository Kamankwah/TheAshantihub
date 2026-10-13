import csv
import io
from datetime import timedelta

from django.utils import timezone

from accounts.models import StaffSession, StaffTwoFactor
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent

from .base import PeopleTestCase

URL = "/api/people/staff/"


class DirectoryTests(PeopleTestCase):
    def test_lists_everyone_by_role_then_name_with_the_columns_the_screen_shows(self):
        self.sign_in()
        rows = self.results(self.client.get(URL))
        self.assertEqual([r["name"] for r in rows], ["Boss", "Ama", "Kojo", "Esi", "Kwame"])
        ama = rows[1]
        self.assertEqual(ama["manager"]["name"], "Boss")
        self.assertEqual(ama["reports"], 2)
        self.assertEqual(ama["status"], "active")
        self.assertEqual(rows[0]["two_step_required"], True)

    def test_only_staff_manage_can_open_it(self):
        self.sign_in(self.ama)
        self.assertEqual(self.client.get(URL).status_code, 403)
        self.assertEqual(self.client.get(URL + "counts/").status_code, 403)

    def test_filters_by_role_manager_status_text_and_two_step(self):
        StaffTwoFactor.objects.create(staff=self.ama, confirmed_at=timezone.now())
        self.kojo.is_suspended = True
        self.kojo.suspension_reason = "Investigation"
        self.kojo.save()
        self.sign_in()
        names = lambda **q: [r["name"] for r in self.results(self.client.get(URL, q))]
        self.assertEqual(names(role="operations"), ["Ama", "Kojo"])
        self.assertEqual(names(manager=self.ama.pk), ["Esi", "Kwame"])
        self.assertEqual(names(status="suspended"), ["Kojo"])
        self.assertEqual(names(q="kwa"), ["Kwame"])
        self.assertEqual(names(two_step="on"), ["Ama"])
        self.assertNotIn("Ama", names(two_step="off"))

    def test_status_chips_split_invited_expired_and_deactivated(self):
        invited = make_staff("scout", "new@example.com", invite_token="t1", invite_expires_at=timezone.now() + timedelta(days=3))
        expired = make_staff("scout", "old@example.com", invite_token="t2", invite_expires_at=timezone.now() - timedelta(days=1))
        gone = make_staff("scout", "gone@example.com", is_active=False)
        self.sign_in()
        counts = self.client.get(URL + "counts/").json()
        self.assertEqual((counts["invited"], counts["invite_expired"], counts["deactivated"], counts["active"]), (1, 1, 1, 5))
        self.assertEqual(counts["all"], 8)
        status = lambda s: [r["name"] for r in self.results(self.client.get(URL, {"status": s}))]
        self.assertEqual(status("invited"), [invited.full_name])
        self.assertEqual(status("invite_expired"), [expired.full_name])
        self.assertEqual(status("deactivated"), [gone.full_name])
        self.assertEqual(self.results(self.client.get(URL, {"status": "invited"}))[0]["two_step"], None)

    def test_last_sign_in_filters(self):
        staff_token(self.ama)  # signs in now
        old = StaffSession.objects.create(staff=self.esi, jti="old", created_at=timezone.now() - timedelta(days=9))
        self.sign_in()
        names = lambda when: {r["name"] for r in self.results(self.client.get(URL, {"last_sign_in": when}))}
        self.assertIn("Ama", names("today"))
        self.assertEqual(names("stale7"), {"Esi"})
        self.assertIn("Kwame", names("never"))
        self.assertNotIn("Ama", names("never"))
        self.assertIsNotNone(old.pk)

    def test_worth_a_look_names_real_facts_only(self):
        self.ama.is_suspended = True
        self.ama.suspension_reason = "Licence expired"
        self.ama.save()
        make_staff("scout", "o@example.com", invite_token="t", invite_expires_at=timezone.now() - timedelta(hours=2))
        self.sign_in()
        kinds = {(i["kind"], i["name"]) for i in self.client.get(URL + "counts/").json()["worth_a_look"]}
        self.assertIn(("suspended", "Ama"), kinds)
        self.assertIn(("invite_expired", "O"), kinds)

    def test_a_new_kind_of_device_today_is_flagged(self):
        yesterday = timezone.now() - timedelta(days=1)
        StaffSession.objects.create(staff=self.kwame, jti="a", device_label="Chrome on Android device", created_at=yesterday)
        StaffSession.objects.create(staff=self.kwame, jti="b", device_label="Safari on iPhone")
        self.sign_in()
        items = self.client.get(URL + "counts/").json()["worth_a_look"]
        self.assertTrue(any(i["kind"] == "new_device" and i["name"] == "Kwame" for i in items))

    def test_counts_by_role_and_the_two_step_line(self):
        StaffTwoFactor.objects.create(staff=self.boss, confirmed_at=timezone.now())
        self.sign_in()
        counts = self.client.get(URL + "counts/").json()
        by_role = {r["role"]: r for r in counts["by_role"]}
        self.assertEqual(by_role["operations"]["active"], 2)
        self.assertEqual(counts["two_step"], {"on": 1, "active": 5})
        self.assertIn("Ama", [m["name"] for m in counts["managers"]])


class DirectoryExportTests(PeopleTestCase):
    def test_export_asks_for_the_password(self):
        self.sign_in()
        response = self.client.get(URL + "export/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "sudo_required")

    def test_export_is_a_csv_recorded_as_personal_data(self):
        self.ama.phone = "0241234567"
        self.ama.save()
        self.sign_in(sudo=True)
        response = self.client.get(URL + "export/", {"role": "operations"})
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(b"".join(response.streaming_content).decode("utf-8-sig"))))
        self.assertEqual(rows[0][0:3], ["Name", "Email", "Phone"])
        self.assertEqual({r[0] for r in rows[1:]}, {"Ama", "Kojo"})
        self.assertIn("0241234567", rows[1] + rows[2])
        event = ActivityEvent.objects.filter(verb="report.exported").latest("id")
        self.assertTrue(event.after["personal_data"])
        self.assertEqual(event.after["rows"], 2)
        self.assertEqual(event.after["filters"], {"role": "operations"})
