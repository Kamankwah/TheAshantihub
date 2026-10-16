"""Release of a booking's money on Support's verification call (Plan 1b, Task 5; spec §4.2): what "handed over" means for
each kind, the receipt confirmation, the mismatch dispute, and tickets' escrow flags following the sale. Review Focus 3
(release refused before hand-over and while a dispute is open)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from bookings.models import Booking
from disputes.models import Dispute
from events.models import Event, Ticket
from ledger import sales
from ledger.models import Account, Journal
from ledger.verification import VerificationError
from services.models import ServiceRequest

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class BookingReleaseTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-1b@example.com")

    def call(self, sale, outcome, **extra):
        return sales.record_verification(sale, self.support, outcome, **extra)

    def complete(self, sale, at=None):
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(
            status=ServiceRequest.COMPLETED, completed_at=at or timezone.now(),
        )

    def test_a_service_is_released_once_done_and_confirmed_fee_first(self):
        sale = self.paid_service("200.00")
        with self.assertRaisesMessage(VerificationError, "The business has not marked this service done yet."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.complete(sale)
        with self.assertRaisesMessage(VerificationError, "Record the customer's confirmation first."):
            self.call(sale, "matches")
        sale = self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertIsNotNone(sale.released_at)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 19500)            # 200.00 − GH₵ 5.00
        self.assertEqual(self.balance(Account.PLATFORM_FEE_INCOME), 500)
        kinds = [line.account.kind for line in Journal.objects.get(key=f"booking-release-{sale.pk}").lines.order_by("id")]
        self.assertEqual(kinds, [Account.VENDOR_PENDING, Account.PLATFORM_FEE_INCOME, Account.VENDOR_AVAILABLE])
        with self.assertRaisesMessage(VerificationError, "already been released"):
            self.call(sale, "matches")

    def test_a_stay_is_handed_over_at_check_in(self):
        sale = self.paid_stay(nights=2)                                                         # GH₵ 300.00
        with self.assertRaisesMessage(VerificationError, "The guest has not checked in yet."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        Booking.objects.filter(pk=sale.booking_id).update(status=Booking.CHECKED_IN, checked_in_at=timezone.now())
        self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 29500)

    def test_a_scanned_ticket_hands_over_and_confirms_and_release_marks_the_tickets_released(self):
        sale = self.paid_tickets(quantity=2)                                                    # GH₵ 100.00
        with self.assertRaisesMessage(VerificationError, "The event has not taken place yet and no ticket was scanned."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        first = Ticket.objects.filter(transaction=sale.session.transaction).order_by("pk").first()
        self.as_owner()
        response = self.client.post(f"/api/events/{self.event.pk}/tickets/checkin/", {"code": first.code}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        first.refresh_from_db()
        self.assertIsNotNone(first.delivered_at)
        self.assertEqual(first.escrow_status, Ticket.HELD)                                      # the scan releases nothing
        self.call(sale, "matches")                                                              # the scan is the confirmation
        statuses = set(Ticket.objects.filter(transaction=sale.session.transaction).values_list("escrow_status", flat=True))
        self.assertEqual(statuses, {Ticket.RELEASED})
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 9500)

    def test_after_the_events_date_tickets_count_as_handed_over_but_need_the_call(self):
        sale = self.paid_tickets(quantity=1)                                                    # GH₵ 50.00: 1% fee
        Event.objects.filter(pk=self.event.pk).update(event_date=timezone.now() - timedelta(hours=1))
        with self.assertRaisesMessage(VerificationError, "Record the customer's confirmation first."):
            self.call(sale, "matches")
        self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 4950)

    def test_review_focus_a_mismatch_opens_a_dispute_due_72_hours_after_hand_over_and_releases_nothing(self):
        sale = self.paid_service()
        done = timezone.now() - timedelta(hours=2)
        self.complete(sale, at=done)
        sale = self.call(sale, "does_not_match", note="Only half the rooms were cleaned")
        dispute = sale.dispute
        self.assertEqual((dispute.status, dispute.order, dispute.raised_by, dispute.logged_by), (Dispute.OPEN, None, None, self.support))
        self.assertEqual(dispute.answer_due_at, done + timedelta(hours=72))
        self.assertIn("Only half the rooms were cleaned", dispute.description)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)
        with self.assertRaisesMessage(VerificationError, "A dispute is open on this booking."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.call(sale, "does_not_match", note="Still not right")                              # no second dispute
        self.assertEqual(Dispute.objects.count(), 1)
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.RESOLVED)
        self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 19500)

    def test_could_not_reach_is_only_recorded(self):
        sale = self.paid_service()
        self.complete(sale)
        sale = self.call(sale, "unreachable")
        self.assertEqual((sale.outcome, sale.released_at, sale.outcome_by), ("unreachable", None, self.support))
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)

    def test_bad_input_is_refused_before_anything_is_saved(self):
        sale = self.paid_service()
        self.complete(sale)
        cases = (("maybe", "", "Pick matches"), ("does_not_match", "", "Say what does not match."), ("unreachable", 5, "The note must be text."))
        for outcome, note, message in cases:
            with self.subTest(outcome=outcome), self.assertRaisesMessage(VerificationError, message):
                self.call(sale, outcome, note=note)
        sale.refresh_from_db()
        self.assertEqual(sale.outcome, "")

    def test_the_manual_ticket_release_and_hold_are_refused_for_a_ledger_ticket(self):
        sale = self.paid_tickets(quantity=1)
        ticket = Ticket.objects.get(transaction=sale.session.transaction)
        self.as_staff(make_staff("accountant", "kofi-1b@example.com"), sudo=True)
        for action in ("release", "hold"):
            response = self.client.post(f"/api/events/tickets/{ticket.pk}/escrow/{action}/", {"note": "Checked by hand"}, format="json")
            with self.subTest(action=action):
                self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_on"))
        ticket.refresh_from_db()
        self.assertEqual(ticket.escrow_status, Ticket.HELD)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 5000)
