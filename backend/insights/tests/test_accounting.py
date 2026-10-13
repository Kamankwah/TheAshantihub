from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from activity.models import ActivityEvent, ChainCheck
from billing.models import Transaction
from commission.models import CommissionAccrual
from disputes.models import Dispute
from events.models import Event, EventTicketType, Ticket
from fraud.models import FraudFlag
from insights.tests.base import InsightsBase
from listings.models import Category, Zone
from reports.providers import generic_sections
from reports import providers


class AccountingBase(InsightsBase):
    def make_ticket(self, price="80.00"):
        if not hasattr(self, "ticket_type"):
            now = timezone.now()
            event = Event.objects.create(
                category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"), submitted_by_business=self.owner,
                name="Akwasidae", description="D.", address="Manhyia", event_date=now + timedelta(days=5), visibility_days=14,
                status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
            )
            self.ticket_type = EventTicketType.objects.create(event=event, name="Regular", price="80.00", quantity_total=50, delivery_method="digital")
        n = Ticket.objects.count() + 1
        txn = Transaction.objects.create(customer=self.customer, amount=price, purpose="Event ticket", reference=f"EVT-{n}")
        return Ticket.objects.create(ticket_type=self.ticket_type, purchased_by=self.customer, transaction=txn, delivery_method="digital", price=price)


class OverviewTests(AccountingBase):
    def test_only_recorded_figures_and_the_unrecorded_are_named(self):
        self.sale("150.00")
        self.subscription("100.00")
        self.make_ticket("80.00")
        self.as_staff(self.accountant)
        body = self.client.get("/api/insights/accounting-overview/").json()
        self.assertEqual(body["tickets"]["held"], "80.00")
        self.assertEqual(body["revenue"]["total"], "100.00")
        self.assertEqual({t["key"]: t["amount"] for t in body["revenue"]["types"]}["subscriptions"], "100.00")
        self.assertEqual(body["chain"], {"checked": False})
        self.assertIn("Taxes due", [n["name"] for n in body["not_recorded"]])
        self.assertNotIn("owed", " ".join(body.keys()))

    def test_chain_result_is_the_stored_one(self):
        ChainCheck.objects.create(checked_at=timezone.now(), ok=True, events=42)
        self.as_staff(self.accountant)
        chain = self.client.get("/api/insights/accounting-overview/").json()["chain"]
        self.assertEqual((chain["checked"], chain["ok"], chain["events"]), (True, True, 42))

    def test_scouts_cannot_read_it(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/insights/accounting-overview/").status_code, 403)

    def test_it_is_a_pure_read_under_step_in_of_the_accountant(self):
        from accounts.authentication import issue_token

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.boss, 'staff', two_factor=True)}")
        started = self.client.post("/api/accounts/staff/view-as/", {"staff": self.accountant.pk}, format="json")
        self.assertIn(started.status_code, (200, 201))
        for path in ("accounting-overview/", "collections/", "money-alerts/"):
            before = ActivityEvent.objects.exclude(verb="view_as.page").count()
            response = self.client.get(f"/api/insights/{path}", HTTP_X_VIEW_AS=str(self.accountant.pk))
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(ActivityEvent.objects.exclude(verb="view_as.page").count(), before)


