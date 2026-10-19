"""Plan 7E, Task 2: a customer accepts a delivered service (releasing it at once) or reports a problem (a dispute that
stops the automatic release). Both are refused with 409 once the money has been released."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.models import Customer
from accounts.testing import make_staff
from disputes.models import Dispute
from ledger import sales
from ledger.models import Account, BookingSale, Journal
from notifications.models import Notification
from services.models import ServiceRequest

from .booking_helpers import BookingBase


@override_settings(LEDGER_ENABLED=True)
class AcceptAndReportTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.sale = self.paid_service("200.00")
        self.sr = self.sale.service_request

    def done(self):
        ServiceRequest.objects.filter(pk=self.sr.pk).update(status=ServiceRequest.COMPLETED, completed_at=timezone.now())

    def accept(self, customer=None):
        self.as_customer(customer)
        return self.client.post(f"/api/services/requests/{self.sr.pk}/accept/", {}, format="json")

    def report(self, reason="The job was not done properly."):
        self.as_customer()
        return self.client.post(f"/api/services/requests/{self.sr.pk}/report-problem/", {"reason": reason}, format="json")

    def test_accept_releases_once(self):
        self.done()
        self.assertEqual(self.accept().status_code, 200)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 19500)
        self.assertEqual(self.accept().status_code, 409)
        self.assertEqual(Journal.objects.filter(key=sales.release_key(self.sale)).count(), 1)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 19500)

    def test_accept_before_done_409(self):
        self.assertEqual(self.accept().status_code, 409)
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.owner), 20000)

    def test_other_customer_gets_404_not_a_hint_it_exists(self):
        self.done()
        other = Customer.objects.create(full_name="Kojo", phone="+233200770009", password_hash="x")
        self.assertEqual(self.accept(other).status_code, 404)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.owner), 0)

    def test_report_opens_dispute_blocks_timer_and_tells_support(self):
        make_staff("support", "support-7e@example.com")
        self.done()
        response = self.report()
        self.assertEqual(response.status_code, 201)
        self.sale.refresh_from_db()
        self.assertIsNotNone(self.sale.dispute_id)
        self.assertEqual(self.sale.dispute.status, Dispute.OPEN)
        self.assertEqual(self.sale.dispute.raised_by, self.customer)
        self.assertEqual(sales.release_due(timezone.now() + timedelta(days=30)), 0)
        self.assertEqual(self.accept().status_code, 409)                       # a problem is open: cannot accept now
        self.assertTrue(Notification.objects.filter(staff__isnull=False, kind="booking_problem").exists())

    def test_report_after_release_409(self):
        self.done()
        self.accept()
        self.assertEqual(self.report().status_code, 409)

    def test_report_needs_a_reason(self):
        self.done()
        self.assertEqual(self.report("no").status_code, 400)

    def test_stay_guest_can_report_a_problem_by_sale(self):
        stay = self.paid_stay()
        self.as_customer()
        response = self.client.post(f"/api/ledger/bookings/{stay.pk}/report-problem/", {"reason": "The room was not as shown."}, format="json")
        self.assertEqual(response.status_code, 201)
        stay.refresh_from_db()
        self.assertIsNotNone(stay.dispute_id)

    def mine(self):
        self.as_customer()
        return next(r for r in self.client.get("/api/services/requests/mine/").json() if r["id"] == self.sr.pk)

    def test_my_requests_say_when_the_service_accepts_itself(self):
        self.assertIsNone(self.mine()["auto_accept_at"])                      # not done yet: no clock
        self.done()
        row = self.mine()
        self.sale.refresh_from_db()
        self.assertEqual(row["auto_accept_at"], sales.release_at(self.sale).isoformat().replace("+00:00", "Z"))
        self.assertFalse(row["settled"])
        self.assertFalse(row["problem_reported"])
        self.report()
        self.assertTrue(self.mine()["problem_reported"])

    def test_my_requests_show_settled_after_accept(self):
        self.done()
        self.accept()
        row = self.mine()
        self.assertTrue(row["settled"])
        self.assertIsNone(row["auto_accept_at"])
