from datetime import datetime, time, timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from field.models import Prospect, VisitCheckIn
from insights.tests.base import InsightsBase
from reports import services
from reports.models import StaffReport


class FunnelTests(InsightsBase):
    def visit(self, scout, *, owner=None, prospect=None, days_ago=10):
        return VisitCheckIn.objects.create(
            scout=scout, business_owner=owner, prospect=prospect, purpose=VisitCheckIn.PROSPECTING, status=VisitCheckIn.DONE,
            checked_in_at=timezone.now() - timedelta(days=days_ago), lat=Decimal("6.7"), lng=Decimal("-1.6"), accuracy_m=10,
        )

    def test_each_stage_is_counted_from_records_and_never_exceeds_the_one_before(self):
        # Visited and never registered.
        lost = Prospect.objects.create(scout=self.scout, name="Stall", phone="+233200000001", zone=self.adum)
        self.visit(self.scout, prospect=lost)
        # Registered, KYC approved, listing live, paid 1 month (self.owner).
        self.visit(self.scout, owner=self.owner)
        self.subscription(months=1)
        # Registered only (pending KYC).
        pending = BusinessOwner.objects.create(full_name="P", login_phone="+233200000009", password_hash="x", registered_by=self.scout)
        BusinessOwnerProfile.objects.create(business_owner=pending, business_name="Pending Co", zone=self.adum)
        self.visit(self.scout, owner=pending)
        self.as_staff(self.boss)
        body = self.client.get(f"/api/insights/funnel/?team={self.lead.pk}").json()
        counts = {s["key"]: s["count"] for s in body["stages"]}
        self.assertEqual(counts, {"visited": 3, "registered": 2, "kyc": 1, "listing": 1, "order": 0, "paid3": 0})
        self.assertEqual(body["overall"], 0.0)
        row = body["by_scout"][0]
        self.assertEqual((row["name"], row["counts"]["visited"]), ("Kwame", 3))
        self.assertEqual(body["by_zone"][0]["counts"]["visited"], 3)
        self.assertTrue(body["notes"][0]["title"].startswith("Scout visited to Registered"))
        self.assertEqual(body["team_options"], [{"id": self.lead.pk, "name": "Ama's scouts"}])

    def test_first_order_and_three_paid_months_move_a_business_to_the_end(self):
        self.visit(self.scout, owner=self.owner)
        self.sale("100.00")
        self.subscription(months=3)
        self.as_staff(self.boss)
        body = self.client.get("/api/insights/funnel/").json()
        self.assertEqual(body["stages"][-1]["count"], 1)
        self.assertEqual(body["overall"], 100.0)

    def test_visits_outside_the_window_are_not_in_the_cohort(self):
        self.visit(self.scout, owner=self.owner, days_ago=400)
        self.as_staff(self.boss)
        body = self.client.get("/api/insights/funnel/").json()
        self.assertEqual(body["stages"][0]["count"], 0)
        self.assertIsNone(body["overall"])

    def test_needs_analytics_permission_and_exports(self):
        self.visit(self.scout, owner=self.owner)
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/insights/funnel/").status_code, 403)
        self.as_staff(self.boss)
        self.assertEqual(self.client.get("/api/insights/funnel/?format=xlsx").status_code, 200)


class ReportsHubTests(InsightsBase):
    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        self.day = self.today - timedelta(days=1)
        self.other = make_staff("scout", "efua@example.com", manager=self.lead)
        self.third = make_staff("scout", "kofi2@example.com", manager=self.lead)
        # created long ago so they owe yesterday's report
        from accounts.models import StaffUser

        StaffUser.objects.update(created_at=timezone.now() - timedelta(days=60))

    def submit(self, staff, at_hour):
        report = services.save_draft(staff, "day", self.day, {"achievements": "Visited three weavers in Bonwire and wrote it all down."})
        return services.submit(report, now=timezone.make_aware(datetime.combine(self.day, time(at_hour))))

    def hub(self, query=""):
        return self.client.get(f"/api/insights/reports-hub/?period=day&date={self.day}{query}").json()

    def test_expected_on_time_late_missing_and_acknowledged_are_counted_per_team(self):
        self.submit(self.scout, 17)
        late = self.submit(self.other, 21)
        self.as_staff(self.boss)
        services.acknowledge(services.StaffReport.objects.get(pk=late.pk), self.boss)
        body = self.hub()
        scouts = next(t for t in body["teams"] if t["key"] == "scouts")
        self.assertEqual((scouts["expected"], scouts["on_time"], scouts["late"], scouts["missing"], scouts["acknowledged"]), (3, 1, 1, 1, 1))
        self.assertEqual(scouts["reviewers"], ["Ama"])
        self.assertEqual(scouts["on_time_share"], 33)
        states = {r["staff"]["full_name"]: r["state"] for r in body["rows"] if r["team"] == "scouts"}
        self.assertEqual(states, {"Kwame": "submitted", "Efua": "acknowledged", "Kofi2": "missing"})
        self.assertEqual(body["rows"][0]["staff"]["full_name"], "Kwame")  # waiting for the viewer comes first
        self.assertEqual(body["rows"][1]["state"], "missing")

    def test_filters_and_the_waiting_for_you_count(self):
        self.submit(self.scout, 17)
        self.as_staff(self.boss)
        body = self.hub("&status=waiting")
        self.assertEqual([r["staff"]["full_name"] for r in body["rows"]], ["Kwame"])
        self.assertEqual(body["kpis"]["waiting"], 1)
        self.assertEqual([r["staff"]["full_name"] for r in self.hub("&status=missing&role=scouts")["rows"]], ["Efua", "Kofi2"])
        self.assertEqual(self.hub("&person=kwa")["rows"][0]["staff"]["full_name"], "Kwame")

    def test_a_person_on_leave_is_not_expected(self):
        from targets.models import Leave

        Leave.objects.create(staff=self.third, start=self.day, end=self.day, recorded_by=self.lead)
        self.as_staff(self.boss)
        body = self.hub()
        scouts = next(t for t in body["teams"] if t["key"] == "scouts")
        self.assertEqual(scouts["expected"], 2)

    def test_only_those_who_can_view_all_reports_get_the_hub(self):
        self.as_staff(self.lead)
        self.assertEqual(self.client.get("/api/insights/reports-hub/").status_code, 403)

    def test_a_returned_report_still_counts_as_sent(self):
        report = self.submit(self.scout, 18)
        services.return_report(StaffReport.objects.get(pk=report.pk), self.boss, "Add the numbers")
        self.as_staff(self.boss)
        row = next(r for r in self.hub()["rows"] if r["staff"]["full_name"] == "Kwame")
        self.assertEqual((row["state"], row["report"]["review_note"]), ("returned", "Add the numbers"))
