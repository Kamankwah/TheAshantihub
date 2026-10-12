"""Operations' Targets (07) and Leave (08) screens: the five leave kinds, editing
upcoming leave, working-day counts, the preview, pending cuts and history."""
from datetime import date

from activity.models import ActivityEvent
from approvals import services as approval_services
from approvals.services import ApprovalError
from targets import services
from targets.models import Leave, PublicHoliday, TargetPlan, WorkPattern

from .base import SAT, WED, TargetsBase

PLANS = "/api/targets/plans/"
LEAVE = "/api/targets/leave/"


class LeaveKindTests(TargetsBase):
    def post(self, who, **body):
        self.as_staff(who)
        return self.client.post(LEAVE, {"staff": self.kwame.pk, "start": "2026-10-30", "end": "2026-10-31", **body}, format="json")

    def test_all_five_kinds_can_be_recorded(self):
        for kind in ("annual", "sick", "compassionate", "parental", "unpaid"):
            response = self.post(self.lead, kind=kind)
            self.assertEqual(response.status_code, 201, (kind, response.content))
            self.assertEqual(response.data["kind"], kind)
        self.assertEqual(self.client.get(LEAVE).data[0]["kind_label"] in {"Annual leave", "Sick leave", "Compassionate leave", "Maternity or paternity leave", "Unpaid leave"}, True)

    def test_other_is_no_longer_offered_but_old_rows_stay_valid(self):
        self.assertEqual(self.post(self.lead, kind="other").status_code, 400)
        old = Leave.objects.create(staff=self.kwame, start=SAT, end=SAT, kind="other", recorded_by=self.lead)
        self.as_staff(self.lead)
        rows = self.client.get(LEAVE).data
        self.assertEqual([r["kind_label"] for r in rows], ["Other leave"])
        # an old row can still be edited without being forced onto a new kind
        changed = self.client.patch(f"{LEAVE}{old.pk}/", {"note": "Family"}, format="json")
        self.assertEqual((changed.status_code, changed.data["kind"]), (200, "other"))
        self.assertEqual(self.client.patch(f"{LEAVE}{old.pk}/", {"kind": "holiday"}, format="json").status_code, 400)

    def test_rows_carry_status_working_days_and_who_recorded_them(self):
        Leave.objects.create(staff=self.kwame, start=date(2026, 10, 4), end=date(2026, 10, 8), recorded_by=self.lead)  # now
        Leave.objects.create(staff=self.efua, start=date(2026, 10, 20), end=date(2026, 10, 24), recorded_by=self.lead)  # upcoming
        Leave.objects.create(staff=self.efua, start=date(2026, 10, 1), end=date(2026, 10, 1), kind="sick", recorded_by=self.lead)  # taken
        PublicHoliday.objects.create(date=date(2026, 10, 6), name="Observed")
        self.as_staff(self.lead)
        rows = {r["staff_name"] + r["start"].isoformat(): r for r in self.client.get(LEAVE).data}
        now = rows["Kwame2026-10-04"]
        self.assertEqual((now["status"], now["can_change"], now["recorded_by"]), ("on_leave", True, "Ama"))
        self.assertEqual(now["working_days"], 3)  # Sun 4 is off and Tue 6 is a holiday: Mon 5, Wed 7, Thu 8
        self.assertEqual(rows["Efua2026-10-20"]["status"], "upcoming")
        self.assertEqual(rows["Efua2026-10-01"]["status"], "taken")
        self.assertFalse(rows["Efua2026-10-01"]["can_change"])

    def test_month_window_filter(self):
        Leave.objects.create(staff=self.kwame, start=date(2026, 11, 3), end=date(2026, 11, 4), recorded_by=self.lead)
        self.as_staff(self.lead)
        self.assertEqual(len(self.client.get(LEAVE, {"from": "2026-10-01", "to": "2026-10-31"}).data), 0)
        self.assertEqual(len(self.client.get(LEAVE, {"from": "2026-11-01", "to": "2026-11-30"}).data), 1)

    def test_support_default_is_monday_to_friday(self):
        from accounts.testing import make_staff

        esi = make_staff("support", "esi@example.com", manager=self.lead)
        self.as_staff(self.lead)
        pattern = self.client.get(f"/api/targets/work-pattern/{esi.pk}/").data
        self.assertEqual(pattern["weekdays"], [0, 1, 2, 3, 4])
        preview = self.client.get(f"{LEAVE}preview/", {"staff": esi.pk, "start": "2026-10-05", "end": "2026-10-11"})
        self.assertEqual(preview.data["working_days"], 5)
        self.assertEqual(self.client.get(f"{LEAVE}preview/", {"staff": self.kwame.pk, "start": "2026-10-05", "end": "2026-10-11"}).data["working_days"], 6)

    def test_preview_is_scoped_and_validated(self):
        self.as_staff(self.lead)
        self.assertEqual(self.client.get(f"{LEAVE}preview/", {"staff": self.outsider.pk, "start": "2026-10-05", "end": "2026-10-06"}).status_code, 403)
        self.assertEqual(self.client.get(f"{LEAVE}preview/", {"staff": self.kwame.pk, "start": "2026-10-06", "end": "2026-10-05"}).status_code, 400)


