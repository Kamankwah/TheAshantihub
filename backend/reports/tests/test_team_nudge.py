from datetime import date, datetime, time, timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from notifications.models import Notification
from reports.models import StaffReport
from targets.models import Leave

TODAY = date(2026, 10, 7)  # Wednesday


def at(day, hour):
    return timezone.make_aware(datetime.combine(day, time(hour)))


class MissingAndRemindTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.yaw = make_staff("scout", "yaw@example.com", manager=self.lead)
        self.kofi = make_staff("scout", "kofi@example.com", manager=self.lead)
        self.stranger = make_staff("scout", "kwaku@example.com", manager=make_staff("operations", "kojo@example.com"))
        for patch in (
            mock.patch("django.utils.timezone.localdate", return_value=TODAY),
            mock.patch("django.utils.timezone.now", return_value=at(TODAY, 11)),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        StaffUser = type(self.yaw)
        StaffUser.objects.filter(pk__in=[self.yaw.pk, self.kofi.pk, self.stranger.pk]).update(created_at=at(date(2026, 9, 1), 9))

    def as_user(self, who):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who)}")

    def missing(self, who=None, **params):
        self.as_user(who or self.lead)
        return self.client.get("/api/reports/team/missing/", params)

    def test_lists_working_days_with_no_report_for_my_direct_reports_only(self):
        response = self.missing(**{"from": "2026-10-02", "to": "2026-10-06"})
        self.assertEqual(response.status_code, 200)
        pairs = {(r["staff"]["full_name"], r["date"]) for r in response.json()["rows"]}
        # Fri 2, Sat 3, Mon 5, Tue 6 are Mon-Sat working days; Sun 4 is off.
        self.assertIn(("Yaw", "2026-10-02"), pairs)
        self.assertIn(("Yaw", "2026-10-03"), pairs)
        self.assertNotIn(("Yaw", "2026-10-04"), pairs)
        self.assertFalse(any(name == "Kwaku" for name, _ in pairs))
        self.assertEqual(len(pairs), 8)

    def test_submitted_days_leave_and_today_are_not_missing(self):
        StaffReport.objects.create(staff=self.yaw, period="day", period_start=date(2026, 10, 6), period_end=date(2026, 10, 6), status="submitted")
        StaffReport.objects.create(staff=self.yaw, period="day", period_start=date(2026, 10, 5), period_end=date(2026, 10, 5), status="draft")
        Leave.objects.create(staff=self.kofi, start=date(2026, 10, 5), end=date(2026, 10, 6), kind="annual", recorded_by=self.lead)
        pairs = {(r["staff"]["full_name"], r["date"]) for r in self.missing(**{"from": "2026-10-05", "to": "2026-10-07"}).json()["rows"]}
        self.assertEqual(pairs, {("Yaw", "2026-10-05")})  # a draft is not submitted; today is not yet due

    def test_a_stretch_longer_than_a_month_is_refused(self):
        self.assertEqual(self.missing(**{"from": "2026-08-01", "to": "2026-10-06"}).status_code, 400)

    def test_remind_sends_one_notification_and_one_activity_event(self):
        self.as_user(self.lead)
        response = self.client.post("/api/reports/team/remind/", {"staff": self.yaw.pk, "date": "2026-10-06"}, format="json")
        self.assertEqual(response.status_code, 200)
        note = Notification.objects.get(staff=self.yaw, kind="report_nudge")
        self.assertIn("Tuesday 6 October", note.title)
        self.assertEqual(ActivityEvent.objects.filter(verb="report.reminded").count(), 1)
        # Once a day for the same day.
        again = self.client.post("/api/reports/team/remind/", {"staff": self.yaw.pk, "date": "2026-10-06"}, format="json")
        self.assertEqual(again.status_code, 409)
        self.assertEqual(Notification.objects.filter(kind="report_nudge").count(), 1)
        rows = {r["staff"]["full_name"]: r for r in self.missing(**{"from": "2026-10-06", "to": "2026-10-06"}).json()["rows"]}
        self.assertTrue(rows["Yaw"]["reminded_today"])
        self.assertFalse(rows["Kofi"]["reminded_today"])

    def test_cannot_remind_someone_elses_report_or_a_day_that_isnt_missing(self):
        self.as_user(self.lead)
        self.assertEqual(self.client.post("/api/reports/team/remind/", {"staff": self.stranger.pk, "date": "2026-10-06"}, format="json").status_code, 404)
        self.assertEqual(self.client.post("/api/reports/team/remind/", {"staff": self.yaw.pk, "date": "2026-10-04"}, format="json").status_code, 409)  # a Sunday
        self.assertEqual(self.client.post("/api/reports/team/remind/", {"staff": self.yaw.pk, "date": "2026-10-07"}, format="json").status_code, 409)  # today
        self.assertEqual(self.client.post("/api/reports/team/remind/", {"staff": "x", "date": "2026-10-06"}, format="json").status_code, 400)
        self.assertFalse(Notification.objects.filter(kind="report_nudge").exists())
        self.as_user(self.yaw)
        self.assertEqual(self.client.post("/api/reports/team/remind/", {"staff": self.kofi.pk, "date": "2026-10-06"}, format="json").status_code, 404)
