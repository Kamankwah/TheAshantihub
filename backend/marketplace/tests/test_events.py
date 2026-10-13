from datetime import timedelta

from django.utils import timezone

from billing.models import Transaction
from events.models import Event, EventTicketType, Ticket
from listings.models import Category, Zone

from .base import MarketplaceTestCase, make_customer


class EventOversightTests(MarketplaceTestCase):
    def setUp(self):
        super().setUp()
        self.buyer = make_customer("Abena Mensah")
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        now = timezone.now()
        self.live = self.make_event("Akwasidae palace visit", event_date=now + timedelta(days=5), paid_at=now, expires_at=now + timedelta(days=14))
        self.ended = self.make_event("Kente Festival day trip", event_date=now - timedelta(days=3), paid_at=now - timedelta(days=20), expires_at=now - timedelta(days=1))
        self.waiting = self.make_event("Rooftop comedy night", status=Event.PENDING, event_date=now + timedelta(days=9))
        self.type = EventTicketType.objects.create(event=self.live, name="Regular", price="80.00", quantity_total=50, delivery_method="digital")
        self.ended_type = EventTicketType.objects.create(event=self.ended, name="Seat", price="120.00", quantity_total=60, delivery_method="digital")
        self.held = self.ticket(self.type, "80.00")
        self.ticket(self.type, "80.00")
        self.released = self.ticket(self.ended_type, "120.00", released=True)
        self.refunded = self.ticket(self.ended_type, "120.00", refunded=True)
        self.sign_in()

    def make_event(self, name, **fields):
        values = dict(
            category=self.category, zone=self.zone, submitted_by_business=self.business, name=name, description="D.",
            address="Manhyia", event_date=timezone.now() + timedelta(days=5), visibility_days=14, status=Event.APPROVED,
        )
        values.update(fields)
        return Event.objects.create(**values)

    def ticket(self, ticket_type, price, *, released=False, refunded=False):
        number = Ticket.objects.count() + 1
        txn = Transaction.objects.create(customer=self.buyer, amount=price, purpose="Event ticket", reference=f"EVT-{number}")
        extra = {}
        if released:
            extra.update(escrow_status=Ticket.RELEASED, escrow_released_at=timezone.now(), delivered_at=timezone.now())
        if refunded:
            extra.update(refunded_at=timezone.now(), refund_reason="Cancelled")
        return Ticket.objects.create(ticket_type=ticket_type, purchased_by=self.buyer, transaction=txn, delivery_method="digital", price=price, **extra)

    def rows(self, query=""):
        response = self.client.get(f"/api/marketplace/events/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return {row["name"]: row for row in response.json()["results"]}

    def test_money_is_split_by_the_tickets_own_escrow_state(self):
        live = self.rows()["Akwasidae palace visit"]
        self.assertEqual((live["tickets_sold"], live["capacity"], live["sales"], live["held"], live["released"]), (2, 50, "160.00", "160.00", "0.00"))
        ended = self.rows()["Kente Festival day trip"]
        self.assertEqual((ended["tickets_sold"], ended["sales"], ended["released"], ended["refunded"], ended["refunded_count"]), (1, "120.00", "120.00", "120.00", 1))
        self.assertEqual(ended["checked_in"], 1)

    def test_states_and_filters(self):
        rows = self.rows()
        self.assertEqual(rows["Akwasidae palace visit"]["state"], "on_sale")
        self.assertEqual(rows["Kente Festival day trip"]["state"], "ended")
        self.assertEqual(rows["Rooftop comedy night"]["state"], "waiting")
        self.assertEqual(set(self.rows("?show=on_sale")), {"Akwasidae palace visit"})
        self.assertEqual(set(self.rows("?show=ended")), {"Kente Festival day trip"})
        self.assertEqual(set(self.rows("?show=waiting")), {"Rooftop comedy night"})
        self.assertEqual(len(self.rows(f"?business={self.business.pk}")), 3)
        self.assertEqual(len(self.rows("?business=999999")), 0)

    def test_header_counts(self):
        body = self.client.get("/api/marketplace/events/counts/").json()
        self.assertEqual(body["on_sale"], 1)
        self.assertEqual((body["tickets_sold"], body["capacity"]), (2, 50))
        self.assertEqual(body["held"], "160.00")
        self.assertEqual(body["waiting_for_review"], 1)
        self.assertEqual(body["refunded_this_quarter"], "120.00")

    def test_export_has_totals_and_no_buyers(self):
        text = b"".join(self.client.get("/api/marketplace/events/export/").streaming_content).decode("utf-8-sig")
        self.assertIn("Akwasidae palace visit", text)
        self.assertNotIn("Abena", text)

    def test_needs_an_escrow_or_event_permission(self):
        self.sign_in(self.support)
        self.assertEqual(self.client.get("/api/marketplace/events/").status_code, 403)
