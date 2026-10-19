"""Plan 7F-C, task 2: a cancelled event tells each buyer once (how much went back to their wallet, or that Support will
refund them) and the organiser once; no text carries a phone number; a notice never breaks the cancel."""
from unittest import mock

from django.test import override_settings

from accounts.models import Customer
from events import cancel_notice, cancellation
from events.models import Event
from ledger.tests.booking_helpers import BookingBase
from notifications.models import Notification

REASON = {"reason": "The venue flooded"}


@override_settings(LEDGER_ENABLED=True)
class CancelNoticeTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.buyer2 = Customer.objects.create(full_name="Yaw Boateng", phone="+233200770002", password_hash="x")

    def cancel(self):
        self.as_owner()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(f"/api/events/mine/{self.event.pk}/cancel/", REASON, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        return response

    def notices(self, **who):
        return Notification.objects.filter(kind=cancel_notice.KIND, **who)

    def test_notice_one_per_buyer_and_one_to_organiser(self):
        self.paid_tickets(quantity=2)                         # two tickets, one buyer
        self.as_customer(self.buyer2)
        response = self.client.post(
            f"/api/events/{self.event.pk}/tickets/purchase/", {"ticket_type": self.ticket_type.pk, "quantity": 1}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.cancel()

        first = self.notices(customer=self.customer)
        self.assertEqual(first.count(), 1)
        self.assertEqual(first.get().body, "“Highlife Night” was cancelled. GH₵ 100.00 went back to your AshantiHub wallet.")
        second = self.notices(customer=self.buyer2)
        self.assertEqual(second.count(), 1)
        self.assertIn("GH₵ 50.00 went back to your AshantiHub wallet", second.get().body)
        organiser = self.notices(business_owner=self.owner)
        self.assertEqual(organiser.count(), 1)
        self.assertIn("3 tickets refunded in full from your account", organiser.get().body)

    def test_notice_has_no_phone_number(self):
        Event.objects.filter(pk=self.event.pk).update(name="Call 0244123456 Night")
        self.event.refresh_from_db()
        self.paid_tickets(quantity=1)
        self.cancel()
        bodies = list(self.notices().values_list("body", flat=True))
        self.assertEqual(len(bodies), 2)
        for body in bodies:
            self.assertNotIn("0244123456", body)
            self.assertNotIn("244123456", body)
            self.assertIn("*******456", body)

    def test_notice_never_breaks_the_cancel(self):
        self.paid_tickets(quantity=1)
        with mock.patch("notifications.services.notify_customer", side_effect=RuntimeError("down")):
            self.cancel()
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, Event.CANCELLED)

    def test_partly_refunded_sale_refunds_what_is_left_and_settles(self):
        """Follow-up (c): a sale partly refunded before the cancel gives each ticket at most what is left, so nothing
        raises RefundError and nothing is left for the sweep to retry forever."""
        from ledger import sales

        sale = self.paid_tickets(quantity=2)
        sales.refund(sale, 7000, source="dispute-1", note="Partial dispute refund")   # GH₵ 70 of 100 already back
        result = cancellation.cancel_event(self.event, by=self.owner, reason="Rain")
        self.assertEqual((result.tickets_refunded, result.tickets_left), (2, 0))
        from ledger.models import Account

        self.assertEqual(self.balance(Account.CUSTOMER_WALLET, self.customer), 10000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)

    def _scan_all(self):
        from django.utils import timezone

        from events.models import Ticket

        Ticket.objects.filter(ticket_type__event=self.event).update(delivered_at=timezone.now())

    def test_nothing_left_on_sale_says_already_returned(self):
        """Fix round 1: a ticket that got 0 because an earlier refund emptied its sale is not told the money went to the
        wallet now, nor that Support will refund it."""
        from ledger import sales

        sale = self.paid_tickets(quantity=2)
        self._scan_all()                                    # scanned: the emptying refund does not mark them refunded
        sales.refund(sale, None, source="dispute-1", note="Whole dispute refund")
        self.cancel()
        body = self.notices(customer=self.customer).get().body
        self.assertEqual(
            body,
            "“Highlife Night” was cancelled. Your payment was already returned to you by an earlier refund, so nothing "
            "more goes to your wallet.",
        )

    def test_partly_left_says_amount_and_rest_already_returned(self):
        from ledger import sales

        sale = self.paid_tickets(quantity=2)
        self._scan_all()
        sales.refund(sale, 7000, source="dispute-1", note="Partial dispute refund")   # GH₵ 30 left
        self.cancel()
        body = self.notices(customer=self.customer).get().body
        self.assertEqual(
            body,
            "“Highlife Night” was cancelled. GH₵ 30.00 went back to your AshantiHub wallet. The rest of your payment was "
            "already returned to you by an earlier refund, so nothing more goes to your wallet.",
        )
        self.assertNotIn("Support will refund", body)

    def test_customer_organised_event_organiser_not_told_money_left_account(self):
        from datetime import timedelta
        from decimal import Decimal

        from django.utils import timezone

        from accounts.authentication import issue_token
        from events.models import EventTicketType

        organiser = Customer.objects.create(full_name="Efua Organiser", phone="+233200770003", password_hash="x")
        now = timezone.now()
        event = Event.objects.create(
            category=self.event.category, zone=self.zone, submitted_by_customer=organiser, name="Street Party",
            description="Music.", address="Kumasi", event_date=now + timedelta(days=10), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        ticket_type = EventTicketType.objects.create(event=event, name="Entry", price=Decimal("20.00"))
        self.assertEqual(self.buy_tickets(quantity=1, event=event, ticket_type=ticket_type).status_code, 201)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(organiser, 'customer')}")
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(f"/api/events/mine/{event.pk}/cancel/", REASON, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = self.notices(customer=organiser).get().body
        self.assertNotIn("from your account", body)
        self.assertIn("1 ticket marked refunded. No money left your account", body)
        self.assertEqual(self.notices(customer=self.customer).get().body, "“Street Party” was cancelled. Support will refund you.")
