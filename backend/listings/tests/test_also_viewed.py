"""POST /api/listings/<id>/view/ (recording) and GET /api/listings/<id>/also-viewed/ (the carousel's read)."""
import uuid
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, ListingView, Zone


class AlsoViewedBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Ama Shop", login_phone="+233207991001", password_hash="x")
        self.shops = Category.objects.get(slug="shops")
        self.zone = Zone.objects.get(name="Manhyia")
        self.anchor = self.make("Anchor")
        self._n = 0

    def make(self, name, owner=None, status=Listing.PUBLISHED, category=None):
        return Listing.objects.create(
            business_owner=owner or self.owner, category=category or self.shops, zone=self.zone, name=name,
            description="D.", contact_phone="+233207991001", price_amount="10.00", status=status,
        )

    def co_view(self, listing, viewers, anchor=None):
        """`viewers` distinct viewers each viewed both the anchor and `listing` today."""
        anchor = anchor or self.anchor
        for _ in range(viewers):
            self._n += 1
            key = f"a:test{self._n}"
            for target in (anchor, listing):
                ListingView.objects.get_or_create(viewer_key=key, listing=target, day=timezone.localdate())

    def read(self, **params):
        return self.client.get(f"/api/listings/{self.anchor.pk}/also-viewed/", params)