class CollectionsTests(AccountingBase):
    def setUp(self):
        super().setUp()
        self.sale("150.00")
        self.subscription("100.00")
        self.make_ticket("80.00")

    def get(self, query=""):
        today = timezone.localdate()
        return self.client.get(f"/api/insights/collections/?from={today.replace(day=1)}&to={today}{query}")

    def test_lists_payments_with_our_and_the_provider_reference(self):
        self.as_staff(self.accountant)
        body = self.get().json()
        self.assertTrue(body["simulated"])
        types = {r["type"] for r in body["rows"]}
        self.assertEqual(types, {"orders", "subscriptions"})
        row = next(r for r in body["rows"] if r["type"] == "orders")
        self.assertTrue(row["reference"].startswith("AH-ORDER_CHECKOUT-"))
        self.assertTrue(row["provider_reference"])
        self.assertEqual(row["payer"], "Ama Buyer")
        summary = {s["key"]: (s["count"], s["amount"]) for s in body["summary"]}
        self.assertEqual(summary["orders"], (1, "150.00"))
        self.assertEqual(summary["subscriptions"], (1, "100.00"))
        self.assertNotIn("delivery", " ".join(s["key"] for s in body["summary"]))

    def test_filters_by_type_and_search(self):
        self.as_staff(self.accountant)
        self.assertEqual({r["type"] for r in self.get("&kind=subscriptions").json()["rows"]}, {"subscriptions"})
        self.assertEqual(len(self.get("&q=Kofi").json()["rows"]), 1)
        self.assertEqual(self.get("&kind=nonsense").status_code, 400)
        self.assertEqual(self.get("&status=nonsense").status_code, 400)

    def test_a_file_names_payers_so_it_asks_for_the_password(self):
        self.as_staff(self.accountant)
        refused = self.get("&format=csv")
        self.assertEqual((refused.status_code, refused.json()["code"]), (403, "sudo_required"))
        self.as_staff(self.accountant, sudo=True)
        response = self.get("&format=csv")
        self.assertEqual(response.status_code, 200)
        text = b"".join(response.streaming_content if response.streaming else [response.content]).decode("utf-8")
        self.assertIn("Ama Buyer", text)
        self.assertTrue(ActivityEvent.objects.filter(verb="report.exported").exists())

    def test_scouts_cannot_read_it(self):
        self.as_staff(self.scout)
        self.assertEqual(self.get().status_code, 403)


