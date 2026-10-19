"""Fixtures for the booking-sale tests (Plan 1b; not test cases themselves)."""
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import staff_token
from events.models import Event, EventTicketType
from ledger import posting
from ledger.models import Account, BookingSale, FeeBand, FeeRuleSet
from listings.models import Category, Listing, Zone
from services.models import ServiceRequest


def fund(customer, pesewas, key):
    """Money in a customer's wallet through provider clearing, as a top-up leaves it."""
    posting.post(key=key, kind="test_fund", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas),
        posting.credit(posting.account_for(Account.CUSTOMER_WALLET, customer), pesewas),
    ])


def product_ladder_for_all_categories():
    """Services and events have their own suggested ladders (migration 0009); these tests are about the booking
    mechanics, so pin both to the product ladder and keep their expected amounts simple."""
    product = FeeRuleSet.objects.filter(category="product").order_by("-effective_from", "-id").first()
    for category in ("service", "event"):
        newest = FeeRuleSet.objects.filter(category=category).order_by("-effective_from").first()
        start = min(timezone.now(), newest.effective_from + timedelta(milliseconds=1)) if newest else timezone.now()
        rule_set = FeeRuleSet.objects.create(category=category, effective_from=start)
        for band in product.bands.all():
            FeeBand.objects.create(
                rule_set=rule_set, lower_pesewas=band.lower_pesewas, upper_pesewas=band.upper_pesewas,
                percent_bp=band.percent_bp, flat_pesewas=band.flat_pesewas,
            )


class BookingBase(TestCase):
    def setUp(self):
        cache.clear()
        product_ladder_for_all_categories()
        self.client = APIClient()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233200770001", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233207770001", password_hash="x")
        self.zone = Zone.objects.get(name="Manhyia")
        self.service = self.listing(
            "Home Cleaning", "200.00", Category.objects.create(slug="cleaning-1b", label="Cleaning", kind="service"),
        )
        self.lodge = self.listing(
            "Ashanti Lodge", "150.00",
            Category.objects.create(slug="lodge-1b", label="Lodge", kind="service", is_accommodation=True), units_total=2,
        )
        now = timezone.now()
        self.event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone, submitted_by_business=self.owner,
            name="Highlife Night", description="Live band.", address="Kumasi", event_date=now + timedelta(days=10),
            visibility_days=14, status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        self.ticket_type = EventTicketType.objects.create(event=self.event, name="Regular", price=Decimal("50.00"))

    def listing(self, name, price, category, **extra):
        return Listing.objects.create(
            business_owner=self.owner, category=category, zone=self.zone, name=name, description="D.",
            contact_phone=self.owner.login_phone, price_amount=Decimal(price), status=Listing.PUBLISHED, **extra,
        )

    def as_customer(self, customer=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer or self.customer, 'customer')}")

    def as_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def balance(self, kind, owner=None):
        return posting.balance_of(kind, owner)

    # --- buying through the real endpoints ---

    def accepted_service(self, price="200.00"):
        return ServiceRequest.objects.create(
            customer=self.customer, listing=self.service, business_owner=self.owner, message="Clean my house.",
            agreed_price=Decimal(price), status=ServiceRequest.ACCEPTED,
        )

    def pay_service(self, sr, method=None):
        self.as_customer()
        return self.client.post(f"/api/services/requests/{sr.pk}/pay/", {"payment_method": method} if method else {}, format="json")

    def book_stay(self, nights=2, method=None, starts_in=1):
        self.as_customer()
        check_in = timezone.localdate() + timedelta(days=starts_in)
        body = {
            "listing": self.lodge.pk, "check_in": check_in.isoformat(),
            "check_out": (check_in + timedelta(days=nights)).isoformat(), "units": 1,
        }
        if method:
            body["payment_method"] = method
        return self.client.post("/api/bookings/", body, format="json")

    def buy_tickets(self, quantity=2, method=None, event=None, ticket_type=None):
        self.as_customer()
        body = {"ticket_type": (ticket_type or self.ticket_type).pk, "quantity": quantity}
        if method:
            body["payment_method"] = method
        return self.client.post(f"/api/events/{(event or self.event).pk}/tickets/purchase/", body, format="json")

    # --- paid sales, ready for the later steps (they need the Task 3 wiring) ---

    def paid_service(self, price="200.00"):
        sr = self.accepted_service(price)
        response = self.pay_service(sr)
        assert response.status_code == 200, response.content
        return BookingSale.objects.get(service_request=sr)

    def paid_stay(self, nights=2, starts_in=1):
        response = self.book_stay(nights, starts_in=starts_in)
        assert response.status_code == 201, response.content
        return BookingSale.objects.get(booking_id=response.json()["id"])

    def paid_tickets(self, quantity=2):
        response = self.buy_tickets(quantity)
        assert response.status_code == 201, response.content
        return BookingSale.objects.get(session__transaction__tickets__id=response.json()[0]["id"])
