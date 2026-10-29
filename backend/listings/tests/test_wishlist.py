"""/api/wishlist/ - a customer's saved listings (marketplace Plan 4, contract A3)."""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Listing, WishlistItem, Zone
from storefront.testing import close_marketplace

CANT_SAVE = {"listing": ["This item can't be saved."]}


def auth(account, kind):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
    return client


class WishlistTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = BusinessOwner.objects.create(full_name="Ama Shop", login_phone="+233207994001", password_hash="x")
        self.customer = Customer.objects.create(full_name="Yaw", phone="+233200994001", password_hash="x")
        self.other = Customer.objects.create(full_name="Kofi", phone="+233200994002", password_hash="x")
        self.client = auth(self.customer, "customer")
        self.other_client = auth(self.other, "customer")

    def make(self, name, owner=None, status=Listing.PUBLISHED):
        return Listing.objects.create(
            business_owner=owner or self.owner, category=Category.objects.get(slug="shops"),
            zone=Zone.objects.get(name="Manhyia"), name=name, description="D.", contact_phone="+233207994001",
            price_amount="10.00", status=status,
        )

    def add(self, listing, client=None):
        return (client or self.client).post("/api/wishlist/", {"listing": listing.pk}, format="json")

    def test_add_is_idempotent(self):
        listing = self.make("Kente")
        first = self.add(listing)
        self.assertEqual(first.status_code, 201, first.content)
        second = self.add(listing)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(second.json()["listing"]["id"], listing.pk)
        self.assertEqual(WishlistItem.objects.filter(customer=self.customer).count(), 1)

    def test_list_is_newest_first_with_card_rows(self):
        old, new = self.make("Old"), self.make("New")
        a = WishlistItem.objects.create(customer=self.customer, listing=old)
        b = WishlistItem.objects.create(customer=self.customer, listing=new)
        WishlistItem.objects.filter(pk=a.pk).update(added_at=timezone.now() - timedelta(days=1))
        response = self.client.get("/api/wishlist/")
        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertIsInstance(rows, list)
        self.assertEqual([r["id"] for r in rows], [b.pk, a.pk])
        self.assertEqual([r["listing"]["name"] for r in rows], ["New", "Old"])
        self.assertIn("added_at", rows[0])
        public = self.client.get("/api/listings/").json()
        public_rows = public["results"] if isinstance(public, dict) else public
        self.assertEqual(set(rows[0]["listing"]), set(public_rows[0]))

    def test_another_customers_item_is_not_visible_or_deletable(self):
        listing = self.make("Kente")
        self.add(listing, client=self.other_client)
        self.assertEqual(self.client.get("/api/wishlist/").json(), [])
        self.assertEqual(self.client.delete(f"/api/wishlist/{listing.pk}/").status_code, 404)
        self.assertEqual(WishlistItem.objects.filter(customer=self.other).count(), 1)
        self.assertEqual(self.other_client.delete(f"/api/wishlist/{listing.pk}/").status_code, 204)
        self.assertFalse(WishlistItem.objects.exists())

    def test_hidden_business_item_is_not_listed(self):
        shown = self.make("Shown")
        hidden_owner = BusinessOwner.objects.create(
            full_name="Gone", login_phone="+233207994002", password_hash="x", is_suspended=True,
        )
        hidden = self.make("Hidden", owner=hidden_owner)
        WishlistItem.objects.create(customer=self.customer, listing=hidden)
        WishlistItem.objects.create(customer=self.customer, listing=shown)
        names = [r["listing"]["name"] for r in self.client.get("/api/wishlist/").json()]
        self.assertEqual(names, ["Shown"])
        self.assertEqual(WishlistItem.objects.count(), 2)  # kept, just not listed
        response = self.add(hidden)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), CANT_SAVE)

    def test_unpublished_listing_cannot_be_added(self):
        for status in (Listing.DRAFT, Listing.DISCONTINUED):
            response = self.add(self.make(f"L {status}", status=status))
            self.assertEqual(response.status_code, 400, status)
            self.assertEqual(response.json(), CANT_SAVE)
        missing = self.client.post("/api/wishlist/", {"listing": 999999}, format="json")
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json(), CANT_SAVE)
        self.assertFalse(WishlistItem.objects.exists())

    def test_unpublished_saved_item_is_not_listed(self):
        listing = self.make("Kente")
        self.add(listing)
        Listing.objects.filter(pk=listing.pk).update(status=Listing.DISCONTINUED)
        self.assertEqual(self.client.get("/api/wishlist/").json(), [])

    def test_sold_out_item_still_listed(self):
        listing = self.make("Kente")
        Listing.objects.filter(pk=listing.pk).update(stock_quantity=0)
        self.assertEqual(self.add(listing).status_code, 201)
        self.assertEqual(len(self.client.get("/api/wishlist/").json()), 1)

    def test_staff_forbidden(self):
        staff = StaffUser.objects.create(
            email="s@example.com", full_name="S", password_hash="x", role=Role.objects.get(name=Role.SUPPORT),
        )
        client = auth(staff, "staff")
        self.assertEqual(client.get("/api/wishlist/").status_code, 403)
        self.assertEqual(client.post("/api/wishlist/", {"listing": self.make("K").pk}, format="json").status_code, 403)
        self.assertEqual(client.delete("/api/wishlist/1/").status_code, 403)

    def test_business_owner_forbidden_and_anonymous_401(self):
        owner_client = auth(self.owner, "business_owner")
        self.assertEqual(owner_client.get("/api/wishlist/").status_code, 403)
        self.assertEqual(self.add(self.make("K"), client=owner_client).status_code, 403)
        anon = APIClient()
        self.assertEqual(anon.get("/api/wishlist/").status_code, 401)
        self.assertEqual(anon.post("/api/wishlist/", {"listing": 1}, format="json").status_code, 401)
        self.assertEqual(anon.delete("/api/wishlist/1/").status_code, 401)

    @override_settings(MARKETPLACE_GATE_ENABLED=True)
    def test_works_while_the_marketplace_is_closed(self):
        close_marketplace()
        listing = self.make("Kente")
        self.assertEqual(self.add(listing).status_code, 201)
        self.assertEqual(len(self.client.get("/api/wishlist/").json()), 1)
        self.assertEqual(self.client.delete(f"/api/wishlist/{listing.pk}/").status_code, 204)
