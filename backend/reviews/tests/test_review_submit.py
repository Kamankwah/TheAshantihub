from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from events.models import Event, EventRSVP
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem

from reviews.models import Review


class ReviewSubmitTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207881100", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Abena Trader", login_phone="+233207881101", password_hash="x",
        )
        self.buyer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200881100", password_hash="x",
        )
        self.non_buyer = Customer.objects.create(
            full_name="Yaw NonBuyer", phone="+233200881101", password_hash="x",
        )
        self.organizer_customer = Customer.objects.create(
            full_name="Akosua Organizer", phone="+233200881102", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
            price_amount="100.00", status=Listing.PUBLISHED,
        )
        self.event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone,
            submitted_by_business=self.owner,
            name="Test Durbar", description="A test event.", address="Test address",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=timezone.now(),
            expires_at=timezone.now() + timezone.timedelta(days=14),
        )
        self.customer_event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone,
            submitted_by_customer=self.organizer_customer,
            name="Customer Durbar", description="A test event.", address="Test address",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=timezone.now(),
            expires_at=timezone.now() + timezone.timedelta(days=14),
        )

    def _auth(self, user, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(user, kind)}")

    def _make_paid_order(self, customer, listing):
        order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=listing.price_amount)
        OrderItem.objects.create(
            order=order, listing=listing, quantity=1,
            unit_price=listing.price_amount, line_total=listing.price_amount,
        )
        return order

    def _make_going_rsvp(self, customer, event):
        return EventRSVP.objects.create(event=event, customer=customer, status=EventRSVP.GOING)


class ReviewSubmitListingTests(ReviewSubmitTestsBase):
    def test_verified_purchase_review_succeeds_and_is_verified_true(self):
        self._make_paid_order(self.buyer, self.listing)
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 5, "comment": "Great!"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        review = Review.objects.get(listing=self.listing, author=self.buyer)
        self.assertTrue(review.verified)
        self.assertEqual(review.status, Review.PUBLISHED)
        self.assertEqual(review.rating, 5)

    def test_unverified_submission_is_403(self):
        self._auth(self.non_buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 4}, format="json",
        )
        self.assertEqual(response.status_code, 403, response.content)
        self.assertFalse(Review.objects.filter(listing=self.listing, author=self.non_buyer).exists())

    def test_duplicate_submission_is_400_not_500(self):
        self._make_paid_order(self.buyer, self.listing)
        self._auth(self.buyer, "customer")
        first = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 5}, format="json",
        )
        self.assertEqual(first.status_code, 201, first.content)
        second = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 2}, format="json",
        )
        self.assertEqual(second.status_code, 400, second.content)
        self.assertEqual(Review.objects.filter(listing=self.listing, author=self.buyer).count(), 1)

    def test_review_for_nonexistent_listing_is_404(self):
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": 999999, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_business_owner_cannot_submit_review(self):
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_submit_review(self):
        response = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_comment_is_optional(self):
        self._make_paid_order(self.buyer, self.listing)
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 3}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["comment"], "")


class ReviewSubmitEventTests(ReviewSubmitTestsBase):
    def test_going_rsvp_allows_event_review(self):
        self._make_going_rsvp(self.buyer, self.event)
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "event", "target_id": self.event.id, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_no_rsvp_event_review_is_403(self):
        self._auth(self.non_buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "event", "target_id": self.event.id, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 403)


class ReviewSubmitSellerTests(ReviewSubmitTestsBase):
    def test_purchase_from_seller_allows_seller_review(self):
        self._make_paid_order(self.buyer, self.listing)
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "seller", "target_id": self.owner.id, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_no_purchase_from_seller_is_403(self):
        self._auth(self.non_buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "seller", "target_id": self.owner.id, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_purchase_from_different_seller_does_not_grant_eligibility(self):
        self._make_paid_order(self.buyer, self.listing)
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "seller", "target_id": self.other_owner.id, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 403)


class ReviewSubmitOrganizerTests(ReviewSubmitTestsBase):
    def test_organizer_requires_organizer_kind(self):
        self._make_going_rsvp(self.buyer, self.event)
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/", {"target_type": "organizer", "target_id": self.owner.id, "rating": 5}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_going_rsvp_allows_business_organizer_review(self):
        self._make_going_rsvp(self.buyer, self.event)
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/",
            {"target_type": "organizer", "target_id": self.owner.id, "organizer_kind": "business", "rating": 5},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        review = Review.objects.get(business_owner=self.owner, target_type=Review.ORGANIZER)
        self.assertEqual(review.author, self.buyer)

    def test_going_rsvp_allows_customer_organizer_review(self):
        self._make_going_rsvp(self.buyer, self.customer_event)
        self._auth(self.buyer, "customer")
        response = self.client.post(
            "/api/reviews/",
            {
                "target_type": "organizer", "target_id": self.organizer_customer.id,
                "organizer_kind": "customer", "rating": 4,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_no_rsvp_organizer_review_is_403(self):
        self._auth(self.non_buyer, "customer")
        response = self.client.post(
            "/api/reviews/",
            {"target_type": "organizer", "target_id": self.owner.id, "organizer_kind": "business", "rating": 5},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_same_business_owner_can_get_both_seller_and_organizer_review_from_same_author(self):
        self._make_paid_order(self.buyer, self.listing)
        self._make_going_rsvp(self.buyer, self.event)
        self._auth(self.buyer, "customer")

        seller_response = self.client.post(
            "/api/reviews/", {"target_type": "seller", "target_id": self.owner.id, "rating": 5}, format="json",
        )
        organizer_response = self.client.post(
            "/api/reviews/",
            {"target_type": "organizer", "target_id": self.owner.id, "organizer_kind": "business", "rating": 4},
            format="json",
        )
        self.assertEqual(seller_response.status_code, 201, seller_response.content)
        self.assertEqual(organizer_response.status_code, 201, organizer_response.content)
        self.assertEqual(Review.objects.filter(business_owner=self.owner, author=self.buyer).count(), 2)