class RecordViewTests(AlsoViewedBase):
    def post(self, body=None, listing=None):
        return self.client.post(f"/api/listings/{(listing or self.anchor).pk}/view/", body or {}, format="json")

    def test_records_one_view_per_viewer_listing_day(self):
        viewer = str(uuid.uuid4())
        for _ in range(3):
            self.assertEqual(self.post({"viewer": viewer}).status_code, 204)
        self.assertEqual(ListingView.objects.count(), 1)
        self.assertEqual(self.post({"viewer": str(uuid.uuid4())}).status_code, 204)
        self.assertEqual(ListingView.objects.count(), 2)

    def test_anonymous_viewer_id_is_hashed_not_stored_raw(self):
        viewer = str(uuid.uuid4())
        response = self.post({"viewer": viewer})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")
        key = ListingView.objects.get().viewer_key
        self.assertTrue(key.startswith("a:"))
        self.assertLessEqual(len(key), 64)
        self.assertNotIn(viewer, key)

    def test_anonymous_without_a_valid_viewer_is_refused(self):
        self.assertEqual(self.post({}).status_code, 400)
        self.assertEqual(self.post({"viewer": "not-a-uuid"}).status_code, 400)
        self.assertFalse(ListingView.objects.exists())

    def test_signed_in_customer_uses_the_customer_key_and_ignores_viewer(self):
        customer = Customer.objects.create(full_name="Yaw", phone="+233200991001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertEqual(self.post({}).status_code, 204)
        self.assertEqual(self.post({"viewer": "junk"}).status_code, 204)
        self.assertEqual(ListingView.objects.get().viewer_key, f"c:{customer.pk}")

    def test_business_owner_session_records_nothing(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        self.assertEqual(self.post({"viewer": str(uuid.uuid4())}).status_code, 204)
        self.assertFalse(ListingView.objects.exists())

    def test_unpublished_or_hidden_listing_is_404_and_records_nothing(self):
        draft = self.make("Draft", status=Listing.DRAFT)
        suspended = BusinessOwner.objects.create(full_name="Bad", login_phone="+233207991002", password_hash="x", is_suspended=True)
        hidden = self.make("Hidden", owner=suspended)
        for listing in (draft, hidden):
            self.assertEqual(self.post({"viewer": str(uuid.uuid4())}, listing=listing).status_code, 404)
        self.assertFalse(ListingView.objects.exists())

    def test_recording_is_throttled(self):
        statuses = [self.post({"viewer": str(uuid.uuid4())}).status_code for _ in range(61)]
        self.assertEqual(statuses[:60], [204] * 60)
        self.assertEqual(statuses[60], 429)


class AlsoViewedReadTests(AlsoViewedBase):
    def test_reading_is_throttled(self):
        statuses = [self.read().status_code for _ in range(61)]
        self.assertEqual(statuses[:60], [200] * 60)
        self.assertEqual(statuses[60], 429)

    def test_co_viewed_needs_three_distinct_viewers_per_row(self):
        rows = [self.make(f"Pair {i}") for i in range(4)]
        for row in rows:
            self.co_view(row, 3)
        weak = self.make("Weak")
        self.co_view(weak, 2)
        body = self.read().json()
        self.assertEqual(body["basis"], "co_viewed")
        ids = [r["id"] for r in body["results"]]
        self.assertEqual(sorted(ids), sorted(r.pk for r in rows))
        self.assertNotIn(weak.pk, ids)

    def test_co_viewed_rows_are_ranked_by_distinct_viewers(self):
        rows = [self.make(f"R{i}") for i in range(4)]
        for row, n in zip(rows, (3, 6, 4, 5)):
            self.co_view(row, n)
        ids = [r["id"] for r in self.read().json()["results"]]
        self.assertEqual(ids, [rows[1].pk, rows[3].pk, rows[2].pk, rows[0].pk])

    def test_fewer_than_four_qualifying_rows_falls_back_to_same_category_with_basis_flag(self):
        qualifying = [self.make(f"Q{i}") for i in range(3)]
        for row in qualifying:
            self.co_view(row, 3)
        sibling = self.make("Sibling")
        other = self.make("Other category", category=Category.objects.get(slug="food"))
        body = self.read().json()
        self.assertEqual(body["basis"], "same_category")
        ids = {r["id"] for r in body["results"]}
        self.assertEqual(ids, {r.pk for r in qualifying} | {sibling.pk})
        self.assertNotIn(other.pk, ids)

    def test_limit_caps_results_and_is_clamped(self):
        for i in range(30):
            self.make(f"S{i}")
        self.assertEqual(len(self.read().json()["results"]), 12)
        self.assertEqual(len(self.read(limit=5).json()["results"]), 5)
        self.assertEqual(len(self.read(limit=500).json()["results"]), 24)
        self.assertEqual(len(self.read(limit=0).json()["results"]), 1)
        self.assertEqual(len(self.read(limit="x").json()["results"]), 12)

    def test_views_older_than_30_days_are_ignored(self):
        rows = [self.make(f"Old{i}") for i in range(4)]
        for row in rows:
            self.co_view(row, 3)
        ListingView.objects.update(viewed_at=timezone.now() - timedelta(days=31))
        self.assertEqual(self.read().json()["basis"], "same_category")

    def test_hidden_business_and_draft_listings_never_appear(self):
        good = [self.make(f"Good{i}") for i in range(4)]
        suspended = BusinessOwner.objects.create(full_name="Bad", login_phone="+233207991003", password_hash="x", is_suspended=True)
        hidden = self.make("Hidden", owner=suspended)
        draft = self.make("Draft", status=Listing.DRAFT)
        for row in good + [hidden, draft]:
            self.co_view(row, 4)
        for body in (self.read().json(),):
            ids = {r["id"] for r in body["results"]}
            self.assertEqual(ids, {r.pk for r in good})
        # and in the fallback
        ListingView.objects.all().delete()
        ids = {r["id"] for r in self.read().json()["results"]}
        self.assertNotIn(hidden.pk, ids)
        self.assertNotIn(draft.pk, ids)

    def test_anchor_is_excluded(self):
        rows = [self.make(f"A{i}") for i in range(4)]
        for row in rows:
            self.co_view(row, 3)
        self.assertNotIn(self.anchor.pk, [r["id"] for r in self.read().json()["results"]])
        ListingView.objects.all().delete()
        self.assertNotIn(self.anchor.pk, [r["id"] for r in self.read().json()["results"]])

    def test_unknown_or_hidden_anchor_is_404(self):
        self.assertEqual(self.client.get("/api/listings/999999/also-viewed/").status_code, 404)
        draft = self.make("Draft", status=Listing.DRAFT)
        self.assertEqual(self.client.get(f"/api/listings/{draft.pk}/also-viewed/").status_code, 404)

    def test_rows_are_the_card_rows_of_the_public_list(self):
        self.make("Sibling")
        row = self.read().json()["results"][0]
        listed = next(r for r in self.client.get("/api/listings/").json()["results"] if r["id"] == row["id"])
        self.assertEqual(set(row), set(listed))
