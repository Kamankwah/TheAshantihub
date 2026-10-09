"""A scout-registered owner's registration steps (plan decision 3): the scout
captured the business details and the claim records the terms, so the owner
only ever sees "pick a plan" and "add payout details" — once KYC has verified
the business. Self-registered owners are pinned unchanged here too."""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from billing.models import Subscription, SubscriptionPlan

# What a scout's registration captures: no Ghana Card back, no number, no
# payout details, no terms.
SCOUT_CAPTURE = dict(
    business_name="Akosua's Kitchen", business_kind="product", gps_address="AK-039-5028",
    business_contact_phone="+233241220001", ghana_card_front_image="ghana_cards/front.jpg",
)
FULL_SELF_SERVICE = dict(SCOUT_CAPTURE, ghana_card_number="GHA-220001", ghana_card_back_image="ghana_cards/back.jpg")
MOMO = dict(default_payout_method="momo", payout_momo_number="+233241220001")


def _owner(channel, *, kyc_status=BusinessOwner.PENDING, phone="+233241220001", with_profile=True, **profile):
    owner = BusinessOwner.objects.create(
        full_name="Akosua Mensah", login_phone=phone, password_hash="x",
        kyc_status=kyc_status, registration_channel=channel,
    )
    if with_profile:
        BusinessOwnerProfile.objects.create(business_owner=owner, **profile)
    return owner


def _subscribe(owner, kind="product"):
    plan, _ = SubscriptionPlan.objects.get_or_create(
        tier=f"test_{kind}_plan",
        defaults=dict(name=f"Test {kind} plan", kind=kind, monthly_price=10, status=SubscriptionPlan.ACTIVE_STATUS),
    )
    Subscription.objects.create(
        business_owner=owner, plan=plan, cycle_months=1, is_trial=True, status=Subscription.ACTIVE,
        current_period_start=timezone.now(), current_period_end=timezone.now() + timedelta(days=30),
    )


def _step(owner):
    return BusinessOwner.objects.get(pk=owner.pk).compute_registration_step()


class ScoutRegisteredStepTests(TestCase):
    def test_a_pending_scout_registration_skips_business_info_and_terms(self):
        self.assertEqual(_step(_owner(BusinessOwner.SCOUT, **SCOUT_CAPTURE)), "complete")

    def test_a_rejected_scout_registration_is_complete(self):
        owner = _owner(BusinessOwner.SCOUT, kyc_status=BusinessOwner.REJECTED, **SCOUT_CAPTURE)
        self.assertEqual(_step(owner), "complete")

    def test_a_verified_owner_without_a_plan_picks_one(self):
        owner = _owner(BusinessOwner.SCOUT, kyc_status=BusinessOwner.VERIFIED, **SCOUT_CAPTURE)
        self.assertEqual(_step(owner), "plan_selection")

    def test_a_verified_owner_with_a_plan_adds_payout_details(self):
        owner = _owner(BusinessOwner.SCOUT, kyc_status=BusinessOwner.VERIFIED, **SCOUT_CAPTURE)
        _subscribe(owner)
        self.assertEqual(_step(owner), "payment_info")

    def test_a_payout_method_without_its_number_still_needs_payout_details(self):
        for method, phone in (("momo", "+233241220002"), ("bank", "+233241220003")):
            with self.subTest(method=method):
                owner = _owner(
                    BusinessOwner.SCOUT, kyc_status=BusinessOwner.VERIFIED, phone=phone,
                    default_payout_method=method, **SCOUT_CAPTURE,
                )
                _subscribe(owner)
                self.assertEqual(_step(owner), "payment_info")

    def test_plan_and_payout_done_is_complete_without_accepting_terms_here(self):
        owner = _owner(BusinessOwner.SCOUT, kyc_status=BusinessOwner.VERIFIED, **SCOUT_CAPTURE, **MOMO)
        _subscribe(owner)
        self.assertEqual(_step(owner), "complete")
        self.assertIsNone(BusinessOwnerProfile.objects.get(business_owner=owner).terms_accepted_at)

    def test_a_verified_owner_with_no_profile_still_gets_the_plan_then_payout_steps(self):
        owner = _owner(BusinessOwner.SCOUT, kyc_status=BusinessOwner.VERIFIED, with_profile=False)
        self.assertEqual(_step(owner), "plan_selection")
        _subscribe(owner)
        self.assertEqual(_step(owner), "payment_info")


class SelfRegisteredStepUnchangedTests(TestCase):
    def test_the_same_partial_details_still_need_business_info_when_self_registered(self):
        self.assertEqual(_step(_owner(BusinessOwner.SELF, **SCOUT_CAPTURE)), "business_info")

    def test_a_verified_self_registered_owner_is_complete_without_a_plan(self):
        owner = _owner(BusinessOwner.SELF, kyc_status=BusinessOwner.VERIFIED, **SCOUT_CAPTURE)
        self.assertEqual(_step(owner), "complete")

    def test_a_self_registered_owner_still_ends_on_terms(self):
        owner = _owner(BusinessOwner.SELF, **FULL_SELF_SERVICE)
        self.assertEqual(_step(owner), "plan_selection")
        _subscribe(owner)
        self.assertEqual(_step(owner), "payment_info")
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(**MOMO)
        self.assertEqual(_step(owner), "terms")
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(terms_accepted_at=timezone.now())
        self.assertEqual(_step(owner), "complete")


class ScoutRegisteredOwnerApiTests(TestCase):
    def setUp(self):
        cache.clear()

    def client_for(self, owner):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        return client

    def test_a_pending_owner_lands_on_the_dashboard_and_cannot_accept_terms_here(self):
        owner = _owner(BusinessOwner.SCOUT, **SCOUT_CAPTURE)
        client = self.client_for(owner)
        self.assertEqual(client.get("/api/accounts/me/").json()["registration_step"], "complete")
        response = client.post("/api/accounts/business-owners/me/terms/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(BusinessOwnerProfile.objects.get(business_owner=owner).terms_accepted_at)

    def test_a_verified_owner_picks_a_plan_then_is_asked_for_payout_details(self):
        owner = _owner(BusinessOwner.SCOUT, kyc_status=BusinessOwner.VERIFIED, **SCOUT_CAPTURE)
        client = self.client_for(owner)
        self.assertEqual(client.get("/api/accounts/me/").json()["registration_step"], "plan_selection")
        response = client.post(
            "/api/billing/subscriptions/start-trial/",
            {"business_kind": "product", "plan": "product_basic", "cycle_months": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["registration_step"], "payment_info")
