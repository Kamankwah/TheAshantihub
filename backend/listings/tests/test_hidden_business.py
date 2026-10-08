"""Hiding a business (staff phase 2A, Task 3). One helper —
listings.visibility.hidden_business_q — keeps suspended businesses and
businesses paused by the subscription clock out of public browse (listings,
listing detail, related listings, events) and out of carts. Nothing is
unpublished, so paying brings everything back at once."""
from datetime import timedelta
from itertools import count

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from billing import clock
from billing.models import Subscription, SubscriptionPlan
from cart.models import CartItem
from events.models import Event
from listings.models import Category, Listing, Zone
from listings.visibility import hidden_business_q

_phones = count(100)
NOT_AVAILABLE = {"listing": ["This item isn't available right now."]}


class HiddenBusinessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hotels = Category.objects.get(slug="hotels")
        self.festivals = Category.objects.get(slug="festivals")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.now = timezone.now()
        self.unsubscribed = self.make_owner("Tafo Grains")  # no subscription at all
        self.paused = self.make_owner("Bantama Shoe Palace")
        self.make_subscription(
            self.paused, period_end=self.now - timedelta(days=16),
            overdue_since=self.now - timedelta(days=16), paused_at=self.now - timedelta(days=2),
        )
        self.overdue = self.make_owner("Adwoa Fabrics")
        self.make_subscription(
            self.overdue, period_end=self.now - timedelta(days=5), overdue_since=self.now - timedelta(days=5),
        )
        self.anchor = self.make_listing(self.unsubscribed, "Tafo guest room")
        self.paused_listing = self.make_listing(self.paused, "Bantama guest room")
        self.overdue_listing = self.make_listing(self.overdue, "Adwoa guest room")
        self.paused_event = self.make_event(self.paused, "Bantama shoe fair")
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200771301", password_hash="x",
        )

    def make_owner(self, name):
        n = next(_phones)
        owner = BusinessOwner.objects.create(
            full_name=f"{name} owner", login_phone=f"+233207660{n:03d}", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name=name)
        return owner

    def make_subscription(self, owner, *, period_end, **clock_fields):
        return Subscription.objects.create(
            business_owner=owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=period_end - timedelta(days=30), current_period_end=period_end,
            **clock_fields,
        )

    def make_listing(self, owner, name):
        return Listing.objects.create(
            business_owner=owner, category=self.hotels, zone=self.manhyia, name=name,
            description="D.", contact_phone="+233207660999", price_amount="150.00",
            status=Listing.PUBLISHED,
        )

    def make_event(self, owner=None, name="Fair", *, customer=None):
        return Event.objects.create(
            category=self.festivals, zone=self.manhyia, submitted_by_business=owner,
            submitted_by_customer=customer, name=name, description="D.", address="Bantama, Kumasi",
            event_date=self.now + timedelta(days=30), visibility_days=14, status=Event.APPROVED,
            paid_at=self.now, expires_at=self.now + timedelta(days=14),
        )

    def listing_ids(self):
        return [item["id"] for item in self.client.get("/api/listings/").json()["results"]]

    def event_ids(self):
        return [item["id"] for item in self.client.get("/api/events/").json()["results"]]

    def add_to_cart(self, listing):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        return client.post("/api/cart/items/", {"listing": listing.id, "quantity": 1}, format="json")

    def test_an_owner_with_no_subscription_is_never_hidden(self):
        # Review Focus 4: no subscription row means no clock, so nothing to hide.
        event = self.make_event(self.unsubscribed, "Tafo harvest fair")
        self.assertEqual(clock.tick(), {"overdue": 0, "reminders": 0, "paused": 0})
        self.assertIn(self.anchor.id, self.listing_ids())
        self.assertEqual(self.client.get(f"/api/listings/{self.anchor.id}/").status_code, 200)
        self.assertIn(event.id, self.event_ids())
        self.assertEqual(self.client.get(f"/api/events/{event.id}/").status_code, 200)
        self.assertEqual(self.add_to_cart(self.anchor).status_code, 201)

    def test_an_overdue_business_stays_visible_during_grace(self):
        self.assertIn(self.overdue_listing.id, self.listing_ids())
        self.assertEqual(self.client.get(f"/api/listings/{self.overdue_listing.id}/").status_code, 200)
        self.assertEqual(self.add_to_cart(self.overdue_listing).status_code, 201)

    def test_a_paused_business_vanishes_from_list_detail_related_and_events(self):
        self.assertNotIn(self.paused_listing.id, self.listing_ids())
        self.assertEqual(self.client.get(f"/api/listings/{self.paused_listing.id}/").status_code, 404)
        related = [item["id"] for item in self.client.get(f"/api/listings/{self.anchor.id}/related/").json()]
        self.assertIn(self.overdue_listing.id, related)
        self.assertNotIn(self.paused_listing.id, related)
        self.assertNotIn(self.paused_event.id, self.event_ids())
        self.assertEqual(self.client.get(f"/api/events/{self.paused_event.id}/").status_code, 404)
        self.paused_listing.refresh_from_db()
        self.assertEqual(self.paused_listing.status, Listing.PUBLISHED)  # hidden, not unpublished

    @override_settings(PAYMENTS_PROVIDER="simulated")
    def test_payment_brings_them_back(self):
        owner_client = APIClient()
        owner_client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.paused, 'business_owner')}")
        response = owner_client.post("/api/billing/transactions/mine/", {
            "kind": "subscription", "amount": "10.00", "purpose": "AshantiHub Product Basic — 1 month",
            "metadata": {"plan": "product_basic", "cycle_months": 1},
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIn(self.paused_listing.id, self.listing_ids())
        self.assertEqual(self.client.get(f"/api/listings/{self.paused_listing.id}/").status_code, 200)
        related = [item["id"] for item in self.client.get(f"/api/listings/{self.anchor.id}/related/").json()]
        self.assertIn(self.paused_listing.id, related)
        self.assertIn(self.paused_event.id, self.event_ids())
        self.assertEqual(self.add_to_cart(self.paused_listing).status_code, 201)

    def test_a_cart_refuses_a_hidden_business_listing_in_plain_words(self):
        response = self.add_to_cart(self.paused_listing)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), NOT_AVAILABLE)
        self.assertFalse(CartItem.objects.exists())
        self.unsubscribed.is_suspended = True
        self.unsubscribed.save(update_fields=["is_suspended"])
        suspended = self.add_to_cart(self.anchor)
        self.assertEqual(suspended.status_code, 400)
        self.assertEqual(suspended.json(), NOT_AVAILABLE)

    def test_the_helper_matches_suspended_or_paused_businesses_only(self):
        suspended = self.make_owner("Suame Auto Parts")
        suspended.is_suspended = True
        suspended.save(update_fields=["is_suspended"])
        mine = [self.unsubscribed.pk, self.paused.pk, self.overdue.pk, suspended.pk]
        hidden = set(
            BusinessOwner.objects.filter(pk__in=mine).filter(hidden_business_q("")).values_list("pk", flat=True)
        )
        self.assertEqual(hidden, {self.paused.pk, suspended.pk})
        hidden_listings = set(Listing.objects.filter(hidden_business_q()).values_list("pk", flat=True))
        self.assertEqual(hidden_listings, {self.paused_listing.pk})

    def test_customer_organised_events_are_unaffected(self):
        event = self.make_event(None, "Ama's naming ceremony", customer=self.customer)
        self.assertIn(event.id, self.event_ids())
