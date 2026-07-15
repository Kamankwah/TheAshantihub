from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from accounts.models import Customer
from listings.models import Category, Zone

from events.models import Event


class ExpireEventsCommandTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200774411", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        self.now = timezone.now()

    def _make_event(self, **overrides):
        kwargs = dict(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=self.now + timezone.timedelta(days=30), visibility_days=14,
        )
        kwargs.update(overrides)
        return Event.objects.create(**kwargs)

    def test_past_expiry_approved_event_becomes_expired(self):
        event = self._make_event(
            status=Event.APPROVED, paid_at=self.now - timezone.timedelta(days=20),
            expires_at=self.now - timezone.timedelta(days=1),
        )
        call_command("expire_events", stdout=StringIO())
        event.refresh_from_db()
        self.assertEqual(event.status, Event.EXPIRED)

    def test_soft_hide_does_not_delete_the_row_or_media(self):
        event = self._make_event(
            status=Event.APPROVED, paid_at=self.now - timezone.timedelta(days=20),
            expires_at=self.now - timezone.timedelta(days=1),
        )
        call_command("expire_events", stdout=StringIO())
        self.assertTrue(Event.objects.filter(pk=event.pk).exists())

    def test_not_yet_expired_approved_event_is_untouched(self):
        event = self._make_event(
            status=Event.APPROVED, paid_at=self.now, expires_at=self.now + timezone.timedelta(days=5),
        )
        call_command("expire_events", stdout=StringIO())
        event.refresh_from_db()
        self.assertEqual(event.status, Event.APPROVED)

    def test_approved_but_never_paid_event_is_untouched(self):
        event = self._make_event(status=Event.APPROVED)
        call_command("expire_events", stdout=StringIO())
        event.refresh_from_db()
        self.assertEqual(event.status, Event.APPROVED)

    def test_pending_event_is_untouched(self):
        event = self._make_event(status=Event.PENDING)
        call_command("expire_events", stdout=StringIO())
        event.refresh_from_db()
        self.assertEqual(event.status, Event.PENDING)

    def test_already_expired_event_stays_expired(self):
        event = self._make_event(
            status=Event.EXPIRED, paid_at=self.now - timezone.timedelta(days=40),
            expires_at=self.now - timezone.timedelta(days=30),
        )
        call_command("expire_events", stdout=StringIO())
        event.refresh_from_db()
        self.assertEqual(event.status, Event.EXPIRED)

    def test_rejected_event_is_untouched(self):
        event = self._make_event(status=Event.REJECTED, rejection_reason="Not enough info")
        call_command("expire_events", stdout=StringIO())
        event.refresh_from_db()
        self.assertEqual(event.status, Event.REJECTED)

    def test_command_reports_count_of_expired_events(self):
        self._make_event(
            status=Event.APPROVED, paid_at=self.now - timezone.timedelta(days=20),
            expires_at=self.now - timezone.timedelta(days=1),
        )
        out = StringIO()
        call_command("expire_events", stdout=out)
        self.assertIn("Expired 1 event", out.getvalue())
