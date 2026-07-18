from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser

from listings.models import Category, Listing, Promotion, Zone

LIST_URL = "/api/listings/promotions/"


class PromotionAdminQueueTests(TestCase):
    """Staff promotions management (punch-list item 7 + pre-prod bug fix 7).

    A purchased promotion is now moderated: it is created Pending and a
    staffer approves it (→ Active) or rejects it. The queue tabs are
    Pending/Active/Rejected plus the derived Expired and the Cancelled lifecycle.
    """

    def setUp(self):
        self.client = APIClient()
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-promo@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.support = StaffUser.objects.create(
            full_name="Support Person", email="support-promo@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Traders", login_phone="+233207884400", password_hash="x",
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"),
            zone=Zone.objects.get(name="Manhyia"), name="Royal Lodge",
            description="A lodge.", contact_phone="+233207112233",
            price_amount="100.00", status=Listing.PUBLISHED,
        )
        now = timezone.now()

        self.running = Promotion.objects.create(
            listing=self.listing, kind=Promotion.FEATURED,
            starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=6),
            amount_paid="5.00", status=Promotion.ACTIVE,
        )
        # Bought, window not yet open — still Active, but not ranking.
        self.scheduled = Promotion.objects.create(
            listing=self.listing, kind=Promotion.BOOST, keywords="kente",
            starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=8),
            amount_paid="3.00", status=Promotion.ACTIVE,
        )
        # The load-bearing case: a finished promotion still reads
        # status="active" because nothing ever flips it. It must land on
        # Expired, derived from the time window.
        self.finished = Promotion.objects.create(
            listing=self.listing, kind=Promotion.FEATURED,
            starts_at=now - timedelta(days=30), ends_at=now - timedelta(days=1),
            amount_paid="5.00", status=Promotion.ACTIVE,
        )
        self.cancelled = Promotion.objects.create(
            listing=self.listing, kind=Promotion.BOOST, keywords="beads",
            starts_at=now - timedelta(days=5), ends_at=now + timedelta(days=2),
            amount_paid="3.00", status=Promotion.CANCELLED,
        )
        # Paid, awaiting staff approval — the new default queue tab.
        self.pending = Promotion.objects.create(
            listing=self.listing, kind=Promotion.FEATURED,
            starts_at=now, ends_at=now + timedelta(days=7),
            amount_paid="5.00", status=Promotion.PENDING,
        )

    def _auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def test_list_requires_promotions_manage(self):
        self._auth(self.support)
        self.assertEqual(self.client.get(LIST_URL).status_code, 403)

    def test_default_tab_is_pending(self):
        self._auth(self.marketing)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200, response.content)
        ids = [p["id"] for p in response.json()]
        self.assertEqual(ids, [self.pending.id])

    def test_active_tab_lists_running_and_scheduled(self):
        self._auth(self.marketing)
        ids = [p["id"] for p in self.client.get(f"{LIST_URL}?status=active").json()]
        self.assertCountEqual(ids, [self.running.id, self.scheduled.id])

    def test_expired_tab_derives_from_the_time_window_not_the_status_field(self):
        self._auth(self.marketing)
        ids = [p["id"] for p in self.client.get(f"{LIST_URL}?status=expired").json()]
        self.assertEqual(ids, [self.finished.id])

    def test_cancelled_tab_lists_cancelled_promotions(self):
        self._auth(self.marketing)
        ids = [p["id"] for p in self.client.get(f"{LIST_URL}?status=cancelled").json()]
        self.assertEqual(ids, [self.cancelled.id])

    def test_a_cancelled_promotion_never_shows_as_active(self):
        """Its window is still open, so only `status` keeps it off Active."""
        self._auth(self.marketing)
        ids = [p["id"] for p in self.client.get(LIST_URL).json()]
        self.assertNotIn(self.cancelled.id, ids)

    def test_list_surfaces_listing_and_business_names(self):
        self._auth(self.marketing)
        row = next(p for p in self.client.get(f"{LIST_URL}?status=active").json() if p["id"] == self.running.id)
        self.assertEqual(row["listing_name"], "Royal Lodge")
        self.assertEqual(row["business_owner_name"], "Kwame Traders")

    def test_is_currently_active_distinguishes_running_from_scheduled(self):
        self._auth(self.marketing)
        rows = {p["id"]: p for p in self.client.get(f"{LIST_URL}?status=active").json()}
        self.assertTrue(rows[self.running.id]["is_currently_active"])
        self.assertFalse(rows[self.scheduled.id]["is_currently_active"])


