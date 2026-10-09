from datetime import timedelta

from django.utils import timezone

from accounts.models import BusinessOwner
from billing.models import Transaction
from calls.models import CallLog
from field.models import VisitCheckIn
from payments.models import CheckoutSession
from portfolio.models import AccountManagerAssignment
from portfolio.tests.health_fixtures import make_business
from targets import services
from targets.models import Leave, PublicHoliday, TargetPlan, WorkPattern

from .base import MON, SAT, SUN, WED, TargetsBase, at
from datetime import date


class WorkingDayTests(TargetsBase):
    def test_monday_to_saturday_is_the_default_and_sunday_is_off(self):
        self.assertTrue(services.is_working_day(self.kwame, MON))
        self.assertTrue(services.is_working_day(self.kwame, SAT))
        self.assertFalse(services.is_working_day(self.kwame, SUN))

    def test_a_custom_work_pattern(self):
        WorkPattern.objects.create(staff=self.kwame, weekdays=[1, 2, 3], set_by=self.lead)  # Tue-Thu
        self.assertFalse(services.is_working_day(self.kwame, MON))
        self.assertTrue(services.is_working_day(self.kwame, date(2026, 10, 6)))
        self.assertFalse(services.is_working_day(self.kwame, SAT))
        self.assertTrue(services.is_working_day(self.efua, MON))  # the pattern is per scout

    def test_a_public_holiday_and_leave_are_not_working_days(self):
        PublicHoliday.objects.create(date=date(2026, 10, 6), name="Observed holiday")
        Leave.objects.create(staff=self.kwame, start=SAT, end=SAT, recorded_by=self.lead)
        self.assertFalse(services.is_working_day(self.kwame, date(2026, 10, 6)))
        self.assertFalse(services.is_working_day(self.kwame, SAT))
        self.assertTrue(services.is_working_day(self.efua, SAT))  # leave belongs to one scout
        self.assertFalse(services.is_working_day(self.efua, date(2026, 10, 6)))  # a holiday to everyone


class TargetSumTests(TargetsBase):
    def setUp(self):
        super().setUp()
        self.plan_all(self.kwame, registrations=1, visits=6, calls=10, renewals=1)

    def test_a_working_day_has_the_plan_value_and_sunday_has_none(self):
        self.assertEqual(services.daily_target(self.kwame, "visits", MON), 6)
        self.assertEqual(services.daily_target(self.kwame, "visits", SUN), 0)

    def test_holidays_and_leave_give_zero(self):
        PublicHoliday.objects.create(date=date(2026, 10, 6), name="H")
        Leave.objects.create(staff=self.kwame, start=SAT, end=SAT, recorded_by=self.lead)
        self.assertEqual(services.daily_target(self.kwame, "calls", date(2026, 10, 6)), 0)
        self.assertEqual(services.daily_target(self.kwame, "calls", SAT), 0)

    def test_a_week_is_the_sum_of_its_working_days(self):
        self.assertEqual(services.target(self.kwame, "calls", MON, SUN), 60)  # six working days
        Leave.objects.create(staff=self.kwame, start=SAT, end=SAT, recorded_by=self.lead)
        self.assertEqual(services.target(self.kwame, "calls", MON, SUN), 50)

    def test_a_month_is_the_sum_of_its_working_days(self):
        # October 2026: 31 days, 4 Sundays (4, 11, 18, 25) -> 27 working days
        self.assertEqual(services.target(self.kwame, "visits", date(2026, 10, 1), date(2026, 10, 31)), 27 * 6)

    def test_a_team_target_is_the_sum_of_the_scouts(self):
        self.plan_all(self.efua, calls=4)
        total = sum(services.target(s, "calls", MON, SUN) for s in (self.kwame, self.efua))
        self.assertEqual(total, 60 + 24)

    def test_a_later_plan_applies_only_from_its_date(self):
        self.plan(self.kwame, "calls", 20, effective_from=WED)
        self.assertEqual(services.daily_target(self.kwame, "calls", date(2026, 10, 6)), 10)
        self.assertEqual(services.daily_target(self.kwame, "calls", WED), 20)
        self.assertEqual(services.target(self.kwame, "calls", MON, SUN), 10 * 2 + 20 * 4)

    def test_no_plan_gives_zero_and_the_summary_says_no_target_set(self):
        summary = services.period_summary(self.efua, "week", WED)
        self.assertFalse(summary["has_targets"])
        self.assertTrue(all(m["target"] is None for m in summary["measures"]))
        self.assertIsNone(summary["set_by"])


