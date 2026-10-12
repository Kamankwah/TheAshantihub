from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from field.models import VisitCheckIn
from field.tests.test_visits import PIN, pin_business

TEAM = "/api/field/visits/team/"


class TeamVisitsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.other_lead = make_staff("operations", "kojo@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.stranger = make_staff("scout", "yaw@example.com", manager=self.other_lead)
        self.adwoa = pin_business("Adwoa Fabrics", self.kwame)

    def get(self, who, query=""):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who)}")
        return self.client.get(f"{TEAM}{query}")

    def visit(self, scout, *, flagged=False, status="done", purpose="prospecting", when=None):
        when = when or timezone.now()
        return VisitCheckIn.objects.create(
            scout=scout, business_owner=self.adwoa, purpose=purpose, status=status, checked_in_at=when,
            checked_out_at=when + timedelta(minutes=20) if status == "done" else None,
            lat=PIN[0], lng=PIN[1], accuracy_m=12, distance_m=180 if flagged else 10, outside_radius=flagged,
        )

    def test_the_lead_sees_only_their_own_teams_check_ins_for_today(self):
        mine = self.visit(self.kwame)
        self.visit(self.stranger)
        self.visit(self.efua, when=timezone.now() - timedelta(days=2))
        body = self.get(self.lead).json()
        self.assertEqual([row["id"] for row in body["results"]], [mine.pk])
        self.assertEqual(body["summary"]["total"], 1)
        self.assertEqual(sorted(s["name"] for s in body["scouts"]), ["Efua", "Kwame"])
        self.assertEqual(body["results"][0]["fix"], {"lat": PIN[0], "lng": PIN[1]})

    def test_the_summary_counts_still_there_checked_out_and_flagged(self):
        self.visit(self.kwame, status="open")
        self.visit(self.kwame, flagged=True)
        self.visit(self.efua)
        summary = self.get(self.lead).json()["summary"]
        self.assertEqual((summary["total"], summary["still_there"], summary["checked_out"], summary["flagged"]), (3, 1, 2, 1))

    def test_filters_narrow_by_scout_purpose_and_flag(self):
        self.visit(self.kwame, purpose="registration")
        flagged = self.visit(self.efua, flagged=True, purpose="verification")
        self.assertEqual(len(self.get(self.lead, f"?scout={self.kwame.pk}").json()["results"]), 1)
        self.assertEqual(len(self.get(self.lead, "?purpose=verification").json()["results"]), 1)
        self.assertEqual([r["id"] for r in self.get(self.lead, "?flagged=1").json()["results"]], [flagged.pk])

    def test_a_scout_outside_the_team_cannot_be_asked_for(self):
        self.visit(self.stranger)
        self.assertEqual(self.get(self.lead, f"?scout={self.stranger.pk}").json()["results"], [])

    def test_a_past_day_can_be_read_and_a_bad_day_is_refused(self):
        old = self.visit(self.kwame, when=timezone.now() - timedelta(days=3))
        day = timezone.localtime(old.checked_in_at).date().isoformat()
        body = self.get(self.lead, f"?day={day}").json()
        self.assertEqual([r["id"] for r in body["results"]], [old.pk])
        self.assertFalse(body["is_today"])
        self.assertEqual(self.get(self.lead, "?day=soon").status_code, 400)

    def test_abandoned_visits_are_left_out(self):
        self.visit(self.kwame, status="abandoned")
        self.assertEqual(self.get(self.lead).json()["results"], [])

    def test_a_scout_cannot_read_the_team_map(self):
        self.assertEqual(self.get(self.kwame).status_code, 403)

    def test_a_super_admin_sees_every_scout(self):
        boss = make_staff("super_admin", "boss@example.com")
        self.visit(self.kwame)
        self.visit(self.stranger)
        self.assertEqual(len(self.get(boss).json()["results"]), 2)