class ChangeLeaveTests(TargetsBase):
    def setUp(self):
        super().setUp()
        self.upcoming = Leave.objects.create(staff=self.kwame, start=date(2026, 10, 20), end=date(2026, 10, 22), recorded_by=self.lead)
        self.now = Leave.objects.create(staff=self.efua, start=date(2026, 10, 5), end=date(2026, 10, 9), recorded_by=self.lead)
        self.past = Leave.objects.create(staff=self.kwame, start=date(2026, 10, 1), end=date(2026, 10, 1), recorded_by=self.lead)
        self.as_staff(self.lead)

    def patch(self, leave, **body):
        return self.client.patch(f"{LEAVE}{leave.pk}/", body, format="json")

    def test_upcoming_leave_can_be_changed_and_it_is_recorded(self):
        response = self.patch(self.upcoming, kind="sick", end="2026-10-23", note="Extended")
        self.assertEqual(response.status_code, 200, response.content)
        self.upcoming.refresh_from_db()
        self.assertEqual((self.upcoming.kind, self.upcoming.end), ("sick", date(2026, 10, 23)))
        event = ActivityEvent.objects.get(verb="leave.updated")
        self.assertEqual(event.before["end"], "2026-10-22")
        self.assertEqual(event.after["end"], "2026-10-23")

    def test_leave_in_progress_keeps_its_first_day(self):
        self.assertEqual(self.patch(self.now, start="2026-10-06").status_code, 400)
        self.assertEqual(self.patch(self.now, end="2026-10-10").status_code, 200)

    def test_leave_in_progress_cannot_be_ended_in_the_past_or_started_earlier(self):
        self.assertEqual(self.patch(self.now, end="2026-10-06").status_code, 400)  # before today (Wed 7th)
        self.assertEqual(self.patch(self.now, start="2026-10-01").status_code, 400)
        self.now.refresh_from_db()
        self.assertEqual((self.now.start, self.now.end), (date(2026, 10, 5), date(2026, 10, 9)))
        self.assertEqual(self.patch(self.now, end="2026-10-07").status_code, 200)  # shortened to today

    def test_a_new_first_day_cannot_be_in_the_past(self):
        self.assertEqual(self.patch(self.upcoming, start="2026-10-06").status_code, 400)
        self.assertEqual(self.patch(self.upcoming, start="2026-10-21").status_code, 200)

    def test_leave_already_taken_cannot_be_changed_or_cancelled(self):
        self.assertEqual(self.patch(self.past, kind="sick").status_code, 400)
        self.assertEqual(self.client.delete(f"{LEAVE}{self.past.pk}/").status_code, 400)
        self.assertTrue(Leave.objects.filter(pk=self.past.pk).exists())

    def test_cancelling_upcoming_leave_is_recorded(self):
        self.assertEqual(self.client.delete(f"{LEAVE}{self.upcoming.pk}/").status_code, 204)
        self.assertTrue(ActivityEvent.objects.filter(verb="leave.removed").exists())

    def test_bad_dates_and_other_teams_are_refused(self):
        self.assertEqual(self.patch(self.upcoming, end="2026-10-10").status_code, 400)
        theirs = Leave.objects.create(staff=self.outsider, start=date(2026, 10, 20), end=date(2026, 10, 21), recorded_by=self.other_lead)
        self.assertEqual(self.patch(theirs, kind="sick").status_code, 403)
        self.as_staff(self.kwame)
        self.assertEqual(self.patch(self.upcoming, kind="sick").status_code, 403)

    def test_leave_zeroes_that_days_target(self):
        self.plan(self.kwame, "calls", 10)
        from targets import services

        self.assertEqual(services.daily_target(self.kwame, "calls", date(2026, 10, 21)), 0)
        self.assertEqual(services.daily_target(self.kwame, "calls", date(2026, 10, 23)), 10)


