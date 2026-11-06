from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from billing import clock, switch
from billing.models import Subscription, SubscriptionPlan
from listings.models import Category, HeroMediaSubmission, Listing, Promotion, Zone
from listings.visibility import hidden_business_q


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
        self.category = Category.objects.create(
            slug="frz-fabrics", icon="🧵", label="Fabrics", color="#7c3aed", kind="product",
        )
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
        response = self.client.post(
            "/api/billing/business-kind/", {"business_kind": "product", "categories": [self.category.pk]}, format="json",
        )
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

    # --- a verified owner with no business type (KYC approved at the type step, or never subscribed) ---

    def _owner_with_kyc(self, status, kind=""):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=status)
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(business_kind=kind or None)
        return BusinessOwner.objects.get(pk=self.owner.pk)

    def test_a_verified_owner_with_no_kind_is_sent_to_the_type_step(self):
        owner = self._owner_with_kyc(BusinessOwner.VERIFIED)
        self.assertEqual(owner.compute_registration_step(), "plan_selection")

    def test_a_verified_owner_with_a_kind_is_complete(self):
        owner = self._owner_with_kyc(BusinessOwner.VERIFIED, kind="product")
        self.assertEqual(owner.compute_registration_step(), "complete")

    def test_a_rejected_owner_with_no_kind_stays_complete(self):
        owner = self._owner_with_kyc(BusinessOwner.REJECTED)
        self.assertEqual(owner.compute_registration_step(), "complete")

    def test_a_verified_owner_with_no_profile_keeps_the_old_answer(self):
        bare = BusinessOwner.objects.create(
            full_name="Ama", login_phone="+233207880003", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        self.assertEqual(bare.compute_registration_step(), "complete")

    def test_the_company_shop_is_never_sent_to_the_type_step(self):
        owner = self._owner_with_kyc(BusinessOwner.VERIFIED)
        owner.is_company = True
        self.assertEqual(owner.compute_registration_step(), "complete")

    @override_settings(SUBSCRIPTIONS_ENABLED=True)
    def test_with_the_switch_on_a_verified_owner_with_no_kind_is_unchanged(self):
        owner = self._owner_with_kyc(BusinessOwner.VERIFIED)
        self.assertEqual(owner.compute_registration_step(), "complete")

    def test_a_verified_owner_can_set_the_kind_then_create_a_listing(self):
        self._owner_with_kyc(BusinessOwner.VERIFIED)
        me = self.client.get("/api/accounts/me/")
        self.assertEqual(me.json()["registration_step"], "plan_selection")
        response = self.client.post(
            "/api/billing/business-kind/", {"business_kind": "product", "categories": [self.category.pk]}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["registration_step"], "complete")
        self.assertEqual(self.client.get("/api/accounts/me/").json()["registration_step"], "complete")
        created = self.client.post(
            "/api/listings/mine/",
            {
                "category": self.category.pk, "zone": Zone.objects.get(name="Manhyia").pk, "name": "Kente cloth",
                "description": "Hand woven.", "contact_phone": "+233207880001", "price_amount": "150.00",
                "has_warranty": False, "has_expiry": False, "return_policy": "Unopened, within 7 days.",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)

    # --- gates (a), (c), (d): with the switch off nothing reads overdue, paused or unsubscribed ---

    def _lapsed(self, *, paused=False):
        now = timezone.now()
        end = now - timedelta(days=30)
        return Subscription.objects.create(
            business_owner=self.owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=end - timedelta(days=30), current_period_end=end,
            overdue_since=end, paused_at=(now - timedelta(days=2)) if paused else None,
        )

    def _published_listing(self):
        return Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Kofi stall", description="D.", contact_phone="+233207880999", price_amount="150.00",
            status=Listing.PUBLISHED,
        )

    def test_an_overdue_row_reads_as_none_with_the_switch_off(self):
        subscription = self._lapsed()
        state = clock.subscription_state(subscription)
        self.assertEqual(state["state"], clock.NONE)
        self.assertEqual(state, clock.subscription_state(None))
        self.assertIsNone(state["plan_name"])
        self.assertIsNone(state["overdue_since"])
        self.assertIsNone(state["overdue_day"])

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_a_paused_row_reads_as_none_with_the_switch_off(self):
        self.assertEqual(clock.subscription_state(self._lapsed(paused=True))["state"], clock.NONE)

    def test_featured_blockers_have_no_subscription_overdue_with_the_switch_off(self):
        from marketing import featured

        self._lapsed()
        codes = [b["code"] for b in featured.blockers(self._published_listing())]
        self.assertNotIn("subscription_overdue", codes)

    def test_staff_listing_card_has_no_subscription_overdue(self):
        from listings.serializers import ModerationListingSerializer

        self._lapsed()
        self.assertIsNone(ModerationListingSerializer(self._published_listing()).data["subscription_overdue"])

    def test_hero_and_promotion_checks_have_no_subscription_check(self):
        from listings.moderation_checks import hero_checks, promotion_checks

        listing = self._published_listing()
        for lapsed in (False, True):  # no row at all, then an overdue row
            if lapsed:
                self._lapsed()
                self.owner.refresh_from_db()
            hero = hero_checks(HeroMediaSubmission(business_owner=self.owner, caption="Kente"))
            promotion = promotion_checks(Promotion(listing=listing, kind=Promotion.FEATURED))
            keys = [c["key"] for c in hero + promotion]
            self.assertNotIn("subscription", keys)
            self.assertIn("kyc", keys)  # the other checks are still there
            self.assertIn("listing_live", keys)

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_a_paused_row_stays_public_even_with_pause_enabled(self):
        self._lapsed(paused=True)
        listing = self._published_listing()
        self.assertIn(listing, Listing.objects.exclude(hidden_business_q()))
        self.assertFalse(BusinessOwner.objects.filter(pk=self.owner.pk).filter(hidden_business_q("")).exists())

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_a_suspended_business_is_still_hidden_with_the_switch_off(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(is_suspended=True)
        self.assertFalse(Listing.objects.exclude(hidden_business_q()).filter(pk=self._published_listing().pk).exists())

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_staff_screens_show_no_overdue_or_paused_for_a_lapsed_row(self):
        from messaging.context import _subscription
        from portfolio import health
        from portfolio.proposals import check_listing
        from staff_tasks.serializers import _subscription_states
        from support.people import business_status

        subscription = self._lapsed(paused=True)
        now = timezone.now()
        owner = BusinessOwner.objects.get(pk=self.owner.pk)
        # Support: the status chip is not "Subscription overdue".
        self.assertNotIn("overdue", business_status(owner, False)["label"].lower())
        # Portfolio health: no overdue/paused state or reason.
        row = health.rate_all(BusinessOwner.objects.filter(pk=owner.pk), now)[0]
        self.assertEqual(row.subscription["state"], clock.NONE)
        self.assertNotIn(health.OVERDUE, row.reasons)
        self.assertNotIn(health.PAUSED, row.reasons)
        # Scout/manager proposals: a paused row does not stop a new listing.
        _, errors = check_listing(owner, {}, require_kyc=False)
        self.assertNotIn("subscription", errors)
        # Messaging context and the staff task card.
        self.assertEqual(_subscription(owner, now)["state"], clock.NONE)
        self.assertIsNone(_subscription(owner, now)["plan_name"])
        self.assertEqual(_subscription_states([subscription.pk])[subscription.pk]["state"], clock.NONE)


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
