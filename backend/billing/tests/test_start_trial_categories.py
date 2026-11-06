"""A self-registering owner chooses the kind and one or more categories together: the kind, the categories and (with
subscriptions on) the trial are saved in one transaction, and a failure leaves the kind unset so the owner can retry.

Transitional: a client that omits the `categories` key (the mobile app, a cached older web bundle) still sets the kind,
without categories; any value it does send, even `[]` or `null`, is validated."""
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerCategory, BusinessOwnerProfile
from billing.models import Subscription
from listings.models import Category

START_TRIAL = "/api/billing/subscriptions/start-trial/"
BUSINESS_KIND = "/api/billing/business-kind/"


def make_category(slug, kind="product"):
    return Category.objects.create(slug=f"stc-{slug}", icon="🧵", label=slug.title(), color="#7c3aed", kind=kind)


def make_owner(phone, kind=None, **owner_extra):
    owner = BusinessOwner.objects.create(
        full_name="Kwame Trader", login_phone=phone, password_hash="x", **owner_extra,
    )
    profile = BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name="Kwame Shop", business_kind=kind, ghana_card_number=f"GHA-{phone[-6:]}",
        gps_address=f"AK-{phone[-6:]}", business_contact_phone=phone, ghana_card_front_image="front.jpg",
        ghana_card_back_image="back.jpg", lat="6.690000", lng="-1.620000",
    )
    return owner, profile


def client_for(owner):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
    return client


class _Fixtures:
    def setUp(self):
        cache.clear()
        self.fabrics = make_category("fabrics")
        self.shoes = make_category("shoes")
        self.tailoring = make_category("tailoring", kind="service")
        self.owner, self.profile = make_owner("+233245550001")
        self.client = client_for(self.owner)

    def stored(self):
        profile = BusinessOwnerProfile.objects.get(pk=self.profile.pk)
        ids = list(
            BusinessOwnerCategory.objects.filter(profile=profile).order_by("position").values_list("category_id", flat=True)
        )
        return profile, ids

    def assert_nothing_saved(self):
        profile, ids = self.stored()
        self.assertFalse(profile.business_kind)
        self.assertIsNone(profile.business_category_id)
        self.assertEqual(ids, [])
        self.assertFalse(Subscription.objects.filter(business_owner=self.owner).exists())


