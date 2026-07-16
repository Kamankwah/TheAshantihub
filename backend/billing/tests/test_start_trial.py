from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from billing.models import Subscription, SubscriptionPlan


class StartTrialTests(TestCase):
    """Smoke coverage for POST /api/billing/subscriptions/start-trial/ — the
    registration-time free trial start (BusinessOwner.compute_registration_step()'s
    "plan_selection" step). Not exhaustive — see billing/tests/test_subscriptions.py
    for SubscriptionMeView's own (change-plan/renew) coverage.
    """

    def _make_owner_at_plan_selection(self, **profile_overrides):
        owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233207770001", password_hash="x",
        )
        defaults = dict(
            business_owner=owner,
            ghana_card_number="GHA-770001", gps_address="AK-770-001",
            business_contact_phone="+233207770001", is_formal=False,
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg",
        )
        defaults.update(profile_overrides)
        BusinessOwnerProfile.objects.create(**defaults)
        # Sanity check the fixture actually lands on "plan_selection" — if
        # accounts.models.BusinessOwner.compute_registration_step() ever
        # changes shape, this test should fail loudly here rather than
        # silently exercising the wrong branch below.
        self.assertEqual(owner.compute_registration_step(), "plan_selection")
        return owner

    def _client_for(self, owner, account_type="business_owner"):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, account_type)}")
        return client

    def test_start_trial_happy_path(self):
        owner = self._make_owner_at_plan_selection()
        client = self._client_for(owner)
        response = client.post(
            "/api/billing/subscriptions/start-trial/",
            {"business_kind": "product", "plan": "product_basic", "cycle_months": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["registration_step"], "payment_info")
        self.assertTrue(data["subscription"]["is_trial"])
        self.assertEqual(data["subscription"]["plan"]["tier"], "product_basic")

        owner.profile.refresh_from_db()
        self.assertEqual(owner.profile.business_kind, "product")
        subscription = Subscription.objects.get(business_owner=owner)
        self.assertTrue(subscription.is_trial)
        self.assertEqual(subscription.plan, SubscriptionPlan.objects.get(tier="product_basic"))

    def test_wrong_registration_step_is_rejected(self):
        owner = BusinessOwner.objects.create(
            full_name="No Info Trader", login_phone="+233207770002", password_hash="x",
        )
        client = self._client_for(owner)
        response = client.post(
            "/api/billing/subscriptions/start-trial/",
            {"business_kind": "product", "plan": "product_basic", "cycle_months": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_plan_kind_mismatch_is_rejected(self):
        owner = self._make_owner_at_plan_selection()
        client = self._client_for(owner)
        response = client.post(
            "/api/billing/subscriptions/start-trial/",
            {"business_kind": "product", "plan": "service", "cycle_months": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_customer_cannot_start_trial(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200007770", password_hash="x")
        client = self._client_for(customer, account_type="customer")
        response = client.post(
            "/api/billing/subscriptions/start-trial/",
            {"business_kind": "product", "plan": "product_basic", "cycle_months": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
