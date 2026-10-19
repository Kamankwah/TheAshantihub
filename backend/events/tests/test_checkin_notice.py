"""Plan 7C, task 2: a door scan releases and holds nothing; it records evidence and tells the buyer once."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from events.models import Ticket, TicketScanNotice
from events import scan_notice
from ledger import sales
from ledger.models import Account, Journal, JournalLine
from ledger.tests.booking_helpers import BookingBase
from notifications.models import Notification
from otp import senders


@override_settings(LEDGER_ENABLED=True, OTP_SMS_PROVIDER="locmem")
class CheckinNoticeTests(BookingBase):
    def setUp(self):
        super().setUp()
        senders.sms_outbox.clear()
        self.sale = self.paid_tickets(quantity=2)
        self.tickets = list(Ticket.objects.filter(transaction=self.sale.session.transaction).order_by("pk"))

    def scan(self, ticket, expect=200):
        self.as_owner()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(f"/api/events/{self.event.pk}/tickets/checkin/", {"code": ticket.code}, format="json")
        self.assertEqual(response.status_code, expect, response.content)
        ticket.refresh_from_db()
        return response

    def test_scan_does_not_release(self):
        pending = self.balance(Account.VENDOR_PENDING, self.owner)
        self.scan(self.tickets[0])
        t = Ticket.objects.get(pk=self.tickets[0].pk)
        self.assertIsNotNone(t.delivered_at)
        self.assertEqual(t.escrow_status, Ticket.HELD)
        self.sale.refresh_from_db()
        self.assertIsNone(self.sale.released_at)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), pending)
        self.assertEqual(sales.release_due(timezone.now()), 0)  # nor does the clock release it early

    def test_scan_of_ledger_sale_ticket_unchanged(self):
        self.scan(self.tickets[0])
        self.assertEqual(self.tickets[0].escrow_status, Ticket.HELD)
        self.assertIsNotNone(self.tickets[0].delivered_at)
        self.assertEqual(TicketScanNotice.objects.count(), 1)

    def test_scan_queues_one_notice(self):
        self.scan(self.tickets[0])
        notice = TicketScanNotice.objects.get()
        self.assertEqual(notice.key, f"ticket-scan-{self.tickets[0].pk}")
        self.assertIsNotNone(notice.sent_at)
        self.assertIn("Highlife Night", notice.body)
        self.assertIn("contact AshantiHub Support before", notice.body)
        self.assertEqual([t.to for t in senders.sms_outbox], [self.customer.phone])
        self.assertEqual(Notification.objects.filter(customer=self.customer, kind="ticket").count(), 1)
        for phone in (self.owner.login_phone, self.customer.phone):
            self.assertNotIn(phone, notice.body)

    def test_digits_in_event_name_cannot_leak_a_number(self):
        class Named:
            class ticket_type:
                class event:
                    name = "Call 0241234567 Night"

        body = scan_notice.body_for(Named, timezone.now(), timezone.now())
        self.assertNotIn("0241234567", body)
        self.assertIn("567", body)

    def test_rescan_no_second_notice(self):
        self.scan(self.tickets[0])
        self.scan(self.tickets[0], expect=400)
        scan_notice.send(Ticket.objects.get(pk=self.tickets[0].pk), self.sale)
        self.assertEqual(TicketScanNotice.objects.count(), 1)
        self.assertEqual(len(senders.sms_outbox), 1)

    def test_refunded_ticket_scan_refused(self):
        sales.refund_ticket(self.sale, self.tickets[0].pk, by=make_staff("accountant", "acct7c2b@example.com"), reason="x")
        self.scan(self.tickets[0], expect=400)
        self.assertFalse(TicketScanNotice.objects.exists())
        self.assertEqual(senders.sms_outbox, [])

    def test_dispute_after_scan_refunds_from_organiser(self):
        self.scan(self.tickets[0])
        pending = self.balance(Account.VENDOR_PENDING, self.owner)
        refund = sales.refund(self.sale, 5000, source="dispute-9001", by=make_staff("accountant", "acct7c2c@example.com"))
        self.assertEqual(refund.amount_pesewas, 5000)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), pending - 5000)
        journal = Journal.objects.get(key=sales.refund_key(self.sale, "dispute-9001"))
        kinds = {line.account.kind for line in JournalLine.objects.filter(journal=journal).select_related("account")}
        self.assertEqual(kinds, {Account.VENDOR_PENDING, Account.CUSTOMER_WALLET})  # no platform account funds it
        Ticket.objects.get(pk=self.tickets[0].pk).delivered_at  # the evidence stays
        self.assertIsNotNone(Ticket.objects.get(pk=self.tickets[0].pk).delivered_at)

    @override_settings(LEDGER_ENABLED=False)
    def test_no_notice_while_ledger_off(self):
        senders.sms_outbox.clear()
        self.scan(self.tickets[0])
        self.assertFalse(TicketScanNotice.objects.exists())
