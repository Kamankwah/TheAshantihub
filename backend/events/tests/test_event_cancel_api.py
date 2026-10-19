"""Plan 7F-C, task 2: the organiser and Operations cancel an event through the API; every ticket is refunded in full from
the organiser's side. Also the follow-ups: a purchase racing a cancel answers 409, a reject locks the event row, and a
cancel with the ledger off writes only the REFUNDED billing rows and the ticket marks."""
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.testing import make_staff
from activity.models import ActivityEvent
from billing.models import Transaction
from events import cancellation
from events.models import Event, Ticket
from ledger.models import Account, BookingRefund
from ledger.tests.booking_helpers import BookingBase
from notifications.models import Notification
from payments.models import CheckoutSession

REASON = {"reason": "The venue flooded"}


@override_settings(LEDGER_ENABLED=True)
class EventCancelApiTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.ops = make_staff("operations", "ops-7fc2@example.com")

    def owner_cancel(self, body=REASON, event=None):
        self.as_owner()
        return self.client.post(f"/api/events/mine/{(event or self.event).pk}/cancel/", body, format="json")

    def staff_cancel(self, staff=None, sudo=True, body=REASON):
        self.as_staff(staff or self.ops, sudo=sudo)
        return self.client.post(f"/api/events/moderation/{self.event.pk}/cancel/", body, format="json")

    def test_owner_cancel_200_and_refunds(self):
        self.paid_tickets(quantity=2)
        response = self.owner_cancel()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"status": "cancelled", "tickets_refunded": 2, "tickets_left": 0})
        self.event.refresh_from_db()
        self.assertEqual((self.event.status, self.event.cancel_reason), (Event.CANCELLED, "The venue flooded"))
        self.assertIsNone(self.event.cancelled_by_staff)
        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 10000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        mine = self.client.get("/api/events/mine/").json()
        row = next(e for e in (mine["results"] if isinstance(mine, dict) else mine) if e["id"] == self.event.pk)
        self.assertEqual((row["status"], row["cancel_reason"]), ("cancelled", "The venue flooded"))
        self.assertIsNotNone(row["cancelled_at"])

    def test_other_business_cannot_cancel_404_or_403(self):
        other = BusinessOwner.objects.create(full_name="Akua Other", login_phone="+233207770009", password_hash="x")
        from accounts.authentication import issue_token

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(other, 'business_owner')}")
        response = self.client.post(f"/api/events/mine/{self.event.pk}/cancel/", REASON, format="json")
        self.assertIn(response.status_code, (403, 404))
        self.as_customer()
        response = self.client.post(f"/api/events/mine/{self.event.pk}/cancel/", REASON, format="json")
        self.assertIn(response.status_code, (403, 404))
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.APPROVED)

    def test_staff_cancel_needs_sudo(self):
        self.paid_tickets(quantity=1)
        response = self.staff_cancel(sudo=False)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "sudo_required")
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.APPROVED)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.staff_cancel(sudo=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"status": "cancelled", "tickets_refunded": 1, "tickets_left": 0})
        self.event.refresh_from_db()
        self.assertEqual(self.event.cancelled_by_staff, self.ops)
        events = ActivityEvent.objects.filter(verb="event.cancelled", target_id=str(self.event.pk))
        self.assertEqual(events.count(), 1)
        self.assertEqual(events.get().after["tickets_refunded"], 1)

    def test_staff_cancel_without_event_approve_403(self):
        support = make_staff("support", "support-7fc2@example.com")
        self.assertNotIn("event.approve", support.effective_permission_codenames())
        response = self.staff_cancel(staff=support, sudo=True)
        self.assertEqual(response.status_code, 403, response.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.APPROVED)

    def test_reason_required(self):
        for body in ({}, {"reason": "   "}, {"reason": "abcd"}, {"reason": "x" * 301}):
            response = self.owner_cancel(body)
            self.assertEqual(response.status_code, 400, body)
            self.assertEqual(response.json()["code"], "reason_required")
        response = self.staff_cancel(body={"reason": "no"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "reason_required")
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.APPROVED)

    def test_repeat_cancel_same_body(self):
        self.paid_tickets(quantity=2)
        first = self.owner_cancel()
        again = self.owner_cancel({"reason": "Another reason"})
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(again.json(), first.json())
        self.assertEqual(BookingRefund.objects.count(), 2)
        self.event.refresh_from_db()
        self.assertEqual(self.event.cancel_reason, "The venue flooded")

    def test_repeat_cancel_sends_no_second_organiser_notice(self):
        self.paid_tickets(quantity=1)
        with self.captureOnCommitCallbacks(execute=True):
            self.owner_cancel()
        with self.captureOnCommitCallbacks(execute=True):
            self.owner_cancel()
        self.assertEqual(Notification.objects.filter(business_owner=self.owner, kind="event_cancelled").count(), 1)
        self.assertEqual(Notification.objects.filter(customer=self.customer, kind="event_cancelled").count(), 1)

    def test_owner_cannot_cancel_after_the_event_date(self):
        Event.objects.filter(pk=self.event.pk).update(event_date=timezone.now() - timedelta(hours=1))
        response = self.owner_cancel()
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "event_already_held")
        self.assertEqual(self.staff_cancel().status_code, 200)

    def test_purchase_racing_a_cancel_answers_409(self):
        def cancelled(*args, **kwargs):
            raise cancellation.EventCancelledError("cancelled meanwhile")

        with mock.patch.dict("payments.services.FINALIZERS", {CheckoutSession.TICKET_PURCHASE: cancelled}):
            response = self.buy_tickets(quantity=2)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "event_cancelled")
        self.ticket_type.refresh_from_db()
        self.assertEqual(self.ticket_type.quantity_sold, 0)
        self.assertFalse(Ticket.objects.exists())

    def test_reject_locks_the_event_row(self):
        self.as_staff(self.ops)
        with mock.patch("events.views.Event.objects.select_for_update", wraps=Event.objects.select_for_update) as locked:
            response = self.client.post(f"/api/events/moderation/{self.event.pk}/reject/", {"reason": "No."}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(locked.called)


class EventCancelLedgerOffTests(BookingBase):
    """With the ledger off a cancel moves no money: each ticket gets today's REFUNDED billing row and its marks, and the
    buyer is told Support will refund them. The endpoint is not gated on the ledger (the status change is not money)."""

    def test_cancel_with_ledger_off_writes_only_refunded_rows(self):
        self.as_customer()
        response = self.buy_tickets(quantity=2)
        self.assertEqual(response.status_code, 201, response.content)
        self.as_owner()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(f"/api/events/mine/{self.event.pk}/cancel/", REASON, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"status": "cancelled", "tickets_refunded": 2, "tickets_left": 0})
        self.assertFalse(BookingRefund.objects.exists())
        self.assertEqual(Transaction.objects.filter(status=Transaction.REFUNDED, customer=self.customer).count(), 2)
        self.assertFalse(Ticket.objects.filter(refunded_at__isnull=True).exists())
        notice = Notification.objects.get(customer=self.customer, kind="event_cancelled")
        self.assertIn("Support will refund you", notice.body)
        self.assertNotIn("wallet", notice.body)
        organiser = Notification.objects.get(business_owner=self.owner, kind="event_cancelled")
        self.assertNotIn("from your account", organiser.body)
        self.assertIn("2 tickets marked refunded. No money left your account", organiser.body)