class TargetsScreenTests(TargetsBase):
    def put(self, who, **body):
        self.as_staff(who)
        return self.client.put(PLANS, body, format="json")

    def test_listing_shows_state_areas_and_a_pending_cut(self):
        self.plan(self.kwame, "calls", 10)
        Leave.objects.create(staff=self.efua, start=date(2026, 10, 5), end=date(2026, 10, 9), recorded_by=self.lead)
        self.put(self.lead, staff=self.kwame.pk, values={"calls": 5})
        rows = {s["full_name"]: s for s in self.client.get(PLANS).data["staff"]}
        self.assertEqual(rows["Efua"]["state"], "leave")
        self.assertEqual(rows["Kwame"]["state"], "working")
        cut = rows["Kwame"]["pending_cut"]
        self.assertEqual(cut["metrics"], {"calls": 5})
        self.assertIsNone(rows["Efua"]["pending_cut"])
        self.assertEqual(rows["Kwame"]["daily"]["calls"], 10)  # 10 a day stays until approved

    def test_the_pending_flag_clears_once_decided(self):
        self.plan(self.kwame, "calls", 10)
        pending = self.put(self.lead, staff=self.kwame.pk, values={"calls": 5}).data["pending_approval"]
        approval_services.approve(pending["id"], self.admin)
        rows = {s["full_name"]: s for s in self.client.get(PLANS).data["staff"]}
        self.assertIsNone(rows["Kwame"]["pending_cut"])
        self.assertEqual(rows["Kwame"]["daily"]["calls"], 5)

    def test_the_maker_cannot_approve_their_own_cut(self):
        self.plan(self.kwame, "calls", 10)
        pending = self.put(self.lead, staff=self.kwame.pk, values={"calls": 5}).data["pending_approval"]
        with self.assertRaises(ApprovalError):
            approval_services.approve(pending["id"], self.lead)
        self.assertEqual(TargetPlan.objects.filter(staff=self.kwame, metric="calls").count(), 1)

    def preview(self, changes, **extra):
        self.as_staff(self.lead)
        return self.client.post(f"{PLANS}preview/", {"changes": changes, **extra}, format="json")

    def test_preview_shows_week_and_month_before_and_after(self):
        self.plan_all(self.kwame, registrations=3, calls=10)
        response = self.preview([{"staff": self.kwame.pk, "values": {"registrations": 2, "calls": 12}}], effective_from="2026-10-08")
        self.assertEqual(response.status_code, 200, response.content)
        row = response.data["rows"][0]
        # week Mon 5 - Sun 11: Mon-Sat working; 3 days before the 8th at 3, then Thu-Sat (3 days) at 2
        self.assertEqual(row["week"]["registrations"], [18, 3 * 3 + 3 * 2])
        self.assertEqual(row["week"]["calls"], [60, 3 * 10 + 3 * 12])
        self.assertEqual(row["month"]["registrations"][0], 27 * 3)
        self.assertEqual(row["month"]["visits"], [0, 0])  # untouched measure
        self.assertEqual(row["cuts"], ["registrations"])  # lowers the month after the 1st
        self.assertEqual(row["month_working_days"], 27)
        self.assertFalse(TargetPlan.objects.filter(staff=self.kwame, daily_value=12).exists())  # preview writes nothing

    def test_preview_keeps_leave_and_holidays_at_zero(self):
        self.plan(self.kwame, "calls", 10)
        Leave.objects.create(staff=self.kwame, start=date(2026, 10, 9), end=date(2026, 10, 10), recorded_by=self.lead)
        row = self.preview([{"staff": self.kwame.pk, "values": {"calls": 20}}], effective_from="2026-10-08").data["rows"][0]
        self.assertEqual(row["week"]["calls"], [40, 3 * 10 + 20])  # Mon-Wed at 10, Thu at 20; Fri and Sat are leave

    def test_preview_is_scoped_and_validated(self):
        self.assertEqual(self.preview([{"staff": self.outsider.pk, "values": {"calls": 5}}]).status_code, 403)
        self.assertEqual(self.preview([{"staff": self.kwame.pk, "values": {"nonsense": 5}}]).status_code, 400)
        self.assertEqual(self.preview([]).status_code, 400)
        self.as_staff(self.kwame)
        self.assertEqual(self.client.post(f"{PLANS}preview/", {"changes": [{"staff": self.kwame.pk, "values": {"calls": 5}}]}, format="json").status_code, 403)

    def test_history_lists_set_cut_and_limit_events_for_the_team_only(self):
        from targets.models import TargetLimit

        self.plan(self.kwame, "calls", 10)
        self.put(self.lead, staff=self.kwame.pk, values={"calls": 12})
        pending = self.put(self.lead, staff=self.kwame.pk, values={"calls": 4}).data["pending_approval"]
        approval_services.approve(pending["id"], self.admin)
        self.put(self.other_lead, staff=self.outsider.pk, values={"calls": 6})
        self.as_staff(self.admin)
        TargetLimit.objects.create(metric="visits", min_daily=4, max_daily=12, set_by=self.admin)
        self.client.put("/api/targets/limits/", {"limits": [{"metric": "visits", "min_daily": 4, "max_daily": 12}]}, format="json")
        self.as_staff(self.lead)
        events = self.client.get("/api/targets/history/").data
        verbs = [e["verb"] for e in events]
        self.assertEqual(sorted(verbs), ["targets.cut_applied", "targets.limits_set", "targets.plan_set"])
        raised = next(e for e in events if e["verb"] == "targets.plan_set")
        self.assertEqual((raised["staff_name"], raised["before"], raised["after"]["values"]), ("Kwame", {"calls": 10}, {"calls": 12}))
        self.assertTrue(raised["by_me"])
        self.assertFalse(any(e.get("staff_name") == "Outsider" for e in events))
        self.as_staff(self.kwame)
        self.assertEqual(self.client.get("/api/targets/history/").status_code, 403)


class SupportDefaultMigrationTests(TargetsBase):
    def test_existing_support_staff_keep_monday_to_saturday_and_new_ones_get_monday_to_friday(self):
        import importlib

        from django.apps import apps

        from accounts.testing import make_staff

        old = make_staff("support", "old@example.com", manager=self.lead)
        saved = make_staff("support", "saved@example.com", manager=self.lead)
        WorkPattern.objects.create(staff=saved, weekdays=[1, 2], set_by=self.lead)
        importlib.import_module("targets.migrations.0003_support_keeps_monday_to_saturday").keep_monday_to_saturday(apps, None)
        self.assertEqual(WorkPattern.objects.get(staff=old).weekdays, [0, 1, 2, 3, 4, 5])
        self.assertEqual(WorkPattern.objects.get(staff=saved).weekdays, [1, 2])
        self.assertFalse(WorkPattern.objects.filter(staff=self.kwame).exists())  # scouts keep the code default
        new = make_staff("support", "new@example.com", manager=self.lead)
        self.assertFalse(services.is_working_day(new, SAT))
        self.assertTrue(services.is_working_day(old, SAT))
