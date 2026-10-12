from datetime import date, datetime, time, timedelta
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from accounts.testing import make_staff, staff_token
from field.models import VisitCheckIn
from fraud.models import FraudFlag
from operations.scoreboard import scouts_scoreboard
from portfolio.tests.health_fixtures import make_business
from reports.models import StaffReport
from targets.models import Leave, TargetPlan

TODAY = date(2026, 10, 7)  # a Wednesday
URL = "/api/operations/scouts/"


def at(day, hour):
    return timezone.make_aware(datetime.combine(day, time(hour)))


class ScoreboardTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = make_staff("super_admin", "root@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_lead = make_staff("operations", "kojo@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.kwaku = make_staff("scout", "kwaku@example.com", manager=self.other_lead)
        self.support = make_staff("support", "esi@example.com", manager=self.lead)
        patcher = mock.patch("django.utils.timezone.localdate", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)
        now = mock.patch("django.utils.timezone.now", return_value=at(TODAY, 11))
        now.start()
        self.addCleanup(now.stop)
        for scout in (self.kwame, self.efua, self.kwaku):
            for metric, value in (("registrations", 3), ("visits", 8), ("calls", 10), ("renewals", 1)):
                TargetPlan.objects.create(staff=scout, metric=metric, daily_value=value, effective_from=date(2026, 10, 1), set_by=self.lead)

    def get(self, who, **params):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who)}")
        return self.client.get(URL, params)

    def row(self, response, staff):
        return next(r for r in response.data["scouts"] if r["id"] == staff.pk)

    def test_permission_and_default_scope_is_the_leads_own_team(self):
        self.assertEqual(self.get(self.kwame).status_code, 403)
        response = self.get(self.lead)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([r["name"] for r in response.data["scouts"]], ["Efua", "Kwame"])  # not Kwaku, not Support
        self.assertEqual(response.data["counts"], {"team": 2, "all": 3})
        self.assertTrue(all(r["mine"] for r in response.data["scouts"]))

    def test_all_scouts_marks_other_teams_read_only(self):
        response = self.get(self.lead, scope="all")
        self.assertEqual({r["name"]: r["mine"] for r in response.data["scouts"]}, {"Efua": True, "Kwame": True, "Kwaku": False})
        self.assertEqual(self.row(response, self.kwaku)["manager"]["name"], "Kojo")
        # totals are the caller's team only
        self.assertEqual(response.data["totals"]["calls"]["target"], 20)

    def test_a_super_admin_sees_every_scout_as_theirs(self):
        response = self.get(self.admin)
        self.assertEqual(len(response.data["scouts"]), 3)
        self.assertTrue(all(r["mine"] for r in response.data["scouts"]))

    def test_todays_numbers_come_from_source_records(self):
        VisitCheckIn.objects.create(
            scout=self.kwame, purpose="prospecting", status="done", checked_in_at=at(TODAY, 9), checked_out_at=at(TODAY, 10),
            lat=6.69, lng=-1.62, accuracy_m=10,
        )
        response = self.get(self.lead)
        kwame = self.row(response, self.kwame)
        self.assertEqual(kwame["measures"]["visits"], {"done": 1, "target": 8})
        self.assertEqual(kwame["measures"]["registrations"], {"done": 0, "target": 3})
        self.assertEqual(response.data["totals"]["visits"], {"done": 1, "target": 16})
        self.assertEqual(kwame["check_in"]["outside_radius"], False)

    def test_month_pace_counts_registrations_against_the_target_due_so_far(self):
        owner = make_business("Nana's Chop Bar", manager=self.kwame, kyc_days=1)
        owner.registered_by = self.kwame
        owner.reviewed_at = at(date(2026, 10, 2), 10)
        owner.save()
        kwame = self.row(self.get(self.lead), self.kwame)
        # Mon 5 and Tue 6 and Wed 7 plus Thu 1, Fri 2, Sat 3 are working: six days, so far, at 3 a day
        self.assertEqual(kwame["month"]["done"], 1)
        self.assertEqual(kwame["month"]["due_by_today"], 18)
        self.assertFalse(kwame["month"]["on_pace"])
        self.assertEqual(kwame["month"]["target"], 81)

    def test_leave_zeroes_the_day_and_shows_when_they_are_back(self):
        Leave.objects.create(staff=self.efua, start=date(2026, 10, 4), end=date(2026, 10, 8), recorded_by=self.lead)
        efua = self.row(self.get(self.lead), self.efua)
        self.assertEqual(efua["state"], "leave")
        self.assertEqual(efua["measures"]["calls"]["target"], 0)
        self.assertEqual(efua["back_on"], date(2026, 10, 9))
        self.assertGreater(efua["month"]["leave_cut"], 0)
        self.assertEqual(efua["report"]["today"]["late"], False)

    def test_team_totals_skip_people_who_are_not_working_today(self):
        Leave.objects.create(staff=self.efua, start=date(2026, 10, 7), end=date(2026, 10, 7), recorded_by=self.lead)
        totals = self.get(self.lead).data["totals"]
        self.assertEqual(totals["calls"]["target"], 10)  # Kwame only

    def test_health_mix_counts_each_scouts_businesses(self):
        make_business("Fresh Bakery", manager=self.kwame, kyc_days=100)
        make_business("Old Shop", manager=self.kwame, kyc_days=100)
        mix = self.row(self.get(self.lead), self.kwame)["portfolio"]
        self.assertEqual(mix["size"], 2)
        self.assertEqual(sum(mix[k] for k in ("healthy", "needs_attention", "at_risk", "new")), 2)
        self.assertEqual(self.row(self.get(self.lead), self.efua)["portfolio"]["size"], 0)

    def test_outside_radius_visits_and_the_open_fraud_case_are_flagged(self):
        for hour in (8, 9, 10):
            VisitCheckIn.objects.create(
                scout=self.kwame, purpose="prospecting", status="done", checked_in_at=at(TODAY - timedelta(days=hour - 8), hour),
                lat=6.69, lng=-1.62, accuracy_m=10, distance_m=180, outside_radius=True,
            )
        FraudFlag.objects.create(kind="outside_radius", source="system", title="t", staff_subject=self.kwame)
        response = self.get(self.lead)
        kwame = self.row(response, self.kwame)
        self.assertEqual(kwame["outside_7d"], 3)
        self.assertTrue(kwame["fraud_case_open"])
        self.assertEqual(kwame["check_in"]["distance_m"], 180)
        self.assertEqual(response.data["totals"]["visits_flagged"], 1)  # only today's counts toward the card
        self.assertEqual(self.row(response, self.efua)["outside_7d"], 0)

    def test_report_status_today_and_the_last_report(self):
        StaffReport.objects.create(staff=self.kwame, period="day", period_start=TODAY, period_end=TODAY, status="draft")
        StaffReport.objects.create(staff=self.kwame, period="day", period_start=TODAY - timedelta(days=1), period_end=TODAY - timedelta(days=1), status="acknowledged", is_late=True, similarity=0.9)
        response = self.get(self.lead)
        kwame, efua = self.row(response, self.kwame), self.row(response, self.efua)
        self.assertEqual(kwame["report"]["today"]["status"], "draft")
        self.assertEqual(kwame["report"]["last"]["status"], "acknowledged")
        self.assertTrue(kwame["report"]["last"]["similar"])
        self.assertEqual(efua["report"]["today"]["status"], "not_yet")
        self.assertIsNone(efua["report"]["last"])
        self.assertEqual(efua["report"]["today"]["due"], "19:00")
        self.assertFalse(efua["report"]["today"]["late"])  # 11:00 is before 19:00

    def test_a_missing_report_is_late_after_the_due_time(self):
        with mock.patch("django.utils.timezone.now", return_value=at(TODAY, 20)):
            response = self.get(self.lead)
        self.assertTrue(self.row(response, self.kwame)["report"]["today"]["late"])

    def test_pending_invitees_are_not_scouts_yet(self):
        make_staff("scout", "new@example.com", manager=self.lead, invite_token="abc")
        self.assertEqual(len(self.get(self.lead).data["scouts"]), 2)

    def test_the_service_function_is_reusable(self):
        board = scouts_scoreboard(self.lead, "team")
        self.assertEqual(len(board["scouts"]), 2)
        self.assertEqual(scouts_scoreboard(self.lead, "bogus")["scope"], "team")
