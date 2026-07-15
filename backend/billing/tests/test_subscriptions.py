from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Subscription, SubscriptionPlan


class SubscriptionPlanListTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_plans_are_public_and_seeded(self):
        response = self.client.get("/api/billing/plans/")
        self.assertEqual(response.status_code, 200, response.content)
        tiers = {plan["tier"] for plan in response.json()}
        self.assertEqual(tiers, {"product_basic", "product_unlimited", "service"})

    def test_pending_or_rejected_plans_are_never_listed_publicly(self):
        SubscriptionPlan.objects.create(
            tier="product_basic_v2", name="Product Basic v2", kind="product",
            monthly_price="15.00", status=SubscriptionPlan.PENDING_APPROVAL,
        )
        response = self.client.get("/api/billing/plans/")
        tiers = {plan["tier"] for plan in response.json()}
        self.assertNotIn("product_basic_v2", tiers)


class SubscriptionMeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207440001", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Seller", login_phone="+233207440002", password_hash="x",
        )
        self.product_basic = SubscriptionPlan.objects.get(tier="product_basic")
        self.product_unlimited = SubscriptionPlan.objects.get(tier="product_unlimited")
        self.service = SubscriptionPlan.objects.get(tier="service")

    def _auth(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def test_get_returns_empty_object_when_no_subscription_yet(self):
        self._auth(self.owner)
        response = self.client.get("/api/billing/subscriptions/me/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {})

    def test_subscribe_creates_subscription(self):
        self._auth(self.owner)
        response = self.client.post(
            "/api/billing/subscriptions/me/",
            {"plan": "product_unlimited", "cycle_months": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["plan"]["tier"], "product_unlimited")
        self.assertEqual(data["status"], "active")
        self.assertFalse(data["is_trial"])
        subscription = Subscription.objects.get(business_owner=self.owner)
        self.assertEqual(subscription.plan, self.product_unlimited)

    def test_subscribe_again_changes_plan_in_place(self):
        self._auth(self.owner)
        self.client.post(
            "/api/billing/subscriptions/me/", {"plan": "product_basic", "cycle_months": 1}, format="json"
        )
        response = self.client.post(
            "/api/billing/subscriptions/me/", {"plan": "service", "cycle_months": 12}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(Subscription.objects.filter(business_owner=self.owner).count(), 1)
        subscription = Subscription.objects.get(business_owner=self.owner)
        self.assertEqual(subscription.plan, self.service)
        self.assertEqual(subscription.cycle_months, 12)

    def test_get_only_returns_own_subscription(self):
        self._auth(self.owner)
        self.client.post(
            "/api/billing/subscriptions/me/", {"plan": "product_unlimited", "cycle_months": 1}, format="json"
        )
        self._auth(self.other_owner)
        response = self.client.get("/api/billing/subscriptions/me/")
        self.assertEqual(response.json(), {})

    def test_customer_cannot_access_subscription_endpoint(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200001234", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = self.client.get("/api/billing/subscriptions/me/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_access_subscription_endpoint(self):
        response = self.client.get("/api/billing/subscriptions/me/")
        self.assertEqual(response.status_code, 401)