class MoneyAlertTests(AccountingBase):
    def refund(self, amount, n=1):
        for _ in range(n):
            order = self.sale(amount)
            Dispute.objects.create(order=order, raised_by=self.customer, reason=Dispute.ORDER_ISSUE, description="x", status=Dispute.RESOLVED, refund_amount=Decimal(amount))

    def test_an_outlier_refund_and_a_repeat_business_are_found_and_nothing_else(self):
        self.refund("10.00", 3)
        self.refund("200.00")
        self.as_staff(self.accountant)
        body = self.client.get("/api/insights/money-alerts/").json()
        rules = sorted(a["rule"] for a in body["alerts"])
        self.assertIn("refund_outlier", rules)
        self.assertIn("repeat_refunds", rules)
        outlier = next(a for a in body["alerts"] if a["rule"] == "refund_outlier")
        self.assertIn("200.00", outlier["title"])
        live = {r["key"] for r in body["rules"] if r["live"]}
        self.assertEqual(live, {"refund_outlier", "repeat_refunds", "fraud_flag"})
        not_live = [r for r in body["rules"] if not r["live"]]
        self.assertTrue(all(r["what"].startswith("Needs") or "does not" in r["what"] or "not repeated" in r["what"] for r in not_live))

    def test_too_few_refunds_make_no_average(self):
        self.refund("10.00", 1)
        self.as_staff(self.accountant)
        self.assertEqual(self.client.get("/api/insights/money-alerts/").json()["alerts"], [])

    def test_a_fraud_case_shows_title_only_and_cannot_be_resolved_here(self):
        flag = FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.STAFF, title="Odd", detail="PRIVATE", evidence=["0207662001"], business_owner=self.owner)
        self.as_staff(self.accountant)
        body = self.client.get("/api/insights/money-alerts/").json()
        alert = next(a for a in body["alerts"] if a["rule"] == "fraud_flag")
        self.assertNotIn("PRIVATE", str(alert))
        self.assertNotIn("0207662001", str(alert))
        self.assertFalse(alert["resolvable"])
        response = self.client.post("/api/insights/money-alerts/", {"key": f"fraud_flag:{flag.pk}", "note": "looked at it"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_resolving_needs_a_note_and_is_recorded_once(self):
        self.refund("10.00", 3)
        self.as_staff(self.accountant)
        alert = next(a for a in self.client.get("/api/insights/money-alerts/").json()["alerts"] if a["rule"] == "repeat_refunds")
        self.assertEqual(self.client.post("/api/insights/money-alerts/", {"key": alert["key"], "note": "ok"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/insights/money-alerts/", {"key": "made-up", "note": "A real note"}, format="json").status_code, 400)
        response = self.client.post("/api/insights/money-alerts/", {"key": alert["key"], "note": "Checked with the seller"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        done = next(a for a in response.json()["alerts"] if a["key"] == alert["key"])
        self.assertEqual(done["resolved"]["note"], "Checked with the seller")
        self.assertEqual(ActivityEvent.objects.filter(verb="money_alert.resolved").count(), 1)
        again = self.client.post("/api/insights/money-alerts/", {"key": alert["key"], "note": "Checked again"}, format="json")
        self.assertEqual(again.status_code, 400)

    def test_scouts_cannot_read_or_resolve(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/insights/money-alerts/").status_code, 403)
        self.assertEqual(self.client.post("/api/insights/money-alerts/", {"key": "x", "note": "A real note"}, format="json").status_code, 403)


class EscrowSudoTests(AccountingBase):
    def post(self, action, ticket, body=None):
        return self.client.post(f"/api/events/tickets/{ticket.pk}/escrow/{action}/", body or {"note": "Checked"}, format="json")

    def test_release_and_refund_ask_for_the_password_again(self):
        ticket = self.make_ticket()
        self.as_staff(self.accountant)
        for action in ("release", "refund"):
            response = self.post(action, ticket)
            self.assertEqual((response.status_code, response.json()["code"]), (403, "sudo_required"), action)
        ticket.refresh_from_db()
        self.assertEqual((ticket.escrow_status, ticket.refunded_at), (Ticket.HELD, None))
        self.as_staff(self.accountant, sudo=True)
        self.assertEqual(self.post("release", ticket).status_code, 200)
        ticket.refresh_from_db()
        self.assertEqual(ticket.escrow_status, Ticket.RELEASED)

    def test_every_action_needs_a_note(self):
        ticket = self.make_ticket()
        self.as_staff(self.accountant, sudo=True)
        for action, body in (("release", {}), ("release", {"note": " "}), ("hold", {"note": "x"}), ("refund", {"reason": ""})):
            self.assertEqual(self.post(action, ticket, body or {"note": ""}).status_code, 400, action)
        ticket.refresh_from_db()
        self.assertEqual((ticket.escrow_status, ticket.refunded_at), (Ticket.HELD, None))
        self.assertEqual(self.post("release", ticket, {"note": "Event ran, organiser confirmed"}).status_code, 200)
        ticket.refresh_from_db()
        self.assertEqual(ticket.escrow_override_note, "Event ran, organiser confirmed")

    def test_a_ticket_is_refunded_once(self):
        ticket = self.make_ticket()
        self.as_staff(self.accountant, sudo=True)
        self.assertEqual(self.post("refund", ticket, {"reason": "Cancelled"}).status_code, 200)
        self.assertEqual(self.post("refund", ticket, {"reason": "Cancelled"}).status_code, 400)
        self.assertEqual(Transaction.objects.filter(status=Transaction.REFUNDED).count(), 1)

    def test_holding_back_needs_the_release_permission_not_a_password_prompt_first(self):
        ticket = self.make_ticket()
        self.as_staff(self.scout, sudo=True)
        self.assertEqual(self.post("release", ticket).status_code, 403)


class AccountantReportTests(AccountingBase):
    def test_sections_count_the_accountants_own_actions(self):
        order = self.sale("50.00")
        Dispute.objects.create(order=order, raised_by=self.customer, reason=Dispute.ORDER_ISSUE, description="x", status=Dispute.RESOLVED, refund_amount=Decimal("20.00"), resolved_by=self.accountant)
        ticket = self.make_ticket("80.00")
        Ticket.objects.filter(pk=ticket.pk).update(escrow_status=Ticket.RELEASED, escrow_released_at=timezone.now(), escrow_released_by_staff=self.accountant)
        today = timezone.localdate()
        sections = {s["key"]: {r["label"]: r["value"] for r in s["rows"]} for s in providers.generic_sections(self.accountant, today, today) + providers._ROLE_PROVIDERS["accountant"][0](self.accountant, today, today)}
        self.assertEqual(sections["disputes"]["Resolved with a refund"], 1)
        self.assertEqual(sections["disputes"]["Refunded through disputes (GH₵)"], "20.00")
        self.assertEqual(sections["escrow"]["Released by you"], 1)
        self.assertEqual(sections["escrow"]["Refunded by you"], 0)


class EscrowScreenTests(AccountingBase):
    def test_summary_counts_ticket_money_by_state_and_names_what_is_not_held(self):
        held, released, refunded, late = (self.make_ticket(p) for p in ("80.00", "50.00", "30.00", "20.00"))
        Ticket.objects.filter(pk=released.pk).update(escrow_status=Ticket.RELEASED, escrow_released_at=timezone.now())
        Ticket.objects.filter(pk=refunded.pk).update(refunded_at=timezone.now())
        Event.objects.filter(pk=self.ticket_type.event_id).update(event_date=timezone.now() - timedelta(days=1))
        self.as_staff(self.accountant)
        body = self.client.get("/api/events/tickets/escrow/summary/").json()
        self.assertEqual((body["held"]["amount"], body["held"]["count"]), ("100.00", 2))
        self.assertEqual((body["released"]["amount"], body["refunded"]["amount"]), ("50.00", "30.00"))
        self.assertEqual(body["held_after_event"]["count"], 2)
        self.assertIn("Orders and bookings", [n["name"] for n in body["not_recorded"]])
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/events/tickets/escrow/summary/").status_code, 403)

    def test_list_filters_by_state_and_search(self):
        a, b = self.make_ticket("80.00"), self.make_ticket("50.00")
        Ticket.objects.filter(pk=b.pk).update(refunded_at=timezone.now())
        self.as_staff(self.accountant)
        ids = lambda q: sorted(r["id"] for r in self.client.get(f"/api/events/tickets/escrow/{q}").json()["results"])
        self.assertEqual(ids("?state=held"), [a.pk])
        self.assertEqual(ids("?state=refunded"), [b.pk])
        self.assertEqual(ids("?q=Ama"), sorted([a.pk, b.pk]))
        self.assertEqual(ids("?q=nobody"), [])
        Event.objects.filter(pk=self.ticket_type.event_id).update(event_date=timezone.now() - timedelta(days=1))
        self.assertEqual(ids("?state=late"), [a.pk])


class PricingCountsTests(AccountingBase):
    def test_plan_and_tier_counts_come_from_records(self):
        from billing.models import Subscription, SubscriptionPlan
        from events.models import EventPricingTier

        plan = SubscriptionPlan.objects.first()
        Subscription.objects.create(business_owner=self.owner, plan=plan, cycle_months=1, is_trial=False, status=Subscription.ACTIVE, current_period_start=timezone.now(), current_period_end=timezone.now() + timedelta(days=30))
        self.make_ticket()
        Event.objects.filter(pk=self.ticket_type.event_id).update(visibility_days=30, paid_at=timezone.now())
        self.as_staff(self.accountant)
        plans = {p["id"]: p for p in self.client.get("/api/billing/plans/manage/").json()}
        self.assertEqual(plans[plan.pk]["paying_businesses"], 1)
        tiers = {t["duration_days"]: t for t in self.client.get("/api/events/pricing-tiers/manage/").json()}
        self.assertEqual(tiers[30]["events_paid_90d"], 1)
        self.assertEqual(tiers[7]["events_paid_90d"], 0)