class StartTrialCategoriesTests(_Fixtures, TestCase):
    def post(self, **extra):
        body = {"business_kind": "product", "plan": "product_basic", "cycle_months": 1, **extra}
        return self.client.post(START_TRIAL, body, format="json")

    def test_start_trial_sets_kind_categories_and_subscription_together(self):
        response = self.post(categories=[self.shoes.pk, self.fabrics.pk])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["registration_step"], "terms")
        profile, ids = self.stored()
        self.assertEqual(profile.business_kind, "product")
        self.assertEqual(ids, [self.shoes.pk, self.fabrics.pk])
        self.assertEqual(profile.business_category_id, self.shoes.pk)
        self.assertTrue(Subscription.objects.get(business_owner=self.owner).is_trial)

    def test_absent_categories_key_sets_kind_and_trial_without_categories(self):
        # Transitional: an older client (the mobile app, a cached web bundle) never sends the key.
        response = self.post()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["registration_step"], "terms")
        profile, ids = self.stored()
        self.assertEqual(profile.business_kind, "product")
        self.assertEqual(ids, [])
        self.assertIsNone(profile.business_category_id)
        self.assertTrue(Subscription.objects.get(business_owner=self.owner).is_trial)

    def test_explicit_empty_null_or_wrong_type_categories_400_and_kind_stays_unset(self):
        for value in ([], None, "3", 3, {"id": 3}):
            response = self.post(categories=value)
            self.assertEqual(response.status_code, 400, (value, response.content))
            self.assertEqual(response.json(), {"categories": ["Choose at least one category."]})
            self.assert_nothing_saved()

    def test_garbage_inside_the_list_answers_in_the_same_shape(self):
        for value, message in (([True], "That category doesn't exist."), ([[1]], "That category doesn't exist."),
                               (["abc"], "That category doesn't exist."), ([None], "That category doesn't exist.")):
            response = self.post(categories=value)
            self.assertEqual(response.status_code, 400, (value, response.content))
            self.assertEqual(response.json(), {"categories": [message]})
            self.assert_nothing_saved()

    def test_eleven_duplicates_wrong_kind_unknown_400_and_kind_stays_unset(self):
        many = [make_category(f"extra{i}").pk for i in range(11)]
        cases = [
            (many, "Choose at most 10 categories."),
            ([self.fabrics.pk, self.fabrics.pk], "Pick each category once."),
            ([self.tailoring.pk], "Choose categories for a product business."),
            ([self.fabrics.pk, 999999999], "That category doesn't exist."),
        ]
        for ids, message in cases:
            response = self.post(categories=ids)
            self.assertEqual(response.status_code, 400, (message, response.content))
            self.assertEqual(response.json(), {"categories": [message]})
            self.assert_nothing_saved()

    def test_retry_after_failure_succeeds(self):
        self.assertEqual(self.post(categories=[self.tailoring.pk]).status_code, 400)
        self.assert_nothing_saved()
        # The owner is still on the plan step and can try again.
        self.assertEqual(BusinessOwner.objects.get(pk=self.owner.pk).compute_registration_step(), "plan_selection")
        response = self.post(categories=[self.fabrics.pk])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self.stored()[1], [self.fabrics.pk])

    def test_a_failure_while_creating_the_subscription_rolls_the_kind_and_categories_back(self):
        client = APIClient(raise_request_exception=False)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        with mock.patch.object(Subscription.objects, "update_or_create", side_effect=RuntimeError("boom")):
            response = client.post(
                START_TRIAL,
                {"business_kind": "product", "plan": "product_basic", "cycle_months": 1, "categories": [self.fabrics.pk]},
                format="json",
            )
        self.assertEqual(response.status_code, 500)
        self.assert_nothing_saved()

    def test_scout_registered_owner_with_kind_set_needs_no_categories(self):
        owner, profile = make_owner(
            "+233245550002", kind="product", kyc_status=BusinessOwner.VERIFIED, registration_channel=BusinessOwner.SCOUT,
        )
        client = client_for(owner)
        response = client.post(
            START_TRIAL, {"business_kind": "product", "plan": "product_basic", "cycle_months": 1}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(BusinessOwnerCategory.objects.filter(profile=profile).count(), 0)

    def test_categories_sent_when_the_kind_is_already_set_are_ignored(self):
        owner, profile = make_owner(
            "+233245550003", kind="product", kyc_status=BusinessOwner.VERIFIED, registration_channel=BusinessOwner.SCOUT,
        )
        response = client_for(owner).post(
            START_TRIAL,
            {"business_kind": "product", "plan": "product_basic", "cycle_months": 1, "categories": [self.tailoring.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(BusinessOwnerCategory.objects.filter(profile=profile).count(), 0)
        self.assertIsNone(BusinessOwnerProfile.objects.get(pk=profile.pk).business_category_id)

    def test_any_categories_value_is_ignored_when_the_kind_is_already_set(self):
        for index, value in enumerate((None, "garbage", 3, {"id": 1}, [], [True], ["abc"])):
            owner, profile = make_owner(
                f"+23324555010{index}", kind="product", kyc_status=BusinessOwner.VERIFIED,
                registration_channel=BusinessOwner.SCOUT,
            )
            response = client_for(owner).post(
                START_TRIAL,
                {"business_kind": "product", "plan": "product_basic", "cycle_months": 1, "categories": value},
                format="json",
            )
            self.assertEqual(response.status_code, 201, (value, response.content))
            self.assertEqual(BusinessOwnerCategory.objects.filter(profile=profile).count(), 0)


@override_settings(SUBSCRIPTIONS_ENABLED=False)
class BusinessKindCategoriesTests(_Fixtures, TestCase):
    def post(self, **extra):
        return self.client.post(BUSINESS_KIND, {"business_kind": "product", **extra}, format="json")

    def test_business_kind_endpoint_sets_kind_and_categories_together(self):
        response = self.post(categories=[self.shoes.pk, self.fabrics.pk])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["business_kind"], "product")
        profile, ids = self.stored()
        self.assertEqual(profile.business_kind, "product")
        self.assertEqual(ids, [self.shoes.pk, self.fabrics.pk])
        self.assertEqual(profile.business_category_id, self.shoes.pk)

    def test_absent_categories_key_sets_kind_without_categories(self):
        # Transitional: an older client (the mobile app, a cached web bundle) never sends the key.
        response = self.post()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"business_kind": "product", "registration_step": "terms"})
        profile, ids = self.stored()
        self.assertEqual(profile.business_kind, "product")
        self.assertEqual(ids, [])
        self.assertIsNone(profile.business_category_id)

    def test_explicit_empty_null_or_wrong_type_categories_400_and_kind_stays_unset(self):
        for value in ([], None, "3", 3, {"id": 3}):
            response = self.post(categories=value)
            self.assertEqual(response.status_code, 400, (value, response.content))
            self.assertEqual(response.json(), {"categories": ["Choose at least one category."]})
            self.assert_nothing_saved()

    def test_garbage_inside_the_list_answers_in_the_same_shape(self):
        for value in ([True], [[1]], ["abc"], [None]):
            response = self.post(categories=value)
            self.assertEqual(response.status_code, 400, (value, response.content))
            self.assertEqual(response.json(), {"categories": ["That category doesn't exist."]})
            self.assert_nothing_saved()

    def test_eleven_duplicates_wrong_kind_unknown_400_and_kind_stays_unset(self):
        many = [make_category(f"extra{i}").pk for i in range(11)]
        cases = [
            (many, "Choose at most 10 categories."),
            ([self.fabrics.pk, self.fabrics.pk], "Pick each category once."),
            ([self.tailoring.pk], "Choose categories for a product business."),
            ([self.fabrics.pk, 999999999], "That category doesn't exist."),
        ]
        for ids, message in cases:
            response = self.post(categories=ids)
            self.assertEqual(response.status_code, 400, (message, response.content))
            self.assertEqual(response.json(), {"categories": [message]})
            self.assert_nothing_saved()

    def test_retry_after_failure_succeeds(self):
        self.assertEqual(self.post(categories=[self.tailoring.pk]).status_code, 400)
        self.assert_nothing_saved()
        response = self.post(categories=[self.fabrics.pk])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.stored()[1], [self.fabrics.pk])

    def test_conditional_update_race_still_sets_kind_once(self):
        self.assertEqual(self.post(categories=[self.fabrics.pk]).status_code, 200)
        again = self.client.post(
            BUSINESS_KIND, {"business_kind": "service", "categories": [self.tailoring.pk]}, format="json",
        )
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.json(), {"business_kind": "Your business type is already set."})
        # Even a second call that sends no categories answers "already set" and changes nothing.
        third = self.post()
        self.assertEqual(third.status_code, 400)
        self.assertEqual(third.json(), {"business_kind": "Your business type is already set."})
        profile, ids = self.stored()
        self.assertEqual(profile.business_kind, "product")
        self.assertEqual(ids, [self.fabrics.pk])

    def test_scout_registered_owner_with_kind_set_needs_no_categories(self):
        owner, profile = make_owner("+233245550004", kind="service")
        response = client_for(owner).post(BUSINESS_KIND, {"business_kind": "service"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"business_kind": "Your business type is already set."})
        self.assertEqual(BusinessOwnerCategory.objects.filter(profile=profile).count(), 0)

    def test_any_categories_value_is_ignored_when_the_kind_is_already_set(self):
        owner, profile = make_owner("+233245550006", kind="product")
        client = client_for(owner)
        for value in (None, "garbage", [], [self.fabrics.pk], [True]):
            response = client.post(BUSINESS_KIND, {"business_kind": "product", "categories": value}, format="json")
            self.assertEqual(response.status_code, 400, (value, response.content))
            self.assertEqual(response.json(), {"business_kind": "Your business type is already set."})
        self.assertEqual(BusinessOwnerCategory.objects.filter(profile=profile).count(), 0)


class RegistrationStepTests(TestCase):
    def test_registration_step_unchanged_for_a_complete_owner_without_categories(self):
        owner, profile = make_owner("+233245550005", kind="product")
        profile.default_payout_method = BusinessOwnerProfile.MOMO
        profile.payout_momo_number = "+233245550005"
        profile.terms_accepted_at = timezone.now()
        profile.save()
        plan_owner = BusinessOwner.objects.get(pk=owner.pk)
        from billing.models import SubscriptionPlan

        Subscription.objects.create(
            business_owner=plan_owner, plan=SubscriptionPlan.objects.get(tier="product_basic"), cycle_months=1,
            is_trial=True, status=Subscription.ACTIVE, current_period_start=timezone.now(),
            current_period_end=timezone.now() + timezone.timedelta(days=30),
        )
        owner = BusinessOwner.objects.get(pk=owner.pk)
        self.assertEqual(BusinessOwnerCategory.objects.filter(profile=profile).count(), 0)
        self.assertEqual(owner.compute_registration_step(), "complete")
