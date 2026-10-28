"""Drop (reversible) and Discontinue (permanent): the owner's two ways to take a listing off sale."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from billing.models import Subscription, SubscriptionPlan
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem


class ListingLifecycleTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207771001", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, ghana_card_number="GHA-777111001-1",
            gps_address="AK-039-7001", business_contact_phone="+233207771001",
            is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
            payout_momo_number="+233207771001", payout_momo_name="Kofi Trader",
        )
        self.other = BusinessOwner.objects.create(
            full_name="Ama Seller", login_phone="+233207771002", password_hash="x",
        )
        self.customer = Customer.objects.create(full_name="Yaw Buyer", phone="+233200771001", password_hash="x")
        self.shops = Category.objects.get(slug="shops")
        self.zone = Zone.objects.get(name="Manhyia")
        now = timezone.now()
        Subscription.objects.create(
            business_owner=self.owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )
        self.listing = self.make("Kente Cloth")

    def make(self, name, status=Listing.PUBLISHED):
        return Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.zone, name=name,
            description="D.", contact_phone="+233207771001", price_amount="100.00", status=status,
        )

    def auth(self, who, kind="business_owner"):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who, kind)}")

    def act(self, listing, verb):
        self.auth(self.owner)
        return self.client.post(f"/api/listings/mine/{listing.pk}/{verb}/", {}, format="json")

    def public_ids(self):
        self.client.credentials()
        rows = self.client.get("/api/listings/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        return {row["id"] for row in rows}

    def test_drop_hides_a_published_listing_from_every_public_view(self):
        other = self.make("Other Cloth")
        self.assertIn(self.listing.pk, self.public_ids())
        response = self.act(self.listing, "drop")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"id": self.listing.pk, "status": "dropped"})
        self.assertNotIn(self.listing.pk, self.public_ids())
        self.client.credentials()
        self.assertEqual(self.client.get(f"/api/listings/{self.listing.pk}/").status_code, 404)
        related = self.client.get(f"/api/listings/{other.pk}/related/").json()
        related = related["results"] if isinstance(related, dict) else related
        self.assertNotIn(self.listing.pk, {row["id"] for row in related})
        self.auth(self.customer, "customer")
        added = self.client.post("/api/cart/items/", {"listing": self.listing.pk, "quantity": 1}, format="json")
        self.assertEqual(added.status_code, 400, added.content)

    def test_restore_returns_it_without_re_approval(self):
        Listing.objects.filter(pk=self.listing.pk).update(reviewed_at=timezone.now())
        before = Listing.objects.get(pk=self.listing.pk)
        self.act(self.listing, "drop")
        response = self.act(self.listing, "restore")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "published")
        after = Listing.objects.get(pk=self.listing.pk)
        self.assertEqual(after.reviewed_by_id, before.reviewed_by_id)
        self.assertEqual(after.reviewed_at, before.reviewed_at)
        self.assertIsNone(after.dropped_at)
        self.assertIn(self.listing.pk, self.public_ids())

    def test_only_published_can_be_dropped(self):
        for status in (Listing.DRAFT, Listing.PENDING_REVIEW, Listing.REJECTED, Listing.DROPPED, Listing.DISCONTINUED):
            listing = self.make(f"L {status}", status=status)
            response = self.act(listing, "drop")
            self.assertEqual(response.status_code, 400, status)
            self.assertIn("status", response.json())
        self.assertEqual(self.act(self.listing, "restore").status_code, 400)

    def test_discontinue_is_permanent_and_cannot_be_restored(self):
        response = self.act(self.listing, "discontinue")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "discontinued")
        self.assertIsNotNone(Listing.objects.get(pk=self.listing.pk).discontinued_at)
        self.assertEqual(self.act(self.listing, "restore").status_code, 400)
        self.assertEqual(self.act(self.listing, "drop").status_code, 400)
        self.assertEqual(self.act(self.listing, "discontinue").status_code, 400)
        self.assertNotIn(self.listing.pk, self.public_ids())

    def test_discontinue_a_draft_or_rejected_listing_is_allowed(self):
        for status in (Listing.DRAFT, Listing.REJECTED, Listing.DROPPED):
            listing = self.make(f"L {status}", status=status)
            self.assertEqual(self.act(listing, "discontinue").status_code, 200, status)
        pending = self.make("Waiting", status=Listing.PENDING_REVIEW)
        self.assertEqual(self.act(pending, "discontinue").status_code, 400)

    def test_another_owner_cannot_drop(self):
        self.auth(self.other)
        response = self.client.post(f"/api/listings/mine/{self.listing.pk}/drop/", {}, format="json")
        self.assertIn(response.status_code, (403, 404))
        self.assertEqual(Listing.objects.get(pk=self.listing.pk).status, Listing.PUBLISHED)

    def test_a_dropped_listing_refuses_edits_and_submit(self):
        self.act(self.listing, "drop")
        edit = self.client.patch(f"/api/listings/mine/{self.listing.pk}/", {"name": "New name"}, format="json")
        self.assertEqual(edit.status_code, 400, edit.content)
        self.assertEqual(self.act(self.listing, "submit").status_code, 400)
        self.act(self.listing, "discontinue")
        self.assertEqual(self.act(self.listing, "submit").status_code, 400)

    def test_live_stock_edit_is_allowed_dropped_and_refused_discontinued(self):
        self.act(self.listing, "drop")
        ok = self.client.post(f"/api/listings/mine/{self.listing.pk}/restock/", {"stock_quantity": 5}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        manage = self.client.patch(f"/api/listings/mine/{self.listing.pk}/manage/", {"price_amount": "90.00"}, format="json")
        self.assertEqual(manage.status_code, 200, manage.content)
        self.act(self.listing, "discontinue")
        no = self.client.post(f"/api/listings/mine/{self.listing.pk}/restock/", {"stock_quantity": 9}, format="json")
        self.assertEqual(no.status_code, 400, no.content)
        no = self.client.patch(f"/api/listings/mine/{self.listing.pk}/manage/", {"price_amount": "80.00"}, format="json")
        self.assertEqual(no.status_code, 400, no.content)

    def test_owner_serializer_exposes_the_timestamps(self):
        self.act(self.listing, "drop")
        rows = self.client.get("/api/listings/mine/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        row = next(r for r in rows if r["id"] == self.listing.pk)
        self.assertEqual(row["status"], "dropped")
        self.assertIsNotNone(row["dropped_at"])
        self.assertIsNone(row["discontinued_at"])

    def test_review_focus_old_orders_still_show_a_discontinued_listing(self):
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount="100.00")
        OrderItem.objects.create(order=order, listing=self.listing, quantity=1, unit_price="100.00", line_total="100.00")
        self.assertEqual(self.act(self.listing, "discontinue").status_code, 200)
        self.auth(self.customer, "customer")
        response = self.client.get(f"/api/orders/{order.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        items = response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["listing_name"], "Kente Cloth")

    def test_dropped_listing_does_not_count_against_the_plan_limit(self):
        plan = Subscription.objects.get(business_owner=self.owner).plan
        cap = plan.max_active_listings
        self.assertIsNotNone(cap)
        Listing.objects.filter(pk=self.listing.pk).delete()
        for i in range(cap):
            self.make(f"Live {i}")
        body = {"category": self.shops.id, "zone": self.zone.id, "name": "One More", "description": "D.",
                "has_warranty": False, "has_expiry": False, "return_policy": "No returns."}
        self.auth(self.owner)
        self.assertEqual(self.client.post("/api/listings/mine/", body, format="json").status_code, 400)
        self.act(Listing.objects.filter(business_owner=self.owner).first(), "drop")
        response = self.client.post("/api/listings/mine/", body, format="json")
        self.assertEqual(response.status_code, 201, response.content)
