import csv
import io
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.models import Permission, Role
from activity.models import ActivityEvent
from commission.models import CommissionAccrual, CommissionPolicy
from disputes.models import Dispute
from events.models import Event, EventTicketType, Ticket
from insights.tests.base import InsightsBase


class RevenueTests(InsightsBase):
    def setUp(self):
        super().setUp()
        self.sale("150.00")
        self.sale("50.00")
        self.subscription("100.00")
        self.promotion("40.00")

    def get(self, query=""):
        today = timezone.localdate()
        return self.client.get(f"/api/insights/revenue/?from={today.replace(day=1)}&to={today}{query}")

    def test_only_money_with_a_record_behind_it_is_counted(self):
        self.as_staff(self.boss)
        body = self.get().json()
        self.assertEqual(body["kpis"]["sales"], "200.00")
        self.assertEqual(body["kpis"]["orders"], 2)
        self.assertEqual(body["kpis"]["average"], "100.00")
        self.assertEqual(body["kpis"]["revenue"], "140.00")
        types = {t["key"]: t["amount"] for t in body["types"]}
        self.assertEqual((types["subscriptions"], types["promotions"], types["hero"], types["event_fees"]), ("100.00", "40.00", "0.00", "0.00"))
        self.assertTrue(body["simulated"])
        names = [n["name"] for n in body["not_recorded"]]
        self.assertEqual(names, ["Commission on sales", "Delivery fees", "VAT"])
        self.assertNotIn("Commission on sales", [t["label"] for t in body["types"]])

    def test_zone_and_category_come_from_the_listing(self):
        self.as_staff(self.boss)
        body = self.get().json()
        self.assertEqual([(z["zone"], z["sales"], z["orders"], z["revenue"]) for z in body["zones"]], [("Manhyia", "200.00", 2, "140.00")])
        self.assertEqual([(c["category"], c["sales"]) for c in body["categories"]][0][1], "200.00")
        other = Role.objects.count() and self.get(f"&zone={self.adum.pk + 999}").json()
        self.assertEqual(other["kpis"]["sales"], "0.00")
        self.assertEqual(self.get(f"&zone={self.adum.pk}").json()["kpis"]["sales"], "200.00")

    def test_refunds_come_from_resolved_disputes_and_refunded_tickets(self):
        order = self.sale("20.00")
        Dispute.objects.create(order=order, raised_by=self.customer, reason=Dispute.ORDER_ISSUE, description="x", status=Dispute.RESOLVED, refund_amount=Decimal("20.00"))
        self.as_staff(self.boss)
        body = self.get().json()
        self.assertEqual((body["kpis"]["refunded"], body["kpis"]["refunds"]), ("20.00", 1))

    def test_scouts_cannot_read_it(self):
        self.as_staff(self.scout)
        self.assertEqual(self.get().status_code, 403)

    def test_export_formats_are_logged_and_a_bad_one_is_refused(self):
        self.as_staff(self.boss)
        csv_response = self.get("&format=csv")
        self.assertEqual(csv_response.status_code, 200)
        text = b"".join(csv_response.streaming_content if csv_response.streaming else [csv_response.content]).decode("utf-8-sig")
        self.assertIn("Subscriptions", text)
        self.assertEqual(self.get("&format=xlsx").status_code, 200)
        pdf = self.get("&format=pdf")
        self.assertEqual((pdf.status_code, pdf.content[:4]), (200, b"%PDF"))
        self.assertEqual(self.get("&format=docx").status_code, 400)
        event = ActivityEvent.objects.filter(verb="report.exported").latest("id")
        self.assertEqual((event.after["export"], event.after["format"], event.after["personal_data"]), ("revenue", "pdf", False))


class RefundsTests(InsightsBase):
    def setUp(self):
        super().setUp()
        order = self.sale("80.00")
        Dispute.objects.create(order=order, raised_by=self.customer, flagged_by=self.accountant, resolved_by=self.accountant, reason=Dispute.QUALITY_ISSUE, description="x", status=Dispute.RESOLVED, refund_amount=Decimal("30.00"))
        Dispute.objects.create(order=order, raised_by=self.customer, reason=Dispute.OTHER, description="y", status=Dispute.REJECTED)

    def test_lists_only_recorded_refunds_and_says_what_is_missing(self):
        self.as_staff(self.accountant)
        today = timezone.localdate()
        body = self.client.get(f"/api/insights/refunds/?from={today.replace(day=1)}&to={today}").json()
        self.assertEqual(len(body["rows"]), 1)
        row = body["rows"][0]
        self.assertEqual((row["source"], row["amount"], row["customer"], row["business"], row["decided_by"]), ("dispute", "30.00", "Ama Buyer", "Kofi Rooms", "Kofi"))
        self.assertEqual(body["kpis"]["refunded"], "30.00")
        self.assertTrue(any("approval" in n["why"] for n in body["not_recorded"]))
        self.assertNotIn("waiting", str(body["kpis"]).lower())

    def test_export_has_customer_names_so_it_needs_the_password(self):
        today = timezone.localdate()
        url = f"/api/insights/refunds/?from={today.replace(day=1)}&to={today}&format=csv"
        self.as_staff(self.accountant)
        denied = self.client.get(url)
        self.assertEqual((denied.status_code, denied.json()["code"]), (403, "sudo_required"))
        self.as_staff(self.accountant, sudo=True)
        self.assertEqual(self.client.get(url).status_code, 200)
        event = ActivityEvent.objects.filter(verb="report.exported").latest("id")
        self.assertTrue(event.after["personal_data"])


