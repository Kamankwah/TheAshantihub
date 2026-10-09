from datetime import date, datetime, time
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from listings.models import Listing, Zone
from portfolio.tests.change_fixtures import make_business, make_listing
from targets.models import Leave

TODAY = date(2026, 10, 7)


def at(day):
    return timezone.make_aware(datetime.combine(day, time(10)))


class LeaderboardTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.yaw = make_staff("scout", "yaw@example.com", manager=self.lead)
        self.rival_lead = make_staff("operations", "yaa@example.com")
        self.rival = make_staff("scout", "rival@example.com", manager=self.rival_lead)
        patch = mock.patch("django.utils.timezone.localdate", return_value=TODAY)
        patch.start()
        self.addCleanup(patch.stop)
        self.n = 0

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def activate(self, scout, kyc_day, listing_day=None, listing=True):
        """A business registered by `scout`, verified on kyc_day, first listing live on listing_day."""
        self.n += 1
        owner = make_business(scout, phone=f"+2332441002{self.n:02d}", name=f"Biz {self.n}", gps=f"AK-039-51{self.n:02d}")
        BusinessOwner.objects.filter(pk=owner.pk).update(reviewed_at=at(kyc_day))
        if listing:
            item = make_listing(owner)
            Listing.objects.filter(pk=item.pk).update(reviewed_at=at(listing_day or kyc_day))
        return owner

    def get(self, user, query=""):
        self.as_staff(user)
        return self.client.get(f"/api/portfolio/leaderboard/{query}")

    def test_ranks_come_from_activations_and_ties_share_a_rank(self):
        for _ in range(3):
            self.activate(self.efua, date(2026, 10, 2))
        for _ in range(2):
            self.activate(self.kwame, date(2026, 10, 3))
            self.activate(self.yaw, date(2026, 10, 5))
        body = self.get(self.kwame).json()
        self.assertEqual([(r["name"], r["activations"], r["rank"]) for r in body["rows"]],
                         [(self.efua.full_name, 3, 1), (self.kwame.full_name, 2, 2), (self.yaw.full_name, 2, 2)])
        self.assertEqual((body["my_rank"], body["team_total"], body["lead"]["name"]), (2, 7, self.lead.full_name))
        self.assertEqual(body["gap"], {"name": self.efua.full_name, "count": 1})
        self.assertTrue(next(r for r in body["rows"] if r["is_me"])["name"] == self.kwame.full_name)

    def test_an_activation_needs_kyc_and_a_live_listing_and_counts_on_the_later_date(self):
        self.activate(self.kwame, date(2026, 10, 2), listing=False)  # no listing
        draft = self.activate(self.kwame, date(2026, 10, 2))
        Listing.objects.filter(business_owner=draft).update(status=Listing.DRAFT)
        self.activate(self.kwame, date(2026, 9, 28), listing_day=date(2026, 10, 4))  # KYC last month, listing this month
        unverified = self.activate(self.kwame, date(2026, 10, 3))
        BusinessOwner.objects.filter(pk=unverified.pk).update(kyc_status=BusinessOwner.PENDING)
        self.activate(self.kwame, date(2026, 10, 6), listing_day=date(2026, 10, 9))  # live after today: not yet
        body = self.get(self.kwame).json()
        self.assertEqual(next(r for r in body["rows"] if r["is_me"])["activations"], 1)

    def test_team_scope_excludes_other_teams_and_no_money_is_returned(self):
        self.activate(self.rival, date(2026, 10, 2))
        self.activate(self.kwame, date(2026, 10, 2))
        body = self.get(self.kwame).json()
        self.assertNotIn(self.rival.full_name, str(body))
        self.assertEqual(body["team_total"], 1)
        for banned in ("amount", "commission", "gh"):
            self.assertNotIn(banned, str(body).lower())

    def test_most_improved_only_on_a_real_increase_against_the_same_day_last_month(self):
        self.activate(self.efua, date(2026, 9, 3))  # then: 1 by 7 Sep
        self.activate(self.efua, date(2026, 10, 3))  # now: 1 — level, not improved
        self.assertIsNone(self.get(self.kwame).json()["most_improved"])
        for day in (2, 4, 6):
            self.activate(self.yaw, date(2026, 10, day))
        self.activate(self.yaw, date(2026, 9, 20))  # after the 7th last month: not in "then"
        body = self.get(self.kwame).json()
        self.assertEqual(body["most_improved"]["name"], self.yaw.full_name)
        self.assertEqual((body["most_improved"]["now"], body["most_improved"]["then"]), (3, 0))
        self.assertTrue(next(r for r in body["rows"] if r["name"] == self.yaw.full_name)["most_improved"])

    def test_leave_days_are_shown_not_subtracted(self):
        self.activate(self.kwame, date(2026, 10, 2))
        Leave.objects.create(staff=self.kwame, start=date(2026, 10, 5), end=date(2026, 10, 6), recorded_by=self.lead)
        body = self.get(self.kwame).json()
        me = next(r for r in body["rows"] if r["is_me"])
        self.assertEqual((me["leave_days"], me["activations"]), (2, 1))

    def test_areas_are_the_zones_of_the_businesses_managed(self):
        self.activate(self.kwame, date(2026, 10, 2))
        body = self.get(self.kwame).json()
        self.assertEqual(next(r for r in body["rows"] if r["is_me"])["areas"], ["Manhyia"])
        self.assertEqual(next(r for r in body["rows"] if r["name"] == self.yaw.full_name)["areas"], [])

    def test_a_rejected_business_is_not_one_of_the_areas(self):
        owner = self.activate(self.kwame, date(2026, 10, 2))
        BusinessOwner.objects.filter(pk=owner.pk).update(kyc_status=BusinessOwner.REJECTED)
        self.assertEqual(next(r for r in self.get(self.kwame).json()["rows"] if r["is_me"])["areas"], [])

    def test_a_past_month_and_bad_months(self):
        self.activate(self.kwame, date(2026, 9, 10))
        body = self.get(self.kwame, "?month=2026-09").json()
        self.assertEqual((body["month"], body["team_total"], str(body["as_of"])), ("2026-09", 1, "2026-09-30"))
        self.assertEqual(self.get(self.kwame, "?month=2026-12").status_code, 400)
        self.assertEqual(self.get(self.kwame, "?month=nope").status_code, 400)
        self.assertEqual(self.get(self.kwame, "?month=1999-01").status_code, 400)
        self.assertEqual(self.get(self.kwame, "?month=2101-01").status_code, 400)

    def test_a_scout_with_no_manager_sees_only_themselves(self):
        solo = make_staff("scout", "solo@example.com")
        body = self.get(solo).json()
        self.assertEqual([r["name"] for r in body["rows"]], [solo.full_name])
        self.assertIsNone(body["lead"])
        self.assertIsNone(body["gap"])

    def test_needs_the_portfolio_permission(self):
        self.client.credentials()
        self.assertEqual(self.client.get("/api/portfolio/leaderboard/").status_code, 401)
        accountant = make_staff("accountant", "acc@example.com")
        self.assertEqual(self.get(accountant).status_code, 403)
