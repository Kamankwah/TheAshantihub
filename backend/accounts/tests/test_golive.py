"""The go-live rule (self-serve phase 2, Task 2): a business may submit listings once it has a confirmed email, a shop
pin, a business type and accepted terms - no staff decision. KYC-verified owners and the company owner were approved
under the old rule and stay live. The self-registration chain gains `shop_location` and drops `payment_info`."""
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import golive
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from billing.models import Subscription, SubscriptionPlan
from otp.models import EMAIL, VerifiedContact

ME = "/api/accounts/me/"


def make_owner(phone="+233241440001", email="ama@example.com", *, confirmed=True, pin=True, kind="product",
               terms=True, channel=BusinessOwner.SELF, **owner_extra):
    owner = BusinessOwner.objects.create(
        full_name="Ama Trader", login_phone=phone, password_hash="x", email=email, registration_channel=channel,
        **owner_extra,
    )
    profile = BusinessOwnerProfile.objects.create(
        business_owner=owner, business_contact_phone=phone, business_kind=kind if kind else None,
        lat=Decimal("6.690000") if pin else None, lng=Decimal("-1.620000") if pin else None,
        terms_accepted_at=timezone.now() if terms else None,
    )
    if confirmed and email:
        confirm(owner)
    return owner, profile


def confirm(owner):
    VerifiedContact.objects.create(
        account_type="business_owner", account_id=owner.pk, channel=EMAIL, destination=owner.email.lower(),
    )


def fresh(owner):
    return BusinessOwner.objects.get(pk=owner.pk)


class BlockerTests(TestCase):
    def test_a_fully_set_up_business_is_live(self):
        owner, _ = make_owner()
        self.assertEqual(golive.blockers(owner), [])
        self.assertTrue(golive.is_live(owner))

    def test_no_email_is_email_missing(self):
        owner, _ = make_owner(email=None)
        self.assertEqual(golive.blockers(fresh(owner)), ["email_missing"])
        self.assertFalse(golive.is_live(fresh(owner)))

    def test_unconfirmed_email_is_email_unconfirmed(self):
        owner, _ = make_owner(confirmed=False)
        self.assertEqual(golive.blockers(owner), ["email_unconfirmed"])

    def test_a_changed_email_is_unconfirmed_again(self):
        owner, _ = make_owner()
        owner.email = "new@example.com"
        owner.save(update_fields=["email"])
        self.assertEqual(golive.blockers(fresh(owner)), ["email_unconfirmed"])

    def test_no_pin_is_no_pin(self):
        owner, _ = make_owner(pin=False)
        self.assertEqual(golive.blockers(owner), ["no_pin"])

    def test_no_business_type_is_no_business_kind(self):
        owner, _ = make_owner(kind=None)
        self.assertEqual(golive.blockers(owner), ["no_business_kind"])

    def test_unaccepted_terms_is_terms_missing(self):
        owner, _ = make_owner(terms=False)
        self.assertEqual(golive.blockers(owner), ["terms_missing"])

    def test_an_owner_with_no_profile_lacks_the_profile_facts_without_a_500(self):
        owner = BusinessOwner.objects.create(full_name="Bare", login_phone="+233241440009", password_hash="x")
        self.assertEqual(
            golive.blockers(owner), ["email_missing", "no_pin", "no_business_kind", "terms_missing"],
        )

    def test_blockers_order(self):
        owner, _ = make_owner(email=None, pin=False, kind=None, terms=False)
        self.assertEqual(
            golive.blockers(fresh(owner)), ["email_missing", "no_pin", "no_business_kind", "terms_missing"],
        )
        owner2, _ = make_owner("+233241440002", "b@example.com", confirmed=False, pin=False, kind=None, terms=False)
        self.assertEqual(
            golive.blockers(owner2), ["email_unconfirmed", "no_pin", "no_business_kind", "terms_missing"],
        )

    def test_every_code_has_an_owner_facing_message(self):
        codes = {"email_missing", "email_unconfirmed", "no_pin", "no_business_kind", "terms_missing"}
        self.assertEqual(set(golive.MESSAGES), codes)
        for message in golive.MESSAGES.values():
            self.assertNotIn("KYC", message)

    def test_kyc_verified_owner_is_live_with_no_email(self):
        owner, _ = make_owner(email=None, confirmed=False, pin=False, kind=None, terms=False,
                              kyc_status=BusinessOwner.VERIFIED)
        self.assertEqual(golive.blockers(fresh(owner)), [])
        self.assertTrue(golive.is_live(fresh(owner)))

    def test_company_owner_is_live(self):
        owner, _ = make_owner(email=None, confirmed=False, pin=False, kind=None, terms=False, is_company=True)
        self.assertEqual(golive.blockers(fresh(owner)), [])
        self.assertTrue(golive.is_live(fresh(owner)))