class CommissionTests(InsightsBase):
    def setUp(self):
        super().setUp()
        policy = CommissionPolicy.objects.create(kind="registration", amount=Decimal("50.00"), effective_from=timezone.localdate() - timedelta(days=200), proposed_by=self.accountant, approved_by=self.boss)
        now = timezone.now()
        self.make(policy, "on_hold", "50.00", 0)
        self.make(policy, "reversed", "50.00", 1)

    def make(self, policy, status, amount, n):
        owner = self.owner if n == 0 else __import__("accounts.models", fromlist=["BusinessOwner"]).BusinessOwner.objects.create(
            full_name=f"O{n}", login_phone=f"+23320766200{n + 5}", password_hash="x")
        return CommissionAccrual.objects.create(
            staff=self.scout, business_owner=owner, kind="registration", amount=Decimal(amount), policy=policy,
            earned_at=timezone.now(), hold_until=timezone.now() + timedelta(days=90), status=status,
        )

    def test_per_scout_totals_and_no_batches_yet(self):
        self.as_staff(self.boss)
        body = self.client.get("/api/insights/commissions/").json()
        self.assertEqual(len(body["scouts"]), 1)
        row = body["scouts"][0]
        self.assertEqual((row["name"], row["on_hold"], row["reversed"], row["in_batch"], row["paid"]), ("Kwame", "50.00", "50.00", "0.00", "0.00"))
        self.assertFalse(body["batches"]["exist"])
        self.assertEqual(body["policy"]["registration"]["amount"], "50.00")
        self.assertIsNone(body["policy"]["three_paid_months_bonus"]["amount"])
        self.assertIn("ruling", body["tax_note"])

    def test_statements_are_personal_data(self):
        url = "/api/insights/commissions/statement/?format=csv"
        self.as_staff(self.boss)
        self.assertEqual(self.client.get(url).json()["code"], "sudo_required")
        self.as_staff(self.boss, sudo=True)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        text = response.content.decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text)))
        self.assertIn("Kwame", text)
        self.assertEqual(sum(1 for r in rows if r and r[0] == "Kwame"), 2)
        self.assertTrue(ActivityEvent.objects.filter(verb="report.exported", after__personal_data=True).exists())

    def test_the_accrual_list_filters_by_kind_and_status(self):
        self.as_staff(self.boss)
        both = self.client.get("/api/commission/accruals/").json()
        self.assertEqual(both["count"], 2)
        self.assertEqual(self.client.get("/api/commission/accruals/?kind=registration&status=reversed").json()["count"], 1)
        self.assertEqual(self.client.get("/api/commission/accruals/?kind=three_paid_months_bonus").json()["count"], 0)

    def test_an_accountant_without_the_right_is_refused(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/insights/commissions/").status_code, 403)


class AnalyticsTests(InsightsBase):
    def test_series_and_repeat_rate_count_records(self):
        self.sale("100.00")
        self.sale("60.00")
        self.sale("10.00", customer=__import__("accounts.models", fromlist=["Customer"]).Customer.objects.create(full_name="Yaw", phone="+233200662002", password_hash="x"))
        self.as_staff(self.boss)
        body = self.client.get("/api/insights/analytics/").json()
        this_month = body["months"][-1]
        self.assertEqual((this_month["orders"], this_month["gmv"]), (3, "170.00"))
        self.assertEqual(body["kpis"]["buyers"], 2)
        self.assertEqual(body["kpis"]["repeat_rate"], 50.0)
        self.assertEqual(len(body["months"]), 6)
        self.assertEqual(body["months"][0]["gmv"], "0.00")
        self.assertEqual([n["name"] for n in body["not_measured"]][0], "Site visits and conversion")
        self.assertEqual(body["zones"][0]["zone"], "Manhyia")

    def test_empty_marketplace_shows_no_rate_rather_than_zero(self):
        self.as_staff(self.boss)
        body = self.client.get("/api/insights/analytics/").json()
        self.assertIsNone(body["kpis"]["repeat_rate"])
        self.assertIsNone(body["months"][-1]["repeat_rate"])
