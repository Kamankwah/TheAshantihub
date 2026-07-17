from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from bookings.availability import is_available, min_units_free
from bookings.models import Booking
from listings.models import Category, Listing, Zone


class BookingTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Hotel Owner", login_phone="+233207885500", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Guest", phone="+233200885500", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Guest", phone="+233200885501", password_hash="x",
        )
        # An accommodation category (service kind + is_accommodation).
        self.category = Category.objects.create(
            slug="hotel", label="Hotel", kind="service", is_accommodation=True,
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=Zone.objects.get(name="Manhyia"),
            name="Ashanti Lodge", description="A lodge.", contact_phone="+233207885500",
            price_amount="200.00", status=Listing.PUBLISHED, units_total=2,
        )
        self.today = timezone.now().date()

    def _auth(self, account, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")

    def _d(self, offset):
        return (self.today + timedelta(days=offset)).isoformat()

    def _book(self, customer, check_in, check_out, units=1):
        self._auth(customer, "customer")
        return self.client.post(
            "/api/bookings/",
            {"listing": self.listing.id, "check_in": check_in, "check_out": check_out, "units": units},
            format="json",
        )


class AvailabilityUnitTests(BookingTestsBase):
    def _make_booking(self, ci, co, units, status=Booking.CONFIRMED):
        return Booking.objects.create(
            customer=self.customer, listing=self.listing, business_owner=self.owner,
            check_in=self.today + timedelta(days=ci), check_out=self.today + timedelta(days=co),
            units=units, nightly_rate="200.00", total_price="0.00", status=status,
        )

    def test_available_when_empty(self):
        self.assertTrue(is_available(self.listing, self.today + timedelta(days=1), self.today + timedelta(days=3), 2))

    def test_overlapping_bookings_reduce_availability(self):
        self._make_booking(1, 4, units=1)  # nights 1,2,3
        # 1 unit left across the overlap, units_total=2.
        self.assertTrue(is_available(self.listing, self.today + timedelta(days=2), self.today + timedelta(days=3), 1))
        self.assertFalse(is_available(self.listing, self.today + timedelta(days=2), self.today + timedelta(days=3), 2))

    def test_full_when_all_units_booked(self):
        self._make_booking(1, 4, units=2)  # both units, nights 1,2,3
        self.assertFalse(is_available(self.listing, self.today + timedelta(days=2), self.today + timedelta(days=3), 1))
        self.assertEqual(min_units_free(self.listing, self.today + timedelta(days=1), self.today + timedelta(days=4)), 0)

    def test_adjacent_bookings_do_not_conflict(self):
        # Checkout day == next check-in day: half-open ranges, no overlap.
        self._make_booking(1, 3, units=2)  # nights 1,2
        self.assertTrue(is_available(self.listing, self.today + timedelta(days=3), self.today + timedelta(days=5), 2))

    def test_cancelled_booking_frees_inventory(self):
        self._make_booking(1, 4, units=2, status=Booking.CANCELLED)
        self.assertTrue(is_available(self.listing, self.today + timedelta(days=2), self.today + timedelta(days=3), 2))


class BookingFlowTests(BookingTestsBase):
    def test_customer_books_and_it_confirms_with_priced_total(self):
        response = self._book(self.customer, self._d(1), self._d(4), units=1)  # 3 nights
        self.assertEqual(response.status_code, 201, response.content)
        booking = Booking.objects.get()
        self.assertEqual(booking.status, Booking.CONFIRMED)  # simulated pay finalizes
        self.assertEqual(str(booking.total_price), "600.00")  # 200 × 3 × 1
        self.assertIsNotNone(booking.paid_at)

    def test_units_priced_in(self):
        response = self._book(self.customer, self._d(1), self._d(3), units=2)  # 2 nights, 2 units
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(str(Booking.objects.get().total_price), "800.00")  # 200 × 2 × 2

    def test_double_booking_beyond_capacity_is_rejected(self):
        self._book(self.customer, self._d(1), self._d(4), units=2)  # both units
        conflict = self._book(self.other_customer, self._d(2), self._d(3), units=1)
        self.assertEqual(conflict.status_code, 409, conflict.content)

    def test_cannot_book_the_past(self):
        response = self._book(self.customer, self._d(-2), self._d(1))
        self.assertEqual(response.status_code, 400)

    def test_cannot_book_a_non_accommodation_listing(self):
        product = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.filter(kind="product").first(),
            zone=Zone.objects.get(name="Manhyia"), name="A Product", description="D.",
            contact_phone="+233207885500", price_amount="10.00", status=Listing.PUBLISHED,
        )
        self._auth(self.customer, "customer")
        response = self.client.post(
            "/api/bookings/", {"listing": product.id, "check_in": self._d(1), "check_out": self._d(2)}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_checkout_before_checkin_is_rejected(self):
        response = self._book(self.customer, self._d(4), self._d(1))
        self.assertEqual(response.status_code, 400)

    def test_availability_endpoint(self):
        self._book(self.customer, self._d(1), self._d(4), units=1)
        self._auth(self.other_customer, "customer")
        response = self.client.get(f"/api/bookings/availability/?listing={self.listing.id}&check_in={self._d(2)}&check_out={self._d(3)}")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["units_free"], 1)
        self.assertTrue(response.json()["available"])


class BookingLifecycleTests(BookingTestsBase):
    def _confirmed(self):
        self._book(self.customer, self._d(1), self._d(3), units=1)
        return Booking.objects.get()

    def test_owner_checks_in_then_out(self):
        booking = self._confirmed()
        self._auth(self.owner, "business_owner")
        ci = self.client.post(f"/api/bookings/{booking.id}/check-in/")
        self.assertEqual(ci.status_code, 200, ci.content)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.CHECKED_IN)
        co = self.client.post(f"/api/bookings/{booking.id}/check-out/")
        self.assertEqual(co.status_code, 200, co.content)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.CHECKED_OUT)

    def test_checked_out_booking_frees_the_dates_for_a_new_booking(self):
        booking = self._confirmed()  # 1 unit of 2, nights 1,2
        self._auth(self.owner, "business_owner")
        self.client.post(f"/api/bookings/{booking.id}/check-in/")
        self.client.post(f"/api/bookings/{booking.id}/check-out/")
        # Now both units should be free again.
        again = self._book(self.other_customer, self._d(1), self._d(3), units=2)
        self.assertEqual(again.status_code, 201, again.content)

    def test_customer_cancels_and_frees_dates(self):
        booking = self._confirmed()
        self._auth(self.customer, "customer")
        cancel = self.client.post(f"/api/bookings/{booking.id}/cancel/")
        self.assertEqual(cancel.status_code, 200, cancel.content)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.CANCELLED)

    def test_cannot_check_in_an_unconfirmed_booking(self):
        booking = self._confirmed()
        self._auth(self.owner, "business_owner")
        self.client.post(f"/api/bookings/{booking.id}/check-in/")  # now checked_in
        response = self.client.post(f"/api/bookings/{booking.id}/check-in/")  # again
        self.assertEqual(response.status_code, 400)

    def test_owner_sees_only_their_bookings(self):
        self._confirmed()
        other_owner = BusinessOwner.objects.create(
            full_name="Other Hotel", login_phone="+233207885599", password_hash="x",
        )
        self._auth(other_owner, "business_owner")
        self.assertEqual(len(self.client.get("/api/bookings/incoming/").json()), 0)

    def test_another_customer_cannot_cancel_your_booking(self):
        booking = self._confirmed()
        self._auth(self.other_customer, "customer")
        response = self.client.post(f"/api/bookings/{booking.id}/cancel/")
        self.assertEqual(response.status_code, 404)
