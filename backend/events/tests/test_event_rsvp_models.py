from django.db import IntegrityError, transaction as db_transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import Customer
from listings.models import Category, Zone

from events.models import Event, EventRSVP


class EventRSVPModelTests(TestCase):
    """Model-level correctness for Phase 7's EventRSVP
    (docs/BUSINESS_EVENTS_ROADMAP.md): unique_together enforcement, and
    going_count staying in sync on create/cancel/re-RSVP via
    Event.sync_going_count().
    """

    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200779911", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200779922", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        self.event = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
        )

    def test_status_defaults_to_going(self):
        rsvp = EventRSVP.objects.create(event=self.event, customer=self.other_customer)
        self.assertEqual(rsvp.status, EventRSVP.GOING)

    def test_str_includes_customer_and_event_name(self):
        rsvp = EventRSVP.objects.create(event=self.event, customer=self.other_customer)
        text = str(rsvp)
        self.assertIn(self.other_customer.full_name, text)
        self.assertIn(self.event.name, text)

    def test_unique_together_rejects_duplicate_event_customer_row(self):
        EventRSVP.objects.create(event=self.event, customer=self.other_customer)
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                EventRSVP.objects.create(event=self.event, customer=self.other_customer)

    def test_same_customer_can_rsvp_to_different_events(self):
        other_event = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Manhyia Durbar", description="x", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=10), visibility_days=14,
        )
        EventRSVP.objects.create(event=self.event, customer=self.other_customer)
        EventRSVP.objects.create(event=other_event, customer=self.other_customer)
        self.assertEqual(EventRSVP.objects.filter(customer=self.other_customer).count(), 2)

    # -- Event.sync_going_count --

    def test_going_count_starts_at_zero(self):
        self.assertEqual(self.event.going_count, 0)

    def test_sync_going_count_after_create(self):
        EventRSVP.objects.create(event=self.event, customer=self.other_customer)
        self.event.sync_going_count()
        self.event.refresh_from_db()
        self.assertEqual(self.event.going_count, 1)

    def test_sync_going_count_ignores_cancelled_rows(self):
        EventRSVP.objects.create(
            event=self.event, customer=self.other_customer, status=EventRSVP.CANCELLED,
        )
        self.event.sync_going_count()
        self.event.refresh_from_db()
        self.assertEqual(self.event.going_count, 0)

    def test_sync_going_count_after_cancel(self):
        rsvp = EventRSVP.objects.create(event=self.event, customer=self.other_customer)
        self.event.sync_going_count()
        self.event.refresh_from_db()
        self.assertEqual(self.event.going_count, 1)

        rsvp.status = EventRSVP.CANCELLED
        rsvp.save(update_fields=["status"])
        self.event.sync_going_count()
        self.event.refresh_from_db()
        self.assertEqual(self.event.going_count, 0)

    def test_sync_going_count_after_re_rsvp(self):
        rsvp = EventRSVP.objects.create(
            event=self.event, customer=self.other_customer, status=EventRSVP.CANCELLED,
        )
        self.event.sync_going_count()
        self.event.refresh_from_db()
        self.assertEqual(self.event.going_count, 0)

        rsvp.status = EventRSVP.GOING
        rsvp.save(update_fields=["status"])
        self.event.sync_going_count()
        self.event.refresh_from_db()
        self.assertEqual(self.event.going_count, 1)

    def test_sync_going_count_reflects_multiple_attendees(self):
        third_customer = Customer.objects.create(
            full_name="Kwame Buyer", phone="+233200779933", password_hash="x",
        )
        EventRSVP.objects.create(event=self.event, customer=self.other_customer)
        EventRSVP.objects.create(event=self.event, customer=third_customer)
        self.event.sync_going_count()
        self.event.refresh_from_db()
        self.assertEqual(self.event.going_count, 2)

    def test_capacity_defaults_to_none(self):
        self.assertIsNone(self.event.capacity)
