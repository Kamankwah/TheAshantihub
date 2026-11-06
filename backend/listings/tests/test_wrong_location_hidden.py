"""A business whose location staff marked wrong is hidden from public browse 7 days after the decision, behind
WRONG_LOCATION_HIDE_ENABLED (self-serve phase 2, owner decision 5). One rule, listings.visibility.hidden_business_q;
a new pin clears the decision, so re-sharing brings the business back with no extra code."""
from datetime import timedelta
from io import StringIO
from itertools import count

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from listings.models import Category, Listing, Zone
from listings.visibility import hidden_business_q
from storefront.search import run as run_search

_phones = count(100)
NOT_AVAILABLE = {"listing": ["This item isn't available right now."]}
KUMASI = {"lat": 6.6885, "lng": -1.6244, "accuracy_m": 12}


@override_settings(WRONG_LOCATION_HIDE_ENABLED=True, WRONG_LOCATION_HIDE_DAYS=7)
class WrongLocationHiddenTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.shops = Category.objects.get(slug="shops")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.now = timezone.now()
        self.fresh = self.make_owner("Fresh Wrong Stores", decided_days_ago=6, verified=False)
        self.stale = self.make_owner("Stale Wrong Stores", decided_days_ago=8, verified=False)
        self.verified = self.make_owner("Verified Stores", decided_days_ago=30, verified=True)
        self.undecided = self.make_owner("Undecided Stores", decided_days_ago=None, verified=False)
        self.no_profile = BusinessOwner.objects.create(
            full_name="No profile owner", login_phone=f"+233207661{next(_phones):03d}", password_hash="x",
        )
        self.listings = {
            name: self.make_listing(owner, f"{name} lantern")
            for name, owner in (
                ("fresh", self.fresh), ("stale", self.stale), ("verified", self.verified),
                ("undecided", self.undecided), ("noprofile", self.no_profile),
            )
        }
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200771302", password_hash="x")

    def make_owner(self, name, *, decided_days_ago, verified):
        owner = BusinessOwner.objects.create(
            full_name=f"{name} owner", login_phone=f"+233207661{next(_phones):03d}", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name=name, lat=6.69, lng=-1.62,
            address_verified=verified,
            address_verified_at=None if decided_days_ago is None else self.now - timedelta(days=decided_days_ago),
        )
        return owner

    def make_listing(self, owner, name):
        return Listing.objects.create(
            business_owner=owner, category=self.shops, zone=self.manhyia, name=name,
            description="D.", contact_phone="+233207660999", price_amount="150.00", status=Listing.PUBLISHED,
        )

    def listing_ids(self):
        return {item["id"] for item in self.client.get("/api/listings/").json()["results"]}

    def add_to_cart(self, listing):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        return client.post("/api/cart/items/", {"listing": listing.id, "quantity": 1}, format="json")

    def test_six_days_is_visible_and_eight_days_is_hidden_from_the_public_list_and_detail(self):
        ids = self.listing_ids()
        self.assertIn(self.listings["fresh"].id, ids)
        self.assertNotIn(self.listings["stale"].id, ids)
        self.assertEqual(self.client.get(f"/api/listings/{self.listings['fresh'].id}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/listings/{self.listings['stale'].id}/").status_code, 404)
        self.listings["stale"].refresh_from_db()
        self.assertEqual(self.listings["stale"].status, Listing.PUBLISHED)  # hidden, not unpublished

    def test_hidden_from_search(self):
        names = {row["name"] for row in run_search("lantern")["products"]}
        self.assertIn("fresh lantern", {n.lower() for n in names})
        self.assertNotIn("stale lantern", {n.lower() for n in names})

    def test_add_to_cart_refuses_a_hidden_business(self):
        response = self.add_to_cart(self.listings["stale"])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), NOT_AVAILABLE)
        self.assertEqual(self.add_to_cart(self.listings["fresh"]).status_code, 201)

    def test_verified_undecided_and_profileless_businesses_are_never_hidden(self):
        ids = self.listing_ids()
        for name in ("verified", "undecided", "noprofile"):
            self.assertIn(self.listings[name].id, ids, name)

    def test_the_helper_works_from_the_owner_and_from_a_listing(self):
        hidden_owners = set(BusinessOwner.objects.filter(hidden_business_q("")).values_list("pk", flat=True))
        self.assertEqual(hidden_owners, {self.stale.pk})
        hidden_listings = set(Listing.objects.filter(hidden_business_q()).values_list("pk", flat=True))
        self.assertEqual(hidden_listings, {self.listings["stale"].pk})
        visible = set(Listing.objects.exclude(hidden_business_q()).values_list("pk", flat=True))
        self.assertEqual(visible, {v.pk for k, v in self.listings.items() if k != "stale"})

    def test_the_decision_exactly_at_the_limit_is_hidden(self):
        profile = self.fresh.profile
        profile.address_verified_at = timezone.now() - timedelta(days=7, seconds=5)
        profile.save()
        self.assertEqual(
            set(BusinessOwner.objects.filter(hidden_business_q("")).values_list("pk", flat=True)),
            {self.stale.pk, self.fresh.pk},
        )

    def test_resharing_a_pin_clears_the_decision_and_brings_the_business_back(self):
        self.assertNotIn(self.listings["stale"].id, self.listing_ids())
        owner_client = APIClient()
        owner_client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.stale, 'business_owner')}")
        response = owner_client.post("/api/accounts/me/location/", KUMASI, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        profile = BusinessOwnerProfile.objects.get(business_owner=self.stale)
        self.assertIsNone(profile.address_verified_at)
        self.assertIn(self.listings["stale"].id, self.listing_ids())
        self.assertEqual(self.add_to_cart(self.listings["stale"]).status_code, 201)

    def test_open_orders_are_untouched_the_filter_is_public_browse_only(self):
        # Nothing is unpublished or deleted; the owner still sees their own listing.
        owner_client = APIClient()
        owner_client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.stale, 'business_owner')}")
        mine = owner_client.get("/api/listings/mine/")
        self.assertEqual(mine.status_code, 200)
        self.assertIn(self.listings["stale"].id, {row["id"] for row in mine.json()})

    @override_settings(WRONG_LOCATION_HIDE_ENABLED=False)
    def test_with_the_switch_off_nothing_is_hidden(self):
        ids = self.listing_ids()
        for listing in self.listings.values():
            self.assertIn(listing.id, ids)
        self.assertFalse(Listing.objects.filter(hidden_business_q()).exists())
        self.assertEqual(self.add_to_cart(self.listings["stale"]).status_code, 201)

    def test_the_dry_run_lists_exactly_the_businesses_the_filter_hides_and_changes_nothing(self):
        before = list(BusinessOwnerProfile.objects.order_by("pk").values_list("pk", "address_verified_at"))
        out = StringIO()
        call_command("list_wrong_location_businesses", stdout=out)
        text = out.getvalue()
        self.assertIn(f"{self.stale.pk}\t", text)
        self.assertIn("Stale Wrong Stores", text)
        self.assertIn("8", text.split("Stale Wrong Stores")[1].splitlines()[0])  # days since the decision
        for other in (self.fresh, self.verified, self.undecided, self.no_profile):
            self.assertNotIn(f"{other.pk}\t", text)
        self.assertEqual(before, list(BusinessOwnerProfile.objects.order_by("pk").values_list("pk", "address_verified_at")))
        self.assertTrue(Listing.objects.filter(status=Listing.PUBLISHED).count() == 5)

    @override_settings(WRONG_LOCATION_HIDE_ENABLED=False)
    def test_the_dry_run_still_lists_who_would_be_hidden_while_the_switch_is_off(self):
        out = StringIO()
        call_command("list_wrong_location_businesses", stdout=out)
        self.assertIn(f"{self.stale.pk}\t", out.getvalue())
        self.assertIn("switch is OFF", out.getvalue())
        self.assertFalse(Listing.objects.filter(hidden_business_q()).exists())  # and it hid nothing
