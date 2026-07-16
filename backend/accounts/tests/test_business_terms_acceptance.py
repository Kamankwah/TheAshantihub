from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from billing.models import Subscription, SubscriptionPlan


class TermsAcceptanceTests(TestCase):
    def _make_owner(self, **profile_overrides):
        owner = BusinessOwner.objects.create(
            full_name="Efua Seller", login_phone="+233206665599", password_hash="x",
        )
        defaults = dict(business_owner=owner)
        defaults.update(profile_overrides)
        BusinessOwnerProfile.objects.create(**defaults)
        return owner

    def _client_for(self, owner):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        return client

    def test_cannot_accept_terms_before_business_and_payment_info_are_complete(self):
        owner = self._make_owner()
        client = self._client_for(owner)
        response = client.post("/api/accounts/business-owners/me/terms/")
        self.assertEqual(response.status_code, 400)
        owner.profile.refresh_from_db()
        self.assertIsNone(owner.profile.terms_accepted_at)

    def test_accepts_terms_once_business_and_payment_info_are_complete(self):
        owner = self._make_owner(
            ghana_card_number="GHA-222333444-5", gps_address="AK-039-6000",
            business_contact_phone="+233206665599", is_formal=False,
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg",
            default_payout_method="momo", payout_momo_number="+233206665599",
        )
        # Complete the plan_selection step too, otherwise compute_registration_step()
        # stops at "plan_selection" and terms acceptance is correctly rejected.
        plan = SubscriptionPlan.objects.create(
            tier="test_terms_plan", name="Test plan", kind="product",
            monthly_price=10, status=SubscriptionPlan.ACTIVE_STATUS,
        )
        Subscription.objects.create(
            business_owner=owner, plan=plan, cycle_months=1, is_trial=True,
            status=Subscription.ACTIVE,
            current_period_start=timezone.now(),
            current_period_end=timezone.now() + timezone.timedelta(days=30),
        )
        owner.profile.business_kind = "product"
        owner.profile.save(update_fields=["business_kind"])
        client = self._client_for(owner)
        response = client.post("/api/accounts/business-owners/me/terms/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["registration_step"], "complete")
        owner.profile.refresh_from_db()
        self.assertIsNotNone(owner.profile.terms_accepted_at)

    def test_customer_cannot_access_terms_endpoint(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200003333", password_hash="x")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = client.post("/api/accounts/business-owners/me/terms/")
        self.assertEqual(response.status_code, 403)
