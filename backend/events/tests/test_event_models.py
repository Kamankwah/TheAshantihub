from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction as db_transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from listings.models import Category, Zone

from events.models import Event


class EventModelTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200771122", password_hash="x",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207771122", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")

    def _make(self, **overrides):
        kwargs = dict(
            category=self.category, zone=self.zone,
            submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar at Manhyia Palace.",
            address="Manhyia Palace, Kumasi", event_date=timezone.now() + timezone.timedelta(days=30),
            visibility_days=14,
        )
        kwargs.update(overrides)
        return Event(**kwargs)

    def test_access_code_is_always_generated_on_create(self):
        event = self._make()
        event.full_clean(exclude=["access_code"])
        event.save()
        self.assertTrue(event.access_code)
        self.assertGreaterEqual(len(event.access_code), 6)

    def test_access_code_is_generated_even_for_public_events(self):
        event = self._make(access_level=Event.PUBLIC)
        event.save()
        self.assertTrue(event.access_code)

    def test_access_codes_are_unique_across_events(self):
        first = self._make(name="First")
        first.save()
        second = self._make(name="Second", submitted_by_customer=None, submitted_by_business=self.owner)
        second.save()
        self.assertNotEqual(first.access_code, second.access_code)

    def test_status_defaults_to_pending(self):
        event = self._make()
        event.save()
        self.assertEqual(event.status, Event.PENDING)

    def test_access_level_defaults_to_public(self):
        event = self._make()
        event.save()
        self.assertEqual(event.access_level, Event.PUBLIC)

    def test_going_count_defaults_to_zero(self):
        event = self._make()
        event.save()
        self.assertEqual(event.going_count, 0)

    def test_paid_at_expires_at_approved_by_default_unset(self):
        event = self._make()
        event.save()
        self.assertIsNone(event.paid_at)
        self.assertIsNone(event.expires_at)
        self.assertIsNone(event.approved_by)

    def test_str_includes_name_and_status(self):
        event = self._make()
        event.save()
        self.assertIn(event.name, str(event))
        self.assertIn(event.status, str(event))

    def test_ordering_is_most_recently_created_first(self):
        older = self._make(name="Older")
        older.save()
        newer = self._make(name="Newer", submitted_by_customer=None, submitted_by_business=self.owner)
        newer.save()
        self.assertEqual(list(Event.objects.all())[:2], [newer, older])

    # -- exactly-one-submitter validation --

    def test_clean_rejects_neither_submitter_set(self):
        event = self._make(submitted_by_customer=None)
        with self.assertRaises(ValidationError):
            event.clean()

    def test_clean_rejects_both_submitters_set(self):
        event = self._make(submitted_by_business=self.owner)
        with self.assertRaises(ValidationError):
            event.clean()

    def test_clean_allows_only_customer_set(self):
        event = self._make(submitted_by_customer=self.customer)
        event.clean()  # should not raise

    def test_clean_allows_only_business_set(self):
        event = self._make(submitted_by_customer=None, submitted_by_business=self.owner)
        event.clean()  # should not raise

    def test_db_constraint_rejects_neither_submitter_set(self):
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Event.objects.create(
                    category=self.category, zone=self.zone,
                    name="Bad", description="x", address="x",
                    event_date=timezone.now() + timezone.timedelta(days=10), visibility_days=14,
                )

    def test_db_constraint_rejects_both_submitters_set(self):
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Event.objects.create(
                    category=self.category, zone=self.zone,
                    submitted_by_customer=self.customer, submitted_by_business=self.owner,
                    name="Bad", description="x", address="x",
                    event_date=timezone.now() + timezone.timedelta(days=10), visibility_days=14,
                )

    # -- visibility_days range --

    def test_visibility_days_below_minimum_rejected_by_full_clean(self):
        event = self._make(visibility_days=6)
        with self.assertRaises(ValidationError):
            event.full_clean(exclude=["access_code"])

    def test_visibility_days_above_maximum_rejected_by_full_clean(self):
        event = self._make(visibility_days=91)
        with self.assertRaises(ValidationError):
            event.full_clean(exclude=["access_code"])

    def test_visibility_days_at_boundaries_accepted(self):
        low = self._make(visibility_days=7)
        low.full_clean(exclude=["access_code"])
        high = self._make(
            name="High", visibility_days=90,
            submitted_by_customer=None, submitted_by_business=self.owner,
        )
        high.full_clean(exclude=["access_code"])

    # -- is_live --

    def test_is_live_false_when_pending(self):
        event = self._make()
        event.save()
        self.assertFalse(event.is_live)

    def test_is_live_true_when_approved_paid_and_unexpired(self):
        now = timezone.now()
        event = self._make(
            status=Event.APPROVED, paid_at=now, expires_at=now + timezone.timedelta(days=5),
        )
        event.save()
        self.assertTrue(event.is_live)

    def test_is_live_false_when_approved_but_unpaid(self):
        event = self._make(status=Event.APPROVED)
        event.save()
        self.assertFalse(event.is_live)

    def test_is_live_false_when_expired(self):
        now = timezone.now()
        event = self._make(
            status=Event.APPROVED, paid_at=now - timezone.timedelta(days=20),
            expires_at=now - timezone.timedelta(days=1),
        )
        event.save()
        self.assertFalse(event.is_live)
