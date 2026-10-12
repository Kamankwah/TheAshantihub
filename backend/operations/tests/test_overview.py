from datetime import date, datetime, time, timedelta
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from approvals.models import ApprovalRequest
from field.models import VisitCheckIn
from fraud.models import FraudFlag
from portfolio.tests.health_fixtures import make_business
from targets.models import Leave, TargetPlan

TODAY = date(2026, 10, 7)  # a Wednesday
URL = "/api/operations/overview/"


def at(day, hour):
    return timezone.make_aware(datetime.combine(day, time(hour)))


class OverviewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.other_lead = make_staff("operations", "kojo@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.kofi = make_staff("scout", "kofi@example.com", manager=self.lead)
        self.kwaku = make_staff("scout", "kwaku@example.com", manager=self.other_lead)
        for patch in (
            mock.patch("django.utils.timezone.localdate", return_value=TODAY),
            mock.patch("django.utils.timezone.now", return_value=at(TODAY, 11)),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        for scout in (self.kwame, self.efua, self.kofi, self.kwaku):
            TargetPlan.objects.create(staff=scout, metric="registrations", daily_value=3, effective_from=date(2026, 10, 1), set_by=self.lead)
        Leave.objects.create(staff=self.kofi, start=date(2026, 10, 4), end=date(2026, 10, 8), kind="annual", recorded_by=self.lead)

    def get(self, who, **params):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who)}")
        return self.client.get(URL, params)

    def test_needs_portfolio_manage(self):
        self.assertEqual(self.get(self.kwame).status_code, 403)
        self.assertEqual(self.get(self.lead).status_code, 200)

    def test_team_registrations_target_is_the_sum_of_the_scouts_on_a_working_day(self):
        data = self.get(self.lead).data
        # Kofi is on leave, Kwaku is another team's: 3 + 3.
        self.assertEqual(data["kpis"]["registrations"], {"done": 0, "target": 6, "planned": 3})
        self.assertEqual(data["scout_count"], 3)
        self.assertEqual([r["name"] for r in data["scouts"]], ["Efua", "Kofi", "Kwame"])

    def test_week_period_sums_the_working_days(self):
        data = self.get(self.lead, period="week").data
        # Mon-Wed so far counts done; the target covers the whole Mon-Sat week for two scouts, less Kofi's leave (Fri and Sat only).
        self.assertEqual(data["kpis"]["registrations"]["target"], 3 * 6 * 2 + 3 * 2)

    def test_unknown_period_falls_back_to_today(self):
        self.assertEqual(self.get(self.lead, period="century").data["period"], "today")

    def test_checked_in_counts_only_scouts_working_today_and_names_who_is_on_leave(self):
        VisitCheckIn.objects.create(
            scout=self.kwame, purpose="prospecting", status="done", checked_in_at=at(TODAY, 9), checked_out_at=at(TODAY, 10),
            lat=6.69, lng=-1.62, accuracy_m=10, outside_radius=True,
        )
        kpi = self.get(self.lead).data["kpis"]["checked_in"]
        self.assertEqual((kpi["count"], kpi["working"], kpi["on_leave"], kpi["flagged"]), (1, 2, ["Kofi"], 1))

    def test_waiting_approvals_are_the_callers_with_the_oldest_first(self):
        old = ApprovalRequest.objects.create(
            kind="business.kyc", title="New business", maker=self.kwame, assigned_to=self.lead, stage="manager",
            target_label="Nana's Chop Bar", due_at=at(TODAY, 20), created_at=at(TODAY, 6),
        )
        ApprovalRequest.objects.create(
            kind="business.kyc", title="Newer", maker=self.efua, assigned_to=self.lead, stage="manager", due_at=at(TODAY, 20), created_at=at(TODAY, 10),
        )
        ApprovalRequest.objects.create(
            kind="business.kyc", title="Not mine", maker=self.kwaku, assigned_to=self.other_lead, stage="manager", due_at=at(TODAY, 20),
        )
        data = self.get(self.lead).data
        self.assertEqual(data["kpis"]["approvals"]["waiting"], 2)
        self.assertEqual(data["kpis"]["approvals"]["oldest"]["target_label"], "Nana's Chop Bar")
        self.assertEqual([w["id"] for w in data["waiting"]][0], old.pk)

    def test_issues_are_open_fraud_cases_on_the_teams_businesses_only(self):
        mine = make_business("Suame Auto Parts", manager=self.kwame)
        theirs = make_business("Elsewhere", manager=self.kwaku)
        FraudFlag.objects.create(kind=FraudFlag.DUPLICATE, title="Same MoMo number", business_owner=mine, source=FraudFlag.SYSTEM)
        FraudFlag.objects.create(kind=FraudFlag.DUPLICATE, title="Other team", business_owner=theirs, source=FraudFlag.SYSTEM)
        FraudFlag.objects.create(kind=FraudFlag.DUPLICATE, title="Closed", business_owner=mine, source=FraudFlag.SYSTEM, status=FraudFlag.DISMISSED)
        data = self.get(self.lead).data
        self.assertEqual([i["what"] for i in data["issues"]], ["Same MoMo number"])
        self.assertEqual(data["issues"][0]["account_manager"], "Kwame")
        # Operations holds service_issues.view, so support and delivery are real counts (none here).
        self.assertEqual(data["kpis"]["issues"], {"total": 1, "fraud": 1, "support": 0, "delivery": 0})

    def test_at_risk_counts_the_teams_businesses(self):
        data = self.get(self.lead).data
        self.assertEqual(data["kpis"]["at_risk"], {"count": 0, "needs_attention": 0})