class MePayloadTests(TestCase):
    def setUp(self):
        cache.clear()

    def get_me(self, owner):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        response = client.get(ME)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_me_carries_go_live_with_blocker_messages(self):
        owner, _ = make_owner(confirmed=False, pin=False)
        body = self.get_me(owner)
        self.assertEqual(body["go_live"]["live"], False)
        self.assertEqual(
            body["go_live"]["blockers"],
            [
                {"code": "email_unconfirmed", "message": golive.MESSAGES["email_unconfirmed"]},
                {"code": "no_pin", "message": golive.MESSAGES["no_pin"]},
            ],
        )

    def test_me_for_a_live_business(self):
        owner, _ = make_owner()
        self.assertEqual(self.get_me(owner)["go_live"], {"live": True, "blockers": []})

    def test_me_for_a_staff_user_or_customer_has_no_go_live(self):
        from accounts.models import Customer
        customer = Customer.objects.create(full_name="Kofi", phone="+233200000071", password_hash="x")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertNotIn("go_live", client.get(ME).json())


@override_settings(SUBSCRIPTIONS_ENABLED=False)
class SelfChannelStepTests(TestCase):
    def new_owner(self, phone="+233241440050"):
        owner = BusinessOwner.objects.create(full_name="New Trader", login_phone=phone, password_hash="x")
        profile = BusinessOwnerProfile.objects.create(business_owner=owner)
        return owner, profile

    def step(self, owner):
        return fresh(owner).compute_registration_step()

    def test_registration_step_sequence_for_a_new_owner(self):
        owner, profile = self.new_owner()
        self.assertEqual(self.step(owner), "business_info")
        profile.business_contact_phone = "+233241440050"  # the Ghana Post code is optional now
        profile.save()
        self.assertEqual(self.step(owner), "shop_location")
        profile.lat, profile.lng = Decimal("6.690000"), Decimal("-1.620000")
        profile.save()
        self.assertEqual(self.step(owner), "plan_selection")
        profile.business_kind = "product"
        profile.save()
        self.assertEqual(self.step(owner), "terms")
        profile.terms_accepted_at = timezone.now()
        profile.save()
        self.assertEqual(self.step(owner), "complete")

    def test_business_info_needs_only_the_contact_phone(self):
        owner, profile = self.new_owner()
        profile.gps_address = "AK-039-5028"
        profile.save()
        self.assertEqual(self.step(owner), "business_info")

    def test_payment_info_never_returned_for_self_channel(self):
        owner, profile = self.new_owner()
        profile.business_contact_phone = "+233241440050"
        profile.lat, profile.lng = Decimal("6.690000"), Decimal("-1.620000")
        profile.business_kind = "product"
        profile.save()
        self.assertFalse(profile.has_payout_details())
        self.assertEqual(self.step(owner), "terms")

    @override_settings(SUBSCRIPTIONS_ENABLED=True)
    def test_with_subscriptions_on_a_plan_is_still_needed_after_the_pin(self):
        owner, profile = self.new_owner()
        profile.business_contact_phone = "+233241440050"
        profile.lat, profile.lng = Decimal("6.690000"), Decimal("-1.620000")
        profile.business_kind = "product"
        profile.save()
        self.assertEqual(self.step(owner), "plan_selection")
        plan = SubscriptionPlan.objects.create(
            tier="golive_plan", name="Plan", kind="product", monthly_price=10, status=SubscriptionPlan.ACTIVE_STATUS,
        )
        Subscription.objects.create(
            business_owner=owner, plan=plan, cycle_months=1, is_trial=True, status=Subscription.ACTIVE,
            current_period_start=timezone.now(), current_period_end=timezone.now() + timedelta(days=30),
        )
        self.assertEqual(self.step(owner), "terms")

    def test_rejected_owner_still_complete(self):
        owner, _ = self.new_owner()
        BusinessOwner.objects.filter(pk=owner.pk).update(kyc_status=BusinessOwner.REJECTED)
        self.assertEqual(self.step(owner), "complete")

    def test_kyc_verified_owner_sees_no_new_step(self):
        owner, profile = self.new_owner()
        profile.business_kind = "product"
        profile.save()
        BusinessOwner.objects.filter(pk=owner.pk).update(kyc_status=BusinessOwner.VERIFIED)
        self.assertEqual(self.step(owner), "complete")

    def test_kyc_verified_owner_without_a_type_still_goes_to_plan_selection(self):
        owner, _ = self.new_owner()
        BusinessOwner.objects.filter(pk=owner.pk).update(kyc_status=BusinessOwner.VERIFIED)
        self.assertEqual(self.step(owner), "plan_selection")

    def test_scout_registered_chain_unchanged(self):
        owner = BusinessOwner.objects.create(
            full_name="Scouted", login_phone="+233241440060", password_hash="x",
            registration_channel=BusinessOwner.SCOUT, kyc_status=BusinessOwner.VERIFIED,
        )
        profile = BusinessOwnerProfile.objects.create(business_owner=owner, business_kind="product")
        self.assertEqual(fresh(owner).compute_registration_step(), "payment_info")
        profile.default_payout_method = "momo"
        profile.payout_momo_number = "+233241440060"
        profile.save()
        self.assertEqual(fresh(owner).compute_registration_step(), "complete")
