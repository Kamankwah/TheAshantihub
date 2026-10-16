"""Support's booking queue and the call over the API (Plan 1b, Task 6): handed-over bookings, oldest paid first, with
what the call needs; the call's answers; who may see it. Review Focus 8 (switches off)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from bookings.models import Booking
from disputes.models import Dispute
from ledger.models import BookingSale
from services.models import ServiceRequest

from .booking_helpers import BookingBase

QUEUE = "/api/ledger/bookings/awaiting-verification/"


@override_settings(LEDGER_ENABLED=True)
class BookingQueueApiTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-q@example.com")
        self.desk = make_staff("pickup_desk", "desk-q@example.com")

    def done(self, sale, at=None):
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(
            status=ServiceRequest.COMPLETED, completed_at=at or timezone.now(),
        )

    def verify(self, sale, **body):
        return self.client.post(f"/api/ledger/bookings/{sale.pk}/verification/", body, format="json")

    def test_the_queue_lists_handed_over_bookings_oldest_first_with_what_the_call_needs(self):
        waiting = self.paid_service()                                                          # not done yet: not listed
        cleaned = self.paid_service("150.00")
        self.done(cleaned, at=timezone.now() - timedelta(hours=73))
        BookingSale.objects.filter(pk=cleaned.pk).update(paid_at=timezone.now() - timedelta(days=5))
        stay = self.paid_stay(nights=1)
        Booking.objects.filter(pk=stay.booking_id).update(status=Booking.CHECKED_IN, checked_in_at=timezone.now())
        self.as_staff(self.support)
        body = self.client.get(QUEUE).json()
        self.assertEqual(body["count"], 2)
        first, second = body["results"]
        self.assertEqual((first["sale_id"], first["kind"], first["overdue"], first["amount"]), (cleaned.pk, "service", True, "150.00"))
        self.assertEqual(
            (first["what"], first["business"], first["customer_name"], first["customer_phone"]),
            ("Home Cleaning", "Kwame Mensah", "Ama Owusu", "+233200770001"),
        )
        self.assertEqual((second["sale_id"], second["kind"], second["overdue"], second["customer_confirmed"]), (stay.pk, "stay", False, False))
        self.assertNotIn(waiting.pk, [row["sale_id"] for row in body["results"]])

    def test_recording_the_call_through_the_api_releases_and_empties_the_queue(self):
        sale = self.paid_service()
        self.done(sale)
        self.as_staff(self.support)
        response = self.verify(sale, outcome="matches", customer_confirmed_by_phone=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"sale": sale.pk, "outcome": "matches", "dispute_id": None, "released": True})
        self.assertEqual(self.client.get(QUEUE).json()["count"], 0)

    def test_a_mismatch_answers_its_dispute_and_refusals_answer_their_status(self):
        sale = self.paid_service()
        self.as_staff(self.support)
        response = self.verify(sale, outcome="matches")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "The business has not marked this service done yet."))
        self.done(sale)
        self.assertEqual(self.verify(sale, outcome="does_not_match").status_code, 400)
        body = self.verify(sale, outcome="does_not_match", note="Wrong service").json()
        self.assertEqual((body["dispute_id"], body["released"]), (Dispute.objects.get().pk, False))

    def test_only_support_and_super_admin_see_or_record_it(self):
        sale = self.paid_service()
        self.as_staff(self.desk)
        self.assertEqual(self.client.get(QUEUE).status_code, 403)
        self.assertEqual(self.verify(sale, outcome="unreachable").status_code, 403)
        self.as_customer()
        self.assertIn(self.client.get(QUEUE).status_code, (401, 403))

    @override_settings(LEDGER_ENABLED=False)
    def test_review_focus_with_the_ledger_off_the_booking_screens_say_so(self):
        self.as_staff(self.support)
        response = self.client.get(QUEUE)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertEqual(self.client.post("/api/ledger/bookings/1/verification/", {}, format="json").json()["code"], "ledger_off")
