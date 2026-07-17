from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import Category, Zone

from events.models import Event, EventPricingTier


class EventEditRenewTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Organizer", phone="+233200774411", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Other", phone="+233200774422", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        # A pricing tier so renewal has a price to charge.
        self.tier, _ = EventPricingTier.objects.get_or_create(
            duration_days=30, defaults={"live_price": Decimal("50.00"), "pending_price": None},
        )

    def _event(self, **overrides):
        kwargs = dict(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae", description="Durbar.", address="Palace",
            event_date=timezone.now() + timedelta(days=30), visibility_days=30,
            status=Event.APPROVED,
        )
        kwargs.update(overrides)
        return Event.objects.create(**kwargs)

    def _auth(self, account, kind="customer"):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")


class EventEditTests(EventEditRenewTestsBase):
    def test_editing_an_approved_event_sends_it_back_to_pending_but_keeps_payment(self):
        now = timezone.now()
        event = self._event(status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=30))
        self._auth(self.customer)
        response = self.client.patch(
            f"/api/events/mine/{event.id}/", {"name": "Akwasidae 2026", "description": "Updated durbar."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        event.refresh_from_db()
        self.assertEqual(event.name, "Akwasidae 2026")
        self.assertEqual(event.status, Event.PENDING)  # re-approval needed
        self.assertIsNotNone(event.paid_at)  # but payment kept — no re-pay
        self.assertIsNotNone(event.expires_at)

    def test_editing_a_rejected_event_returns_it_to_pending_and_clears_the_reason(self):
        event = self._event(status=Event.REJECTED, rejection_reason="Too vague")
        self._auth(self.customer)
        response = self.client.patch(
            f"/api/events/mine/{event.id}/", {"description": "Much more detail now."}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        event.refresh_from_db()
        self.assertEqual(event.status, Event.PENDING)
        self.assertIsNone(event.rejection_reason)

    def test_edit_cannot_change_visibility_days(self):
        event = self._event()
        self._auth(self.customer)
        self.client.patch(f"/api/events/mine/{event.id}/", {"visibility_days": 90}, format="json")
        event.refresh_from_db()
        self.assertEqual(event.visibility_days, 30)  # unchanged — renewal's job

    def test_another_user_cannot_edit_your_event(self):
        event = self._event()
        self._auth(self.other_customer)
        response = self.client.patch(f"/api/events/mine/{event.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, 403)


class EventRenewTests(EventEditRenewTestsBase):
    def test_renewing_a_live_event_extends_expiry_from_current_expiry(self):
        now = timezone.now()
        expiry = now + timedelta(days=5)
        event = self._event(status=Event.APPROVED, paid_at=now, expires_at=expiry)
        self._auth(self.customer)
        response = self.client.post(f"/api/events/{event.id}/renew/", {"additional_days": 30}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        event.refresh_from_db()
        # Extended from the existing (future) expiry, not from now.
        self.assertAlmostEqual(
            (event.expires_at - expiry).total_seconds(), timedelta(days=30).total_seconds(), delta=5,
        )

    def test_renewing_an_expired_event_extends_from_now_and_relists_it(self):
        now = timezone.now()
        event = self._event(status=Event.EXPIRED, paid_at=now - timedelta(days=40), expires_at=now - timedelta(days=5))
        self._auth(self.customer)
        response = self.client.post(f"/api/events/{event.id}/renew/", {"additional_days": 30}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        event.refresh_from_db()
        self.assertEqual(event.status, Event.APPROVED)  # un-expired
        self.assertGreater(event.expires_at, now + timedelta(days=29))  # extended from now

    def test_renew_days_must_match_a_pricing_tier(self):
        now = timezone.now()
        event = self._event(status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=5))
        self._auth(self.customer)
        response = self.client.post(f"/api/events/{event.id}/renew/", {"additional_days": 13}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_cannot_renew_an_unpaid_event(self):
        event = self._event(status=Event.APPROVED, paid_at=None, expires_at=None)
        self._auth(self.customer)
        response = self.client.post(f"/api/events/{event.id}/renew/", {"additional_days": 30}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_another_user_cannot_renew_your_event(self):
        now = timezone.now()
        event = self._event(status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=5))
        self._auth(self.other_customer)
        response = self.client.post(f"/api/events/{event.id}/renew/", {"additional_days": 30}, format="json")
        self.assertEqual(response.status_code, 403)
