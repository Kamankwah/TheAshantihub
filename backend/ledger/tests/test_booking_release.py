"""Release of a booking's money on Support's verification call (Plan 1b, Task 5; spec §4.2): what "handed over" means for
each kind, the receipt confirmation, the mismatch dispute, and tickets' escrow flags following the sale. Review Focus 3
(release refused before hand-over and while a dispute is open)."""
from datetime import timedelta

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
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

    # --- fix round 1 ---

    def scan(self, ticket):
        self.as_owner()
        response = self.client.post(f"/api/events/{self.event.pk}/tickets/checkin/", {"code": ticket.code}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        ticket.refresh_from_db()
        return ticket

    def test_a_rejected_dispute_is_never_replaced_and_a_reopened_one_blocks_release(self):
        sale = self.paid_service()
        self.complete(sale)
        sale = self.call(sale, "does_not_match", note="Half done")
        dispute = sale.dispute
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.REJECTED)
        with self.assertRaisesMessage(VerificationError, "The earlier dispute was rejected"):
            self.call(sale, "does_not_match", note="Again")
        sale.refresh_from_db()
        self.assertEqual((sale.dispute_id, Dispute.objects.count()), (dispute.pk, 1))
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.OPEN)
        with self.assertRaisesMessage(VerificationError, "A dispute is open on this booking."):
            self.call(sale, "matches", customer_confirmed_by_phone=True)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)

    def test_a_resolved_dispute_refuses_a_new_mismatch_instead_of_recording_it(self):
        sale = self.paid_service()
        self.complete(sale)
        sale = self.call(sale, "does_not_match", note="Half done")
        Dispute.objects.filter(pk=sale.dispute_id).update(status=Dispute.RESOLVED)
        with self.assertRaisesMessage(VerificationError, "The earlier dispute was resolved — ask the Support lead to log a new one."):
            self.call(sale, "does_not_match", note="Again")
        sale.refresh_from_db()
        self.assertEqual((sale.outcome, sale.outcome_note, Dispute.objects.count()), ("does_not_match", "Half done", 1))

    def test_the_linked_dispute_is_locked_before_the_service_request_and_the_sale(self):
        sale = self.paid_service()
        self.complete(sale)
        sale = self.call(sale, "does_not_match", note="Half done")
        with CaptureQueriesContext(connection) as queries:
            self.call(sale, "does_not_match", note="Still")
        locking = [q["sql"] for q in queries if "FOR UPDATE" in q["sql"]]
        tables = ["disputes_dispute", "services_servicerequest", "ledger_bookingsale"]
        order = [next(i for i, sql in enumerate(locking) if f'FROM "{t}"' in sql) for t in tables]
        self.assertEqual(order, sorted(order), locking)

    def test_a_call_that_read_the_sale_before_another_call_linked_a_dispute_is_asked_to_retry(self):
        sale = self.paid_service()
        self.complete(sale)
        stale = type(sale).objects.get(pk=sale.pk)                       # read while no dispute was linked
        self.call(sale, "does_not_match", note="First call")             # the other call logs the dispute
        self.assertIsNone(stale.dispute_id)
        with self.assertRaisesMessage(VerificationError, "Another call just logged a dispute — try again."):
            self.call(stale, "does_not_match", note="Second call")
        self.assertEqual(Dispute.objects.get().description.count("Second call"), 0)

    def test_a_repeat_mismatch_appends_its_note_to_the_open_dispute(self):
        sale = self.paid_service()
        self.complete(sale)
        sale = self.call(sale, "does_not_match", note="Half done")
        self.call(sale, "does_not_match", note="Still half done")
        description = Dispute.objects.get().description
        self.assertIn("Half done", description)
        self.assertIn("Still half done", description)

    def test_a_mismatch_or_unreachable_is_refused_before_hand_over(self):
        sale = self.paid_service()
        for outcome in ("does_not_match", "unreachable"):
            with self.subTest(outcome=outcome), self.assertRaisesMessage(VerificationError, "has not marked this service done"):
                self.call(sale, outcome, note="x")
        self.assertEqual(Dispute.objects.count(), 0)

    def test_the_call_is_refused_while_the_ledger_is_off(self):
        sale = self.paid_service()
        with override_settings(LEDGER_ENABLED=False), self.assertRaisesMessage(VerificationError, "The ledger is off."):
            self.call(sale, "unreachable")

    def test_a_ticket_dispute_is_due_72_hours_after_the_first_scan(self):
        sale = self.paid_tickets(quantity=2)
        ticket = self.scan(Ticket.objects.filter(transaction=sale.session.transaction).order_by("pk").first())
        sale = self.call(sale, "does_not_match", note="Wrong event")
        self.assertEqual(sale.dispute.answer_due_at, ticket.delivered_at + timedelta(hours=72))

    def test_a_ticket_dispute_without_a_scan_is_due_72_hours_after_the_event_date(self):
        sale = self.paid_tickets(quantity=1)
        date = timezone.now() - timedelta(hours=5)
        Event.objects.filter(pk=self.event.pk).update(event_date=date)
        sale = self.call(sale, "does_not_match", note="Cancelled on the day")
        self.assertEqual(sale.dispute.answer_due_at, date + timedelta(hours=72))

    @override_settings(LEDGER_ENABLED=False)
    def test_a_scan_still_releases_the_flag_with_the_ledger_off(self):
        self.buy_tickets(quantity=1)
        ticket = self.scan(Ticket.objects.get())
        self.assertEqual(ticket.escrow_status, Ticket.RELEASED)
        self.assertIsNotNone(ticket.escrow_released_at)

    def test_a_scan_still_releases_a_ticket_that_has_no_sale(self):
        with override_settings(LEDGER_ENABLED=False):
            self.buy_tickets(quantity=1)
        ticket = self.scan(Ticket.objects.get())
        self.assertEqual(ticket.escrow_status, Ticket.RELEASED)
        self.assertIsNotNone(ticket.escrow_released_at)
