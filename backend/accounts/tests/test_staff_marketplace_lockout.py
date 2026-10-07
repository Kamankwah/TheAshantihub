"""A staff session is view-only on the marketplace.

The frontend shows staff a "Staff accounts can't shop or sell" notice instead
of letting them buy, sell, book or create anything from the public site. These
tests lock in the server-side half of that contract: every buy/sell/book/create
endpoint the marketplace UI can reach refuses a staff token with a 403, even
for a super admin. Nothing here is new behaviour — each view already scopes
itself to Customer or BusinessOwner — so a failure means a permission class
was loosened.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from events.models import Event, EventTicketType
from listings.models import Category, Listing, Zone


class StaffMarketplaceLockoutTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207770101", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200770101", password_hash="x",
        )
        self.zone = Zone.objects.get(name="Manhyia")
        self.product = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"), zone=self.zone,
            name="Kente Stole", description="Hand woven.", contact_phone="+233207770101",
            price_amount="150.00", status=Listing.PUBLISHED,
        )
        self.lodge = Listing.objects.create(
            business_owner=self.owner,
            category=Category.objects.create(
                slug="lockout-lodging", label="Lodging", kind="service", is_accommodation=True,
            ),
            zone=self.zone, name="Ashanti Lodge", description="A lodge.",
            contact_phone="+233207770101", price_amount="200.00", status=Listing.PUBLISHED,
            units_total=2,
        )
        self.event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone,
            submitted_by_customer=self.customer, name="Akwasidae Festival",
            description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=timezone.now(),
            expires_at=timezone.now() + timezone.timedelta(days=14),
        )
        self.ticket_type = EventTicketType.objects.create(
            event=self.event, name="General", price="25.00", quantity_total=10,
        )
        # The most-privileged role: if a super admin is refused, every role is.
        staff = StaffUser.objects.create(
            full_name="Kwame Super", email="kwame-lockout@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def test_the_staff_token_itself_is_valid(self):
        # Guards every 403 below against meaning "bad token" instead of
        # "wrong account type".
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["account_type"], "staff")

    def assertForbidden(self, path, body):
        response = self.client.post(path, body, format="json")
        self.assertEqual(response.status_code, 403, f"{path} accepted a staff token: {response.content!r}")

    def test_staff_cannot_add_to_cart(self):
        self.assertForbidden("/api/cart/items/", {"listing": self.product.id, "quantity": 1})

    def test_staff_cannot_check_out_an_order(self):
        self.assertForbidden("/api/orders/checkout/", {"delivery_method": "store_pickup"})

    def test_staff_cannot_book_accommodation(self):
        today = timezone.now().date()
        self.assertForbidden("/api/bookings/", {
            "listing": self.lodge.id, "units": 1,
            "check_in": (today + timezone.timedelta(days=3)).isoformat(),
            "check_out": (today + timezone.timedelta(days=5)).isoformat(),
        })

    def test_staff_cannot_request_a_service(self):
        self.assertForbidden("/api/services/requests/", {"listing": self.product.id, "message": "Need this."})

    def test_staff_cannot_buy_event_tickets(self):
        self.assertForbidden(
            f"/api/events/{self.event.id}/tickets/purchase/",
            {"ticket_type": self.ticket_type.id, "quantity": 1},
        )

    def test_staff_cannot_create_a_listing(self):
        self.assertForbidden("/api/listings/mine/", {
            "name": "Staff Listing", "description": "D.", "category": "hotels",
            "zone": self.zone.id, "contact_phone": "+233207770102", "price_amount": "10.00",
        })

    def test_staff_cannot_write_a_review(self):
        self.assertForbidden("/api/reviews/", {
            "target_type": "listing", "target_id": self.product.id, "rating": 5, "comment": "Lovely stole.",
        })

    def test_staff_cannot_buy_a_promotion(self):
        self.assertForbidden(f"/api/listings/{self.product.id}/promote/", {"kind": "featured", "days": 7})

    def test_staff_cannot_submit_an_event(self):
        self.assertForbidden("/api/events/submit/", {
            "name": "Staff Durbar", "description": "D.", "address": "Kejetia",
            "category": "festivals", "zone": self.zone.id,
            "event_date": (timezone.now() + timezone.timedelta(days=10)).isoformat(),
            "visibility_days": 7,
        })
