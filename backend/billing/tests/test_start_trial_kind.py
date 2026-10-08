"""Picking a plan never switches a business's kind once it is set (staff
phase 2): a scout registers the business as a product or a service business,
and the owner's plan step must keep it. Self-registered owners have no kind
before this step, so their path is unchanged."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from billing.models import Subscription

START_TRIAL = "/api/billing/subscriptions/start-trial/"


def _client_for(owner):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
    return client


class StartTrialKindTests(TestCase):
    def setUp(self):
        cache.clear()

    def _scout_registered_product_business(self):
        owner = BusinessOwner.objects.create(
            full_name="Akosua Mensah", login_phone="+233241330001", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED, registration_channel=BusinessOwner.SCOUT,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name="Akosua's Kitchen", business_kind="product",
            gps_address="AK-039-5028", business_contact_phone="+233241330001",
            ghana_card_front_image="ghana_cards/front.jpg",
        )
        self.assertEqual(owner.compute_registration_step(), "plan_selection")
        return owner

    def test_a_plan_of_the_other_kind_is_refused_and_nothing_changes(self):
        owner = self._scout_registered_product_business()
        response = _client_for(owner).post(
            START_TRIAL, {"business_kind": "service", "plan": "service", "cycle_months": 1}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(),
            {"plan": ["This plan is for service businesses, and yours is registered as a product business."]},
        )
        self.assertFalse(Subscription.objects.filter(business_owner=owner).exists())
        self.assertEqual(BusinessOwnerProfile.objects.get(business_owner=owner).business_kind, "product")

    def test_a_plan_of_the_registered_kind_starts_the_trial(self):
        owner = self._scout_registered_product_business()
        response = _client_for(owner).post(
            START_TRIAL, {"business_kind": "product", "plan": "product_basic", "cycle_months": 1}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["registration_step"], "payment_info")
        self.assertEqual(BusinessOwnerProfile.objects.get(business_owner=owner).business_kind, "product")

    def test_a_self_registered_owner_still_chooses_their_kind_with_the_plan(self):
        owner = BusinessOwner.objects.create(full_name="Kwame Trader", login_phone="+233241330002", password_hash="x")
        BusinessOwnerProfile.objects.create(
            business_owner=owner, ghana_card_number="GHA-330002", gps_address="AK-330-002",
            business_contact_phone="+233241330002", ghana_card_front_image="front.jpg",
            ghana_card_back_image="back.jpg",
        )
        self.assertEqual(owner.compute_registration_step(), "plan_selection")
        response = _client_for(owner).post(
            START_TRIAL, {"business_kind": "service", "plan": "service", "cycle_months": 1}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(BusinessOwnerProfile.objects.get(business_owner=owner).business_kind, "service")
        self.assertEqual(Subscription.objects.get(business_owner=owner).plan.tier, "service")