class PromotionCancelTests(PromotionAdminQueueTests):
    def test_cancel_requires_promotions_manage(self):
        self._auth(self.support)
        response = self.client.post(f"{LIST_URL}{self.running.id}/cancel/")
        self.assertEqual(response.status_code, 403)

    def test_cancel_stops_an_active_promotion(self):
        self._auth(self.marketing)
        response = self.client.post(f"{LIST_URL}{self.running.id}/cancel/")
        self.assertEqual(response.status_code, 200, response.content)
        self.running.refresh_from_db()
        self.assertEqual(self.running.status, Promotion.CANCELLED)
        self.assertFalse(self.running.is_currently_active)

    def test_cancel_does_not_refund(self):
        """Cancelling stops the ranking boost; amount_paid is untouched."""
        self._auth(self.marketing)
        self.client.post(f"{LIST_URL}{self.running.id}/cancel/")
        self.running.refresh_from_db()
        self.assertEqual(str(self.running.amount_paid), "5.00")

    def test_cancel_rejects_an_already_cancelled_promotion(self):
        self._auth(self.marketing)
        response = self.client.post(f"{LIST_URL}{self.cancelled.id}/cancel/")
        self.assertEqual(response.status_code, 400)

    def test_cancel_rejects_a_finished_promotion(self):
        self._auth(self.marketing)
        response = self.client.post(f"{LIST_URL}{self.finished.id}/cancel/")
        self.assertEqual(response.status_code, 400)

    def test_cancelled_promotion_stops_affecting_ranking(self):
        """The end-to-end point of cancelling: it must drop out of the
        public browse ranking, which reads status=active AND the window.
        """
        self._auth(self.marketing)
        self.client.post(f"{LIST_URL}{self.running.id}/cancel/")
        self.client.credentials()
        response = self.client.get("/api/listings/")
        row = next(r for r in response.json()["results"] if r["id"] == self.listing.id)
        self.assertFalse(row["is_promoted"])


class PromotionApprovalTests(PromotionAdminQueueTests):
    """The pending → approve/reject moderation flow (pre-prod bug fix 7)."""

    def test_pending_tab_lists_pending_promotions(self):
        self._auth(self.marketing)
        ids = [p["id"] for p in self.client.get(f"{LIST_URL}?status=pending").json()]
        self.assertEqual(ids, [self.pending.id])

    def _fresh_listing(self):
        # A listing with no promotions of its own, so a single pending/rejected
        # promotion is the only thing that could mark it promoted (self.listing
        # already carries the parent setUp's live self.running promotion).
        return Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"),
            zone=Zone.objects.get(name="Manhyia"), name="Fresh Lodge",
            description="A lodge.", contact_phone="+233207112244",
            price_amount="120.00", status=Listing.PUBLISHED,
        )

    def test_a_pending_promotion_does_not_affect_ranking(self):
        now = timezone.now()
        listing = self._fresh_listing()
        Promotion.objects.create(
            listing=listing, kind=Promotion.FEATURED, starts_at=now,
            ends_at=now + timedelta(days=7), amount_paid="5.00", status=Promotion.PENDING,
        )
        self.client.credentials()
        row = next(r for r in self.client.get("/api/listings/").json()["results"] if r["id"] == listing.id)
        self.assertFalse(row["is_promoted"])

    def test_approve_requires_promotions_manage(self):
        self._auth(self.support)
        response = self.client.post(f"{LIST_URL}{self.pending.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_approve_activates_and_rebases_the_window(self):
        self._auth(self.marketing)
        response = self.client.post(f"{LIST_URL}{self.pending.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, Promotion.ACTIVE)
        self.assertTrue(self.pending.is_currently_active)
        # The 7-day paid window is preserved and now runs from approval.
        self.assertEqual((self.pending.ends_at - self.pending.starts_at).days, 7)

    def test_approved_promotion_affects_ranking(self):
        self._auth(self.marketing)
        self.client.post(f"{LIST_URL}{self.pending.id}/approve/")
        self.client.credentials()
        row = next(r for r in self.client.get("/api/listings/").json()["results"] if r["id"] == self.listing.id)
        self.assertTrue(row["is_promoted"])

    def test_approve_rejects_a_non_pending_promotion(self):
        self._auth(self.marketing)
        response = self.client.post(f"{LIST_URL}{self.running.id}/approve/")
        self.assertEqual(response.status_code, 400)

    def test_reject_requires_promotions_manage(self):
        self._auth(self.support)
        response = self.client.post(f"{LIST_URL}{self.pending.id}/reject/", {"reason": "no"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_reject_marks_rejected_with_reason(self):
        self._auth(self.marketing)
        response = self.client.post(
            f"{LIST_URL}{self.pending.id}/reject/", {"reason": "Misleading keywords."}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, Promotion.REJECTED)
        self.assertEqual(self.pending.rejection_reason, "Misleading keywords.")

    def test_rejected_promotion_never_affects_ranking(self):
        now = timezone.now()
        listing = self._fresh_listing()
        promo = Promotion.objects.create(
            listing=listing, kind=Promotion.FEATURED, starts_at=now,
            ends_at=now + timedelta(days=7), amount_paid="5.00", status=Promotion.PENDING,
        )
        self._auth(self.marketing)
        self.client.post(f"{LIST_URL}{promo.id}/reject/", {"reason": "no"}, format="json")
        self.client.credentials()
        row = next(r for r in self.client.get("/api/listings/").json()["results"] if r["id"] == listing.id)
        self.assertFalse(row["is_promoted"])

    def test_reject_rejects_a_non_pending_promotion(self):
        self._auth(self.marketing)
        response = self.client.post(f"{LIST_URL}{self.running.id}/reject/", {"reason": "no"}, format="json")
        self.assertEqual(response.status_code, 400)
