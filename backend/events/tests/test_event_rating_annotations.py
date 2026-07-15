from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from listings.models import Category, Zone

from events.models import Event
from reviews.models import Review


class EventRatingAnnotationTests(TestCase):
    """avg_rating/review_count on GET /api/events/ and the detail endpoint,
    plus EventDetailSerializer's new `organizer` field
    (reviews/ratings/Q&A plan, docs/PROJECT_SCOPE.md Phase 2).
    """

    def setUp(self):
        self.client = APIClient()
        self.business_owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207886600", password_hash="x",
        )
        self.organizer_customer = Customer.objects.create(
            full_name="Akosua Organizer", phone="+233200886600", password_hash="x",
        )
        self.reviewer_a = Customer.objects.create(
            full_name="Ama A", phone="+233200886601", password_hash="x",
        )
        self.reviewer_b = Customer.objects.create(
            full_name="Yaw B", phone="+233200886602", password_hash="x",
        )
        self.reviewer_c = Customer.objects.create(
            full_name="Kwame C", phone="+233200886603", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        now = timezone.now()

        self.business_event = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_business=self.business_owner,
            name="Business Durbar", description="A test event.", address="Test address",
            event_date=now + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timezone.timedelta(days=14),
        )
        self.customer_event = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.organizer_customer,
            name="Customer Durbar", description="A test event.", address="Test address",
            event_date=now + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timezone.timedelta(days=14),
        )

        # 3 reviews with known ratings: 5, 4, 3 -> average exactly 4.0.
        Review.objects.create(
            target_type=Review.EVENT, event=self.business_event, author=self.reviewer_a, rating=5, verified=True,
        )
        Review.objects.create(
            target_type=Review.EVENT, event=self.business_event, author=self.reviewer_b, rating=4, verified=True,
        )
        Review.objects.create(
            target_type=Review.EVENT, event=self.business_event, author=self.reviewer_c, rating=3, verified=True,
        )

    def _find(self, results, event_id):
        return next(item for item in results if item["id"] == event_id)

    def test_list_endpoint_reports_correct_average_and_count(self):
        response = self.client.get("/api/events/")
        self.assertEqual(response.status_code, 200, response.content)
        item = self._find(response.json()["results"], self.business_event.id)
        self.assertEqual(item["avg_rating"], 4.0)
        self.assertEqual(item["review_count"], 3)

    def test_list_endpoint_unrated_event_has_null_average_zero_count(self):
        response = self.client.get("/api/events/")
        item = self._find(response.json()["results"], self.customer_event.id)
        self.assertIsNone(item["avg_rating"])
        self.assertEqual(item["review_count"], 0)

    def test_detail_endpoint_reports_correct_average_and_count(self):
        response = self.client.get(f"/api/events/{self.business_event.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["avg_rating"], 4.0)
        self.assertEqual(response.json()["review_count"], 3)

    def test_hidden_review_excluded_from_average(self):
        Review.objects.create(
            target_type=Review.EVENT, event=self.customer_event, author=self.reviewer_a,
            rating=1, verified=True, status=Review.HIDDEN,
        )
        response = self.client.get(f"/api/events/{self.customer_event.id}/")
        self.assertIsNone(response.json()["avg_rating"])
        self.assertEqual(response.json()["review_count"], 0)

    def test_organizer_field_for_business_organized_event(self):
        response = self.client.get(f"/api/events/{self.business_event.id}/")
        organizer = response.json()["organizer"]
        self.assertEqual(
            organizer, {"kind": "business", "id": self.business_owner.id, "full_name": self.business_owner.full_name},
        )

    def test_organizer_field_for_customer_organized_event(self):
        response = self.client.get(f"/api/events/{self.customer_event.id}/")
        organizer = response.json()["organizer"]
        self.assertEqual(
            organizer,
            {"kind": "customer", "id": self.organizer_customer.id, "full_name": self.organizer_customer.full_name},
        )

    def test_teaser_serializer_does_not_expose_organizer(self):
        # The list endpoint always returns the safe teaser subset — its
        # contract stays untouched by this plan (only EventDetailSerializer
        # gains `organizer`).
        response = self.client.get("/api/events/")
        item = self._find(response.json()["results"], self.business_event.id)
        self.assertNotIn("organizer", item)
        self.assertNotIn("address", item)
