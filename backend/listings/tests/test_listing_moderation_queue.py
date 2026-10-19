from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from listings.models import Category, Listing, Zone


class ListingModerationQueueTests(TestCase):
    """Staff moderation-queue restructuring (items 1 & 2) — three-state
    (?status=) queue, approver attribution, business grouping, and re-review."""

    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-modq@example.com", password_hash="x",
            role=Role.objects.get(name="operations"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Verified Trader", login_phone="+233207550001", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        self.pending = self._listing("Pending Lodge", Listing.PENDING_REVIEW)
        self.published = self._listing("Published Lodge", Listing.PUBLISHED)
        self.rejected = self._listing(
            "Rejected Lodge", Listing.REJECTED, rejection_reason="Too short"
        )

    def _listing(self, name, status, rejection_reason=None):
        return Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name=name, description="D.", contact_phone="+233207550001",
            status=status, rejection_reason=rejection_reason,
        )

    def _auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")

    def test_default_queue_is_pending(self):
        self._auth()
        response = self.client.get("/api/listings/moderation/pending/")
        self.assertEqual([l["id"] for l in response.json()], [self.pending.id])

    def test_approved_tab_lists_published(self):
        self._auth()
        response = self.client.get("/api/listings/moderation/pending/?status=approved")
        self.assertEqual([l["id"] for l in response.json()], [self.published.id])

    def test_rejected_tab_lists_rejected_with_reason(self):
        self._auth()
        response = self.client.get("/api/listings/moderation/pending/?status=rejected")
        body = response.json()
        self.assertEqual([l["id"] for l in body], [self.rejected.id])
        self.assertEqual(body[0]["rejection_reason"], "Too short")

    def test_serializer_exposes_business_owner_name(self):
        self._auth()
        response = self.client.get("/api/listings/moderation/pending/")
        self.assertEqual(response.json()[0]["business_owner_name"], "Verified Trader")

    def test_approve_records_reviewer_and_is_surfaced(self):
        self._auth()
        self.client.post(f"/api/listings/moderation/{self.pending.id}/approve/")
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending.reviewed_at)
        response = self.client.get("/api/listings/moderation/pending/?status=approved")
        row = next(l for l in response.json() if l["id"] == self.pending.id)
        self.assertEqual(row["reviewed_by_name"], "Admin Person")

    def test_reject_records_reviewer(self):
        self._auth()
        self.client.post(
            f"/api/listings/moderation/{self.pending.id}/reject/",
            {"reason": "Needs work"}, format="json",
        )
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending.reviewed_at)

    def test_re_review_moves_rejected_back_to_pending_and_clears(self):
        self.rejected.reviewed_by = self.admin
        self.rejected.save(update_fields=["reviewed_by"])
        self._auth()
        response = self.client.post(f"/api/listings/moderation/{self.rejected.id}/re-review/")
        self.assertEqual(response.status_code, 200)
        self.rejected.refresh_from_db()
        self.assertEqual(self.rejected.status, Listing.PENDING_REVIEW)
        self.assertIsNone(self.rejected.rejection_reason)
        self.assertIsNone(self.rejected.reviewed_by)
        self.assertIsNone(self.rejected.reviewed_at)

    def test_re_review_rejects_a_non_rejected_listing(self):
        self._auth()
        response = self.client.post(f"/api/listings/moderation/{self.published.id}/re-review/")
        self.assertEqual(response.status_code, 400)

    def test_re_review_requires_moderate_permission(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant", email="acc-modq@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(accountant, 'staff')}")
        response = self.client.post(f"/api/listings/moderation/{self.rejected.id}/re-review/")
        self.assertEqual(response.status_code, 403)


class ListingModerationChipTests(ListingModerationQueueTests):
    """OP-2: the queue row says when the business has an open fraud case or an
    overdue subscription, from the records."""

    def test_a_row_without_either_has_no_chips(self):
        self._auth()
        row = self.client.get("/api/listings/moderation/pending/").json()[0]
        self.assertEqual((row["open_fraud_cases"], row["subscription_overdue"]), (0, None))

    def test_an_open_fraud_case_shows_and_a_closed_one_does_not(self):
        from fraud.models import FraudFlag

        FraudFlag.objects.create(
            kind=FraudFlag.FAKE_BUSINESS, status=FraudFlag.OPEN, source=FraudFlag.STAFF,
            title="Looks fake", business_owner=self.owner,
        )
        FraudFlag.objects.create(
            kind=FraudFlag.OTHER, status=FraudFlag.DISMISSED, source=FraudFlag.STAFF,
            title="Old", business_owner=self.owner,
        )
        self._auth()
        row = self.client.get("/api/listings/moderation/pending/").json()[0]
        self.assertEqual(row["open_fraud_cases"], 1)

    def test_an_overdue_subscription_gives_the_day_and_only_names_the_limit_when_the_pause_is_on(self):
        from datetime import timedelta

        from django.test import override_settings
        from django.utils import timezone

        from portfolio.tests.health_fixtures import subscribe

        subscribe(self.owner, ends_at=timezone.now() - timedelta(days=9), overdue_since=timezone.now() - timedelta(days=8))
        self._auth()
        with override_settings(SUBSCRIPTION_PAUSE_ENABLED=False):
            row = self.client.get("/api/listings/moderation/pending/").json()[0]
        self.assertEqual(row["subscription_overdue"], {"day": 9, "grace_days": None})
        with override_settings(SUBSCRIPTION_PAUSE_ENABLED=True):
            row = self.client.get("/api/listings/moderation/pending/").json()[0]
        self.assertEqual(row["subscription_overdue"], {"day": 9, "grace_days": 14})

    def test_week_stats(self):
        from django.utils import timezone

        Listing.objects.filter(pk=self.published.pk).update(reviewed_at=timezone.now())
        Listing.objects.filter(pk=self.rejected.pk).update(reviewed_at=timezone.now())
        self._auth()
        self.assertEqual(
            self.client.get("/api/listings/moderation/stats/").json(), {"week_published": 1, "week_rejected": 1},
        )


class ModerationDetailShowsOwnerAnswersTests(TestCase):
    """A reviewer sees everything the owner was asked, not just name and price."""

    def test_detail_includes_the_product_answers(self):
        staff = StaffUser.objects.create(
            full_name="Super", email="sa-detail@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        owner = BusinessOwner.objects.create(
            full_name="Trader", login_phone="+233207550009", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"),
            zone=Zone.objects.get(name="Manhyia"), name="Detergent", description="D.",
            contact_phone="+233207550009", status=Listing.PENDING_REVIEW,
            price_amount="45.00", brand="Harpic", condition="new", stock_quantity=12,
            has_warranty=True, warranty_details="1 year", has_expiry=True,
            expiry_date="2027-01-31", return_policy="7 days", dimensions="1L", weight="1kg",
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        data = client.get(f"/api/listings/moderation/{listing.id}/").json()
        self.assertEqual(data["brand"], "Harpic")
        self.assertEqual(data["return_policy"], "7 days")
        self.assertTrue(data["has_warranty"])
        self.assertEqual(data["warranty_details"], "1 year")
        self.assertEqual(data["expiry_date"], "2027-01-31")
        self.assertEqual(data["stock_quantity"], 12)
