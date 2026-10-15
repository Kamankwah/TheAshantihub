from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from billing import clock, switch
from billing.models import Subscription, SubscriptionPlan


class SwitchTests(TestCase):
    def test_on_by_default_and_follows_the_setting(self):
        self.assertTrue(switch.subscriptions_enabled())
        with override_settings(SUBSCRIPTIONS_ENABLED=False):
            self.assertFalse(switch.subscriptions_enabled())


@override_settings(SUBSCRIPTIONS_ENABLED=False)
class FrozenTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207880001", password_hash="x")
        BusinessOwnerProfile.objects.create(business_owner=self.owner, business_name="Kofi Shop")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def test_the_public_plan_list_is_empty(self):
        self.assertEqual(APIClient().get("/api/billing/plans/").json(), [])

    def test_subscribing_renewing_and_starting_a_trial_answer_409(self):
        plan = SubscriptionPlan.objects.filter(status=SubscriptionPlan.ACTIVE_STATUS).first()
        payload = {"plan": plan.tier, "cycle_months": 1}
        for path in ("/api/billing/subscriptions/me/", "/api/billing/subscriptions/start-trial/"):
            response = self.client.post(path, {**payload, "business_kind": plan.kind}, format="json")
            self.assertEqual(response.status_code, 409, path)
            self.assertEqual(response.json()["code"], "subscriptions_paused")

    def test_a_subscription_payment_is_refused_but_other_payments_are_not(self):
        refused = self.client.post(
            "/api/billing/transactions/mine/",
            {"kind": "subscription", "amount": "100.00", "purpose": "Plan", "metadata": {"plan": "product_basic", "cycle_months": 1}},
            format="json",
        )
        self.assertEqual(refused.status_code, 409)

    def test_business_kind_endpoint_sets_the_kind_once(self):
        response = self.client.post("/api/billing/business-kind/", {"business_kind": "product"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.owner.profile.refresh_from_db()
        self.assertEqual(self.owner.profile.business_kind, "product")
        again = self.client.post("/api/billing/business-kind/", {"business_kind": "service"}, format="json")
        self.assertEqual(again.status_code, 400)

    def test_business_kind_that_is_not_text_is_a_400(self):
        for kind in (["product"], {"a": 1}, 5, None):
            response = self.client.post("/api/billing/business-kind/", {"business_kind": kind}, format="json")
            self.assertEqual(response.status_code, 400, (kind, response.content))
        self.owner.profile.refresh_from_db()
        self.assertFalse(self.owner.profile.business_kind)

    def test_an_owner_with_no_profile_gets_a_400(self):
        bare = BusinessOwner.objects.create(full_name="Ama", login_phone="+233207880002", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(bare, 'business_owner')}")
        response = self.client.post("/api/billing/business-kind/", {"business_kind": "product"}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("profile", str(response.json()).lower())

    def test_a_kind_that_is_already_set_cannot_be_changed(self):
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(business_kind="service")
        response = self.client.post("/api/billing/business-kind/", {"business_kind": "product"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.owner.profile.refresh_from_db()
        self.assertEqual(self.owner.profile.business_kind, "service")

    @override_settings(SUBSCRIPTIONS_ENABLED=True)
    def test_with_subscriptions_on_the_endpoint_points_at_plan_selection(self):
        response = self.client.post("/api/billing/business-kind/", {"business_kind": "product"}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "use_plan_selection")

    def test_the_clock_does_nothing(self):
        self.assertEqual(clock.tick(), {"overdue": 0, "reminders": 0, "paused": 0})

    def test_registration_asks_for_a_kind_not_a_plan(self):
        complete_business_info(self.owner.profile)
        owner = BusinessOwner.objects.get(pk=self.owner.pk)
        self.assertEqual(owner.compute_registration_step(), "payment_info")      # kind set, no subscription needed

    def test_registration_still_asks_for_a_kind_when_none_is_set(self):
        complete_business_info(self.owner.profile, kind="")
        owner = BusinessOwner.objects.get(pk=self.owner.pk)
        self.assertEqual(owner.compute_registration_step(), "plan_selection")


class UnfrozenTests(TestCase):
    def test_with_the_switch_on_registration_still_needs_a_subscription(self):
        owner = BusinessOwner.objects.create(full_name="Ama", login_phone="+233207880002", password_hash="x")
        profile = BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Ama")
        complete_business_info(profile)
        self.assertEqual(BusinessOwner.objects.get(pk=owner.pk).compute_registration_step(), "plan_selection")


def complete_business_info(profile, kind="product"):
    """A profile that has passed the business_info step (card, address, phone and both card photos)."""
    profile.ghana_card_number = "GHA-000000000-0"
    profile.gps_address = "AK-039-5028"
    profile.business_contact_phone = "+233207880001"
    profile.ghana_card_front_image = "front.jpg"
    profile.ghana_card_back_image = "back.jpg"
    profile.business_kind = kind
    profile.save()
