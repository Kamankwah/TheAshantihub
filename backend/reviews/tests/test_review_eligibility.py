from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from events.models import Event, EventRSVP
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem

from reviews.models import Review


class ReviewEligibilityTests(TestCase):
    """Confirms GET /api/reviews/eligibility/ agrees with what
    POST /api/reviews/ actually allows — both call the exact same
    check_review_eligibility helper, so these two paths can't drift.
    """

    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207882200", password_hash="x",
        )
        self.buyer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200882200", password_hash="x",
        )
        self.non_buyer = Customer.objects.create(
            full_name="Yaw NonBuyer", phone="+233200882201", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
            price_amount="100.00", status=Listing.PUBLISHED,
        )

    def _auth(self, customer):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")

    def _make_paid_order(self):
        order = Order.objects.create(customer=self.buyer, status=Order.PAID, total_amount="100.00")
        OrderItem.objects.create(
            order=order, listing=self.listing, quantity=1, unit_price="100.00", line_total="100.00",
        )

    def test_eligible_matches_ability_to_submit(self):
        self._make_paid_order()
        self._auth(self.buyer)

        eligibility = self.client.get(
            "/api/reviews/eligibility/", {"target_type": "listing", "target_id": self.listing.id},
        )
        self.assertEqual(eligibility.status_code, 200, eligibility.content)
        self.assertEqual(eligibility.json(), {"eligible": True, "already_reviewed": False})

        submit = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 5}, format="json",
        )
        self.assertEqual(submit.status_code, 201, submit.content)

    def test_ineligible_matches_inability_to_submit(self):
        self._auth(self.non_buyer)

        eligibility = self.client.get(
            "/api/reviews/eligibility/", {"target_type": "listing", "target_id": self.listing.id},
        )
        self.assertEqual(eligibility.json(), {"eligible": False, "already_reviewed": False})

        submit = self.client.post(
            "/api/reviews/", {"target_type": "listing", "target_id": self.listing.id, "rating": 5}, format="json",
        )
        self.assertEqual(submit.status_code, 403)

    def test_already_reviewed_forces_eligible_false(self):
        self._make_paid_order()
        self._auth(self.buyer)
        Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.buyer, rating=5, verified=True,
        )
        eligibility = self.client.get(
            "/api/reviews/eligibility/", {"target_type": "listing", "target_id": self.listing.id},
        )
        self.assertEqual(eligibility.json(), {"eligible": False, "already_reviewed": True})

    def test_requires_customer_auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.client.get(
            "/api/reviews/eligibility/", {"target_type": "listing", "target_id": self.listing.id},
        )
        self.assertEqual(response.status_code, 403)

    def test_invalid_target_type_is_400(self):
        self._auth(self.buyer)
        response = self.client.get(
            "/api/reviews/eligibility/", {"target_type": "bogus", "target_id": self.listing.id},
        )
        self.assertEqual(response.status_code, 400)

    def test_organizer_without_kind_is_400(self):
        self._auth(self.buyer)
        response = self.client.get(
            "/api/reviews/eligibility/", {"target_type": "organizer", "target_id": self.owner.id},
        )
        self.assertEqual(response.status_code, 400)
