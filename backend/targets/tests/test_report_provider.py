from datetime import date
from decimal import Decimal

from accounts.models import BusinessOwner
from approvals.models import ApprovalRequest
from calls.models import CallLog
from commission.models import CommissionAccrual, CommissionPolicy
from field.models import VisitCheckIn
from portfolio.tests.health_fixtures import make_business
from reports import providers, services as report_services
from reports.models import StaffReport
from staff_tasks.models import Task
from targets import services

from .base import MON, SUN, WED, TargetsBase, at


class ScoutReportProviderTests(TargetsBase):
    def sections(self, staff=None, start=WED, end=WED):
        return {s["key"]: s for s in providers.system_sections(staff or self.kwame, start, end)}

    def visit(self, day, outside=False, status=VisitCheckIn.DONE):
        return VisitCheckIn.objects.create(
            scout=self.kwame, purpose="prospecting", status=status, checked_in_at=at(day), lat=6.6885, lng=-1.6244,
            accuracy_m=10, outside_radius=outside,
        )

    def call(self, day, outcome="connected"):
        return CallLog.objects.create(
            staff=self.kwame, direction="out", counterpart_type="other", purpose="other", outcome=outcome, started_at=at(day),
        )

    def test_the_four_measures_equal_the_targets_service_for_the_same_days(self):
        self.plan_all(self.kwame, registrations=1, visits=6, calls=10, renewals=1)
        self.visit(WED)
        self.visit(WED, outside=True)
        self.call(WED)
        rows = {r["label"]: r for r in self.sections()["targets"]["rows"]}
        for metric in ("registrations", "visits", "calls", "renewals"):
            row = rows[services.LABELS[metric]]
            self.assertEqual(row["value"], services.actual(self.kwame, metric, WED, WED))
            self.assertEqual(row["target"], services.target(self.kwame, metric, WED, WED))
        self.assertEqual((rows["Visits"]["value"], rows["Visits"]["target"]), (2, 6))
        week = {r["label"]: r for r in self.sections(start=MON, end=SUN)["targets"]["rows"]}
        self.assertEqual(week["Calls"]["target"], 60)

    def test_a_measure_with_no_plan_has_no_target(self):
        self.plan(self.kwame, "visits", 6)
        rows = {r["label"]: r for r in self.sections()["targets"]["rows"]}
        self.assertEqual(rows["Visits"]["target"], 6)
        self.assertNotIn("target", rows["Calls"])

    def test_only_scouts_get_the_scout_sections(self):
        self.assertNotIn("targets", self.sections(self.lead))
        self.assertIn("targets", self.sections(self.kwame))

    def test_visits_and_calls_by_outcome(self):
        self.visit(WED)
        self.visit(WED, outside=True)
        self.visit(WED, status=VisitCheckIn.ABANDONED)
        self.call(WED)
        self.call(WED)
        self.call(WED, "no_answer")
        self.call(MON)
        s = self.sections()
        self.assertEqual({r["label"]: r["value"] for r in s["visits"]["rows"]}, {"Visits done": 2, "Outside the business's radius": 1})
        self.assertEqual({r["label"]: r["value"] for r in s["call_outcomes"]["rows"]}, {"Connected": 2, "No answer": 1})

    def test_registrations_submitted_approved_returned_and_waiting(self):
        a = make_business("Approved", manager=self.kwame, registered_by=self.kwame)
        BusinessOwner.objects.filter(pk=a.pk).update(reviewed_at=at(WED), created_at=at(MON))
        p = make_business("Pending", manager=self.kwame, kyc=BusinessOwner.PENDING, registered_by=self.kwame)
        BusinessOwner.objects.filter(pk=p.pk).update(created_at=at(WED))
        r = make_business("Returned", manager=self.kwame, kyc=BusinessOwner.REJECTED, registered_by=self.kwame)
        BusinessOwner.objects.filter(pk=r.pk).update(reviewed_at=at(WED), created_at=at(MON))
        rows = {x["label"]: x["value"] for x in self.sections()["registrations"]["rows"]}
        self.assertEqual(rows, {"Submitted": 1, "Approved": 1, "Returned": 1, "Waiting for KYC now": 1})
        self.assertIn("1 registration waiting for KYC", self.sections()["targets"]["summary"])

    def test_follow_ups_done_and_missed_and_the_summary_line(self):
        for status in (Task.DONE, Task.DONE, Task.OPEN):
            Task.objects.create(owner=self.kwame, title="x", due_at=at(WED, 15), status=status)
        Task.objects.create(owner=self.kwame, title="cancelled", due_at=at(WED, 15), status=Task.CANCELLED)
        Task.objects.create(owner=self.efua, title="other", due_at=at(WED, 15))
        s = self.sections()
        self.assertEqual({r["label"]: r["value"] for r in s["follow_ups"]["rows"]}, {"Done": 2, "Missed": 1})
        self.assertTrue(s["targets"]["summary"].startswith("Follow-ups 2 of 3 done"))

    def test_commission_earned_in_the_period_and_on_hold(self):
        policy = CommissionPolicy.objects.create(kind="registration", amount=Decimal("50.00"), effective_from=date(2020, 1, 1), proposed_by=self.admin, approved_by=self.admin)
        owner = make_business("Asafo", manager=self.kwame, registered_by=self.kwame)
        CommissionAccrual.objects.create(
            business_owner=owner, staff=self.kwame, kind="registration", amount=Decimal("50.00"), policy=policy,
            earned_at=at(WED), hold_until=at(date(2027, 1, 1)),
        )
        s = self.sections()
        self.assertEqual({r["label"]: r["value"] for r in s["commission"]["rows"]}, {"Earned in the period (GH₵)": "50.00", "Of it on hold (GH₵)": "50.00"})
        self.assertIn("GH₵ 50.00 commission earned, on hold", s["targets"]["summary"])
        self.assertEqual(self.sections(start=MON, end=MON)["commission"]["rows"][0]["value"], "0.00")
        self.assertNotIn("commission earned", self.sections(start=MON, end=MON)["targets"]["summary"])

    def test_pending_approvals_and_portfolio_counts(self):
        make_business("Healthy one", manager=self.kwame, registered_by=self.kwame)
        s = self.sections()
        self.assertEqual(s["scout_approvals"]["rows"][0]["value"], ApprovalRequest.objects.filter(maker=self.kwame, status="pending").count())
        self.assertEqual(sum(r["value"] for r in s["portfolio"]["rows"]), 1)

    def test_the_snapshot_freezes_on_submit(self):
        self.plan(self.kwame, "visits", 6)
        self.visit(WED)
        report = report_services.save_draft(self.kwame, "day", WED, {"achievements": "Visited two shops in Bantama and registered one."})
        report_services.submit(report)
        report.refresh_from_db()
        self.assertEqual(report.status, StaffReport.SUBMITTED)
        frozen = {s["key"]: s for s in report.system_snapshot}["targets"]
        self.assertEqual({r["label"]: r["value"] for r in frozen["rows"]}["Visits"], 1)
        self.visit(WED)
        report.refresh_from_db()
        self.assertEqual({r["label"]: r["value"] for r in {s["key"]: s for s in report.system_snapshot}["targets"]["rows"]}["Visits"], 1)
