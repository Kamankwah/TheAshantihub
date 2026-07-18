from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from listings.models import Category, Listing, Promotion, Zone


class PromotionPurchaseTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207881122", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Yaw Trader", login_phone="+233207881133", password_hash="x",
        )
        self.token = issue_token(self.owner, "business_owner")
        self.other_token = issue_token(self.other_owner, "business_owner")

        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        self.published = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Royal Lodge", description="Luxury kente-draped rooms.",
            contact_phone="+233207881122", price_amount="450.00", status=Listing.PUBLISHED,
        )
        self.draft = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Unfinished Lodge", description="Not ready.",
            contact_phone="+233207881122", status=Listing.DRAFT,
        )

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_owner_can_purchase_featured_promotion(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["kind"], "featured")
        # A purchased promotion is now created pending staff approval (bug fix 7),
        # not immediately active.
        self.assertEqual(body["status"], "pending")

        promotion = Promotion.objects.get(pk=body["id"])
        self.assertEqual(promotion.listing_id, self.published.id)
        self.assertEqual(promotion.status, Promotion.PENDING)
        self.assertEqual(
            (promotion.ends_at - promotion.starts_at).days, 7
        )

    def test_featured_purchase_creates_transaction(self):
        self._auth(self.token)
        self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        transaction = Transaction.objects.get(business_owner=self.owner)
        self.assertEqual(transaction.status, Transaction.SUCCESS)
        self.assertIsNone(transaction.customer)
        self.assertIn("featured", transaction.purpose.lower())
        self.assertGreater(transaction.amount, 0)

    def test_boost_purchase_requires_keywords(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "boost", "days": 5},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("keywords", response.json())

    def test_boost_purchase_with_keywords_succeeds(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "boost", "days": 5, "keywords": "kente wedding gifts"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        promotion = Promotion.objects.get(pk=response.json()["id"])
        self.assertEqual(promotion.keywords, "kente wedding gifts")

    def test_featured_purchase_ignores_keywords(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7, "keywords": "should be ignored"},
            format="json",
        )
        promotion = Promotion.objects.get(pk=response.json()["id"])
        self.assertEqual(promotion.keywords, "")

    def test_non_owner_cannot_promote(self):
        self._auth(self.other_token)
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_customer_cannot_promote(self):
        customer = Customer.objects.create(
            full_name="Ama Shopper", phone="+233200003333", password_hash="x",
        )
        self._auth(issue_token(customer, "customer"))
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_promote(self):
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_cannot_promote_unpublished_listing(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/listings/{self.draft.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_stack_second_active_featured_promotion(self):
        self._auth(self.token)
        self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            Promotion.objects.filter(listing=self.published, kind=Promotion.FEATURED).count(), 1
        )

    def test_can_purchase_boost_while_featured_is_active(self):
        # Different kinds don't stack-conflict with each other.
        self._auth(self.token)
        self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "boost", "days": 5, "keywords": "kente"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_new_promotion_of_same_kind_allowed_after_previous_expired(self):
        self._auth(self.token)
        expired = Promotion.objects.create(
            listing=self.published, kind=Promotion.FEATURED,
            starts_at=timezone.now() - timedelta(days=10),
            ends_at=timezone.now() - timedelta(days=1),
            amount_paid="35.00", status=Promotion.ACTIVE,
        )
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotEqual(response.json()["id"], expired.id)

    def test_invalid_kind_rejected(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "bogus", "days": 7},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_days_must_be_positive(self):
        self._auth(self.token)
        response = self.client.post(
            f"/api/listings/{self.published.id}/promote/",
            {"kind": "featured", "days": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
