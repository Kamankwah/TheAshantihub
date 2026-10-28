"""Support's booking search for the cancel screen (Plan 1F Task 7, gate (lxxiii)): what it finds, what it leaves out,
the masked phone, who may use it, and the cap of twenty."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.models import Customer
from accounts.testing import make_staff
from ledger.models import BookingSale
from services.models import ServiceRequest

from .booking_helpers import BookingBase

URL = "/api/ledger/bookings/"


@override_settings(LEDGER_ENABLED=True)
class BookingLookupApiTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-l@example.com")

    def search(self, q=None):
        self.as_staff(self.support)
        return self.client.get(URL, {"q": q} if q is not None else {})

    def ids(self, q=None):
        response = self.search(q)
        self.assertEqual(response.status_code, 200, response.content)
        return [row["sale_id"] for row in response.json()["results"]]

    def test_finds_a_sale_by_its_sale_service_request_or_booking_number(self):
        service = self.paid_service()
        stay = self.paid_stay()
        self.assertIn(service.pk, self.ids(f"#{service.pk}"))
        self.assertIn(service.pk, self.ids(str(service.service_request_id)))
        self.assertIn(stay.pk, self.ids(str(stay.booking_id)))
        self.assertIn(stay.pk, self.ids(f"#{stay.pk}"))

    def test_a_non_ascii_digit_search_is_not_a_500(self):
        self.paid_service()
        for q in ("²", "#²", "٣٤"):
            self.assertEqual(self.search(q).status_code, 200, q)

    def test_finds_by_customer_name_phone_and_business(self):
        sale = self.paid_service()
        self.assertEqual(self.ids("ama owu"), [sale.pk])
        self.assertEqual(self.ids("020 077 0001"), [sale.pk])
        self.assertEqual(self.ids("+233200770001"), [sale.pk])
        self.assertEqual(self.ids("kwame"), [sale.pk])
        self.assertEqual(self.ids("home clean"), [sale.pk])
        self.assertEqual(self.ids("nobody here"), [])
        self.assertEqual(self.ids("0249999999"), [])

    def test_lists_only_sales_not_released_or_refunded(self):
        kept = self.paid_service()
        released = self.paid_service()
        reversed_ = self.paid_service()
        BookingSale.objects.filter(pk=released.pk).update(released_at=timezone.now())
        BookingSale.objects.filter(pk=reversed_.pk).update(reversed_at=timezone.now())
        self.assertEqual(self.ids(), [kept.pk])

    def test_marks_handed_over_sales_not_cancellable(self):
        open_sale = self.paid_service()
        done = self.paid_service()
        done_at = timezone.now() - timedelta(hours=2)
        ServiceRequest.objects.filter(pk=done.service_request_id).update(status=ServiceRequest.COMPLETED, completed_at=done_at)
        rows = {row["sale_id"]: row for row in self.search().json()["results"]}
        self.assertTrue(rows[open_sale.pk]["cancellable"])
        self.assertIsNone(rows[open_sale.pk]["handed_over_at"])
        self.assertFalse(rows[done.pk]["cancellable"])
        self.assertIsNotNone(rows[done.pk]["handed_over_at"])
        row = rows[open_sale.pk]
        self.assertEqual(
            (row["kind"], row["what"], row["business"], row["customer_name"], row["amount"]),
            ("service", "Home Cleaning", "Kwame Mensah", "Ama Owusu", "200.00"),
        )

    def test_phone_is_masked(self):
        self.paid_service()
        row = self.search().json()["results"][0]
        self.assertEqual(row["customer_phone"], "020 *** 0001")
        self.assertNotIn("0770001", str(self.search().content))

    def test_needs_orders_support_update(self):
        self.paid_service()
        self.as_staff(make_staff("pickup_desk", "desk-l@example.com"))
        self.assertEqual(self.client.get(URL).status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get(URL).status_code, 401)
        self.as_customer()
        self.assertIn(self.client.get(URL).status_code, (401, 403))

    def test_ledger_off(self):
        with override_settings(LEDGER_ENABLED=False):
            response = self.search()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))

    def test_caps_at_twenty(self):
        for index in range(21):
            customer = Customer.objects.create(full_name=f"Bulk {index}", phone=f"+23320088{index:04d}", password_hash="x")
            self.customer = customer
            self.paid_service()
        self.assertEqual(len(self.ids()), 20)