class ActualTests(TargetsBase):
    def visit(self, staff, day, status=VisitCheckIn.DONE, outside=False):
        return VisitCheckIn.objects.create(
            scout=staff, purpose="prospecting", status=status, checked_in_at=at(day), lat=6.6885, lng=-1.6244,
            accuracy_m=10, outside_radius=outside,
        )

    def test_visits_count_when_done_including_outside_radius_but_not_open_or_abandoned(self):
        self.visit(self.kwame, WED)
        self.visit(self.kwame, WED, outside=True)
        self.visit(self.kwame, WED, status=VisitCheckIn.ABANDONED)
        self.visit(self.efua, WED)  # someone else's
        self.visit(self.kwame, date(2026, 10, 3))  # last week
        self.assertEqual(services.actual(self.kwame, "visits", MON, SUN), 2)
        self.assertEqual(services.actual(self.kwame, "visits", WED, WED), 2)
        self.visit(self.kwame, date(2026, 10, 8), status=VisitCheckIn.OPEN)
        self.assertEqual(services.actual(self.kwame, "visits", MON, SUN), 2)

    def test_calls_count_by_the_scout_and_the_day(self):
        for who, day in [(self.kwame, WED), (self.kwame, MON), (self.efua, WED), (self.kwame, date(2026, 10, 3))]:
            CallLog.objects.create(staff=who, direction="out", counterpart_type="other", purpose="other", outcome="connected", started_at=at(day))
        self.assertEqual(services.actual(self.kwame, "calls", MON, SUN), 2)
        self.assertEqual(services.actual(self.kwame, "calls", WED, WED), 1)

    def test_registrations_count_when_kyc_is_approved_for_the_registering_scout(self):
        approved = make_business("Approved", manager=self.kwame, registered_by=self.kwame)
        BusinessOwner.objects.filter(pk=approved.pk).update(reviewed_at=at(WED))
        pending = make_business("Pending", manager=self.kwame, kyc=BusinessOwner.PENDING, registered_by=self.kwame)
        rejected = make_business("Rejected", manager=self.kwame, kyc=BusinessOwner.REJECTED, registered_by=self.kwame)
        BusinessOwner.objects.filter(pk=rejected.pk).update(reviewed_at=at(WED))
        elsewhere = make_business("Other scout", manager=self.efua, registered_by=self.efua)
        BusinessOwner.objects.filter(pk=elsewhere.pk).update(reviewed_at=at(WED))
        self.assertEqual(services.actual(self.kwame, "registrations", MON, SUN), 1)
        self.assertEqual(services.actual(self.kwame, "registrations", date(2020, 1, 1), date(2020, 1, 31)), 0)
        self.assertIsNone(pending.reviewed_at)  # waiting for KYC: not counted yet

    def pay(self, owner, when, *, kind="subscription", status=Transaction.SUCCESS):
        txn = Transaction.objects.create(business_owner=owner, amount=50, purpose="Subscription", status=status, reference=f"R-{Transaction.objects.count()}")
        Transaction.objects.filter(pk=txn.pk).update(created_at=when)
        CheckoutSession.objects.create(business_owner=owner, kind=kind, amount=50, purpose="Subscription", transaction=txn)
        return txn

    def manage(self, owner, scout, start, end=None):
        return AccountManagerAssignment.objects.create(business_owner=owner, scout=scout, started_at=start, ended_at=end)

    def test_a_renewal_belongs_to_whoever_managed_the_business_when_it_was_paid(self):
        owner = make_business("Adwoa Fabrics")
        # Kwame managed it until Wednesday 12:00; Efua since.
        self.manage(owner, self.kwame, at(date(2026, 9, 1)), at(WED, 12))
        self.manage(owner, self.efua, at(WED, 12))
        self.pay(owner, at(WED, 9))
        self.pay(owner, at(date(2026, 10, 8), 9))
        self.assertEqual(services.actual(self.kwame, "renewals", MON, SUN), 1)
        self.assertEqual(services.actual(self.efua, "renewals", MON, SUN), 1)

    def test_only_successful_subscription_payments_are_renewals(self):
        owner = make_business("Adwoa Fabrics")
        self.manage(owner, self.kwame, at(date(2026, 9, 1)))
        self.pay(owner, at(WED), kind="listing_promotion")
        self.pay(owner, at(WED), status=Transaction.FAILED)
        self.pay(owner, at(WED))
        self.assertEqual(services.actual(self.kwame, "renewals", MON, SUN), 1)

    def test_a_scout_with_nothing_has_zero_everywhere(self):
        for metric in ("registrations", "visits", "calls", "renewals"):
            self.assertEqual(services.actual(self.efua, metric, MON, SUN), 0)


