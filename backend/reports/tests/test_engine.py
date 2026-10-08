import threading
from datetime import date, datetime, time, timedelta

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from accounts.testing import make_staff
from activity import services as activity
from calls.models import CallLog
from notifications.models import Notification
from reports import providers, services
from reports.models import StaffReport
from reports.tasks import send_day_report_reminders
from staff_tasks.models import Task
from staff_tasks.services import create_task

NARRATIVE = "Visited three weavers in Bonwire; one wants to register on Wednesday. Network was poor."
PLAN = ["Register Bonwire Kente Looms"]


def at(day, hour, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


class PeriodTests(TestCase):
    def test_periods_are_a_day_a_monday_to_sunday_week_and_a_calendar_month(self):
        wednesday = date(2026, 10, 7)
        self.assertEqual(services.period_bounds("day", wednesday), (wednesday, wednesday))
        self.assertEqual(services.period_bounds("week", wednesday), (date(2026, 10, 5), date(2026, 10, 11)))
        self.assertEqual(services.period_bounds("month", wednesday), (date(2026, 10, 1), date(2026, 10, 31)))


class WorkflowTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.today = timezone.localdate()

    def draft(self, day=None, **data):
        return services.save_draft(
            self.scout, "day", day or self.today, {"achievements": NARRATIVE, "plan_next": PLAN, **data}
        )

    def test_a_new_day_report_carries_yesterdays_plan_to_mark(self):
        yesterday = self.today - timedelta(days=1)
        old = services.save_draft(self.scout, "day", yesterday, {"achievements": "x" * 50, "plan_next": ["Visit Ejisu", "Call Adwoa Fabrics"]})
        services.submit(old, now=at(yesterday, 18))
        report = services.build(self.scout, "day", self.today)
        self.assertIsNone(report.pk)
        self.assertEqual(report.plan_results, [{"item": "Visit Ejisu", "result": ""}, {"item": "Call Adwoa Fabrics", "result": ""}])

    def test_reports_for_days_that_have_not_started_are_refused(self):
        with self.assertRaises(services.FuturePeriod):
            self.draft(day=self.today + timedelta(days=1))

    def test_submitting_locks_the_report_and_freezes_the_system_numbers(self):
        activity.record(self.scout, "scout.checked_in")
        report = self.draft()
        services.submit(report, now=at(self.today, 18))
        report.refresh_from_db()
        self.assertEqual((report.status, report.is_late), ("submitted", False))
        self.assertEqual(report.system_snapshot[0]["rows"][0], {"label": "Actions recorded", "value": 1})
        with self.assertRaises(services.NotEditable):
            services.save_draft(self.scout, "day", self.today, {"achievements": "changed"})
        self.assertTrue(Notification.objects.filter(staff=self.lead, kind="report_submitted").exists())

    def test_after_the_due_time_it_is_late(self):
        report = self.draft()
        services.submit(report, now=at(self.today, 19, 30))
        self.assertTrue(report.is_late)

    def test_an_empty_report_cannot_be_submitted(self):
        report = services.save_draft(self.scout, "day", self.today, {})
        with self.assertRaises(services.ReportError):
            services.submit(report, now=at(self.today, 18))

    def test_the_manager_returns_it_and_then_acknowledges_the_resubmission(self):
        report = self.draft()
        services.submit(report, now=at(self.today, 18))
        with self.assertRaises(services.NoteRequired):
            services.return_report(report, self.lead, note="")
        services.return_report(report, self.lead, note="Which weavers?")
        report.refresh_from_db()
        self.assertEqual((report.status, report.reviewer, report.review_note), ("returned", self.lead, "Which weavers?"))
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_returned").exists())
        services.save_draft(self.scout, "day", self.today, {"achievements": NARRATIVE + " Akwasi and Yaa Weaving."})
        report.refresh_from_db()
        services.submit(report, now=at(self.today, 18, 30))
        services.acknowledge(report, self.lead)
        report.refresh_from_db()
        self.assertEqual(report.status, "acknowledged")
        self.assertIn("Akwasi", report.achievements)
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_acknowledged").exists())

    def test_only_the_manager_or_a_super_admin_reviews(self):
        other_lead = make_staff("operations", "kojo@example.com")
        boss = make_staff("super_admin", "boss@example.com")
        report = self.draft()
        services.submit(report, now=at(self.today, 18))
        with self.assertRaises(services.NotReviewable):
            services.acknowledge(report, other_lead)
        with self.assertRaises(services.NotReviewable):
            services.acknowledge(report, self.scout)
        services.acknowledge(report, boss)
        report.refresh_from_db()
        self.assertEqual((report.status, report.reviewer), (StaffReport.ACKNOWLEDGED, boss))

    def test_a_copied_narrative_is_flagged(self):
        self.draft(day=self.today - timedelta(days=1))
        self.assertGreaterEqual(self.draft().similarity, services.SIMILARITY_FLAG)

    def test_fresh_or_very_short_narratives_are_not_flagged(self):
        self.draft(day=self.today - timedelta(days=1))
        fresh = services.save_draft(self.scout, "day", self.today, {
            "achievements": "Registered Kejetia Beads & Crafts after checking the owner's Ghana Card and pinning the stall."
        })
        self.assertLess(fresh.similarity, services.SIMILARITY_FLAG)
        short = services.save_draft(self.scout, "week", self.today, {"achievements": "Good week."})
        self.assertEqual(short.similarity, 0.0)


class ProviderTests(TestCase):
    def setUp(self):
        self.scout = make_staff("scout", "kwame@example.com")
        self.today = timezone.localdate()

    def call(self, when):
        return CallLog.objects.create(
            staff=self.scout, direction="out", counterpart_type="business_owner", purpose="other",
            outcome="connected", started_at=when,
        )

    def test_the_generic_provider_counts_this_staffers_work(self):
        other = make_staff("scout", "efua@example.com")
        activity.record(self.scout, "call-list")
        activity.record(self.scout, "call-list")
        activity.record(other, "call-list")
        self.call(timezone.now())
        done = create_task(self.scout, "Call back Adwoa", timezone.now() + timedelta(hours=1))
        Task.objects.filter(pk=done.pk).update(status=Task.DONE, done_at=timezone.now())
        create_task(self.scout, "Old follow-up", timezone.now() - timedelta(hours=2))
        sections = {
            s["key"]: {row["label"]: row["value"] for row in s["rows"]}
            for s in providers.system_sections(self.scout, self.today, self.today)
        }
        self.assertEqual(sections["activity"], {"Actions recorded": 2, "call-list": 2})
        self.assertEqual(sections["calls"], {"Calls logged": 1, "Connected": 1})
        self.assertEqual(sections["tasks"], {"Done": 1, "Overdue and still open": 1})
        self.assertEqual(sections["approvals"], {"Requests made": 0, "Approved by you": 0, "Returned by you": 0})

    def test_a_week_adds_up_its_days(self):
        monday = self.today - timedelta(days=self.today.weekday() + 7)
        self.call(at(monday, 9))
        self.call(at(monday + timedelta(days=2), 9))

        def calls(start, end):
            section = next(s for s in providers.system_sections(self.scout, start, end) if s["key"] == "calls")
            return section["rows"][0]["value"]

        self.assertEqual(calls(monday, monday), 1)
        self.assertEqual(calls(monday, monday + timedelta(days=6)), 2)

    def test_role_providers_add_their_own_sections(self):
        def scout_numbers(staff, start, end):
            return [{"key": "visits", "title": "Visits", "rows": [{"label": "Check-ins", "value": 0}]}]

        providers.register_provider("scout", scout_numbers)
        self.addCleanup(providers.unregister_provider, "scout", scout_numbers)
        keys = [s["key"] for s in providers.system_sections(self.scout, self.today, self.today)]
        self.assertEqual(keys, ["activity", "approvals", "calls", "tasks", "visits"])
        lead = make_staff("operations", "ama@example.com")
        self.assertNotIn("visits", [s["key"] for s in providers.system_sections(lead, self.today, self.today)])


class ReminderTests(TestCase):
    def test_reminders_go_to_active_staff_without_a_submitted_day_report(self):
        today = timezone.localdate()
        make_staff("operations", "ama@example.com")
        done = make_staff("scout", "kwame@example.com")
        make_staff("super_admin", "boss@example.com")
        make_staff("support", "esi@example.com", is_suspended=True)
        make_staff("scout", "new@example.com", invite_token="t" * 43)
        report = services.save_draft(done, "day", today, {"achievements": NARRATIVE})
        services.submit(report, now=at(today, 17))
        send_day_report_reminders()
        recipients = set(Notification.objects.filter(kind="report_reminder").values_list("staff__email", flat=True))
        self.assertEqual(recipients, {"ama@example.com"})
        self.assertEqual(Notification.objects.get(kind="report_reminder").title, "Your day report is due at 19:00")


class FixRoundTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.today = timezone.localdate()

    def test_a_stale_autosave_cannot_unsubmit_a_report(self):
        stale = services.save_draft(self.scout, "day", self.today, {"achievements": NARRATIVE})
        services.submit(StaffReport.objects.get(pk=stale.pk), now=at(self.today, 18))
        with self.assertRaises(services.NotEditable):
            services.save_draft(self.scout, "day", self.today, {"achievements": "late edit"})
        report = StaffReport.objects.get(pk=stale.pk)
        self.assertEqual(report.status, StaffReport.SUBMITTED)
        self.assertIsNotNone(report.system_snapshot)
        # a caller holding an out-of-date instance is refused at submit/review too
        with self.assertRaises(services.NotEditable):
            services.submit(stale, now=at(self.today, 18, 5))

    def test_resubmission_keeps_the_first_submission_time_and_lateness(self):
        report = services.save_draft(self.scout, "day", self.today, {"achievements": NARRATIVE})
        services.submit(report, now=at(self.today, 18))
        services.return_report(report, self.lead, note="More detail")
        report.refresh_from_db()
        services.submit(report, now=at(self.today, 19, 5))
        report.refresh_from_db()
        self.assertFalse(report.is_late)
        self.assertEqual(report.submitted_at, at(self.today, 18))

    def test_a_week_is_compared_with_earlier_weeks_not_with_days(self):
        last_monday = self.today - timedelta(days=self.today.weekday() + 7)
        services.save_draft(self.scout, "week", last_monday, {"achievements": NARRATIVE})
        services.save_draft(self.scout, "day", self.today - timedelta(days=1), {"achievements": "Different day text about beads and stalls in Kejetia market."})
        self.assertGreaterEqual(
            services.save_draft(self.scout, "week", self.today, {"achievements": NARRATIVE}).similarity,
            services.SIMILARITY_FLAG,
        )

    def test_a_week_restating_its_own_day_is_not_flagged(self):
        services.save_draft(self.scout, "day", self.today, {"achievements": NARRATIVE})
        week = services.save_draft(self.scout, "week", self.today, {"achievements": NARRATIVE})
        self.assertEqual(week.similarity, 0.0)

    def test_a_week_draft_keyed_by_a_later_day_in_the_current_week_is_accepted(self):
        later = self.today + timedelta(days=1)
        if later.weekday() == 0:
            self.skipTest("tomorrow starts a new week")
        report = services.save_draft(self.scout, "week", later, {"achievements": NARRATIVE})
        self.assertEqual(report.period_start, self.today - timedelta(days=self.today.weekday()))

    def test_review_note_is_capped_and_plan_results_are_limited(self):
        report = services.save_draft(self.scout, "day", self.today, {"achievements": NARRATIVE})
        services.submit(report, now=at(self.today, 18))
        with self.assertRaises(services.ReportError):
            services.acknowledge(report, self.lead, note="x" * 2001)
        with self.assertRaises(services.ReportError):
            services.save_draft(self.scout, "week", self.today, {"plan_results": [{"item": "a", "result": ""}] * 21})

    def test_reminders_are_sent_once_a_day(self):
        send_day_report_reminders()
        send_day_report_reminders()
        self.assertEqual(Notification.objects.filter(kind="report_reminder", staff=self.scout).count(), 1)
        self.assertEqual(Notification.objects.filter(kind="report_reminder", staff=self.lead).count(), 1)

    def test_an_inactive_staffer_gets_no_reminder(self):
        make_staff("support", "gone@example.com", is_active=False)
        send_day_report_reminders()
        self.assertFalse(Notification.objects.filter(kind="report_reminder", staff__email="gone@example.com").exists())

    def test_visibility_and_review_rights(self):
        other_lead = make_staff("operations", "kojo@example.com")
        boss = make_staff("super_admin", "boss@example.com")
        draft = services.save_draft(self.scout, "day", self.today - timedelta(days=1), {"achievements": NARRATIVE})
        sent = services.save_draft(self.scout, "day", self.today, {"achievements": NARRATIVE})
        services.submit(sent, now=at(self.today, 18))
        self.assertEqual(set(services.visible_reports(self.scout)), {draft, sent})
        self.assertEqual(set(services.visible_reports(self.lead)), {sent})
        self.assertEqual(set(services.visible_reports(boss)), {sent})
        self.assertEqual(set(services.visible_reports(other_lead)), set())
        self.assertTrue(services.can_review(sent, self.lead))
        self.assertTrue(services.can_review(sent, boss))
        self.assertFalse(services.can_review(sent, other_lead))
        self.assertFalse(services.can_review(sent, self.scout))


class ConcurrentReviewTests(TransactionTestCase):
    serialized_rollback = True

    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.today = timezone.localdate()
        report = services.save_draft(self.scout, "day", self.today, {"achievements": NARRATIVE})
        self.pk = report.pk

    def race(self, *jobs):
        results = []
        barrier = threading.Barrier(len(jobs))

        def run(job):
            try:
                barrier.wait()
                job(StaffReport.objects.get(pk=self.pk))
                results.append("ok")
            except services.ReportError:
                results.append("refused")
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(job,)) for job in jobs]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)
            self.assertFalse(t.is_alive(), "a racing thread hung")
        return sorted(results)

    def test_acknowledge_and_return_at_once_decide_exactly_once(self):
        services.submit(StaffReport.objects.get(pk=self.pk), now=at(self.today, 18))
        results = self.race(
            lambda r: services.acknowledge(r, self.lead),
            lambda r: services.return_report(r, self.boss, note="Redo"),
        )
        self.assertEqual(results, ["ok", "refused"])
        self.assertEqual(
            Notification.objects.filter(staff=self.scout, kind__in=["report_acknowledged", "report_returned"]).count(), 1
        )
        from activity.models import ActivityEvent
        self.assertEqual(ActivityEvent.objects.filter(verb__in=["report.acknowledged", "report.returned"]).count(), 1)

    def test_a_double_submit_records_one_event_and_one_notification(self):
        results = self.race(
            lambda r: services.submit(r, now=at(self.today, 18)),
            lambda r: services.submit(r, now=at(self.today, 18)),
        )
        self.assertEqual(results, ["ok", "refused"])
        from activity.models import ActivityEvent
        self.assertEqual(ActivityEvent.objects.filter(verb="report.submitted").count(), 1)
        self.assertEqual(Notification.objects.filter(staff=self.lead, kind="report_submitted").count(), 1)