class PeriodSummaryTests(TargetsBase):
    def setUp(self):
        super().setUp()
        self.plan_all(self.kwame, registrations=1, visits=6, calls=10, renewals=1)
        Leave.objects.create(staff=self.kwame, start=SAT, end=SAT, recorded_by=self.lead)

    def test_the_week(self):
        summary = services.period_summary(self.kwame, "week", WED)
        self.assertEqual((summary["start"], summary["end"]), (MON, SUN))
        self.assertEqual((summary["working_days"], summary["leave_days"]), (5, 1))
        self.assertEqual(summary["label"], "Mon 5 – Sun 11 October")
        calls = next(m for m in summary["measures"] if m["metric"] == "calls")
        self.assertEqual((calls["done"], calls["target"], calls["today_done"], calls["today_target"]), (0, 50, 0, 10))
        states = [(d["date"].day, d["state"]) for d in summary["days"]]
        self.assertEqual(states, [(5, "done"), (6, "done"), (7, "today"), (8, "ahead"), (9, "ahead"), (10, "leave")])  # Sunday left out
        self.assertEqual(summary["set_by"], "Ama")
        self.assertEqual(summary["lead"]["name"], "Ama")
        self.assertTrue(summary["sunday_off"])

    def test_the_day(self):
        summary = services.period_summary(self.kwame, "day", SAT)
        visits = next(m for m in summary["measures"] if m["metric"] == "visits")
        self.assertEqual((visits["target"], summary["working_days"], summary["leave_days"]), (0, 0, 1))  # leave: that day's target is 0, not missing

    def test_the_month_sums_the_working_days(self):
        summary = services.period_summary(self.kwame, "month", WED)
        self.assertEqual((summary["working_days"], summary["leave_days"]), (26, 1))
        self.assertEqual(next(m for m in summary["measures"] if m["metric"] == "calls")["target"], 260)

    def test_a_past_week_has_no_today_line(self):
        summary = services.period_summary(self.kwame, "week", date(2026, 9, 21))
        self.assertTrue(all(m["today_done"] is None for m in summary["measures"]))

    def test_a_holiday_is_named_and_not_counted_as_a_working_day(self):
        PublicHoliday.objects.create(date=date(2026, 10, 9), name="Founders' Day (observed)")
        summary = services.period_summary(self.kwame, "week", WED)
        self.assertEqual(summary["working_days"], 4)
        self.assertEqual(summary["holidays"][0]["name"], "Founders' Day (observed)")
        self.assertIn((9, "holiday"), [(d["date"].day, d["state"]) for d in summary["days"]])
