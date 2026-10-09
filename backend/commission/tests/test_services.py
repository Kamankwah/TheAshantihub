from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts import kyc
from accounts.models import BusinessOwner
from activity.models import ActivityEvent
from billing.models import Subscription, SubscriptionPlan
from commission import services
from commission.models import CommissionAccrual, CommissionPolicy
from commission.tasks import release_commission_holds
from fraud import services as fraud
from fraud.models import FraudFlag

from .base import CommissionBase


class RegistrationAccrualTests(CommissionBase):
    def test_no_policy_means_nothing_accrues_and_nothing_is_backfilled_later(self):
        owner = self.pending_owner()
        self.approve(owner)
        self.assertFalse(CommissionAccrual.objects.exists())
        self.policy()  # approved afterwards
        self.assertFalse(CommissionAccrual.objects.exists())
        # Only a real KYC approval accrues; the earlier one is not revisited.
        self.assertEqual(self.pending_owner().kyc_status, BusinessOwner.PENDING)

    def test_kyc_approval_accrues_to_the_registrar_at_the_policy_amount_held_90_days(self):
        self.policy(amount="50.00")
        owner = self.pending_owner(registrar=self.scout, manager=self.other)
        self.approve(owner)
        accrual = CommissionAccrual.objects.get()
        self.assertEqual((accrual.staff, accrual.business_owner, accrual.kind, accrual.amount, accrual.status),
                         (self.scout, owner, "registration", Decimal("50.00"), "on_hold"))
        self.assertEqual(accrual.hold_until - accrual.earned_at, timedelta(days=90))
        self.assertTrue(ActivityEvent.objects.filter(verb="commission.accrued").exists())

    def test_a_retry_never_double_pays(self):
        self.policy()
        owner = self.pending_owner()
        self.approve(owner)
        self.assertIsNone(services.accrue_registration(owner))
        self.assertEqual(CommissionAccrual.objects.count(), 1)

    def test_a_business_nobody_registered_earns_nothing(self):
        self.policy()
        owner = self.pending_owner()
        BusinessOwner.objects.filter(pk=owner.pk).update(registered_by=None)
        self.approve(owner)
        self.assertFalse(CommissionAccrual.objects.exists())

    def test_the_policy_in_force_on_the_day_is_used(self):
        from datetime import date

        self.policy(amount="40.00", effective_from=date(2020, 1, 1))
        self.policy(amount="60.00", effective_from=date(2020, 6, 1))
        self.policy(amount="99.00", effective_from=timezone.localdate() + timedelta(days=30))  # not yet
        owner = self.pending_owner()
        self.approve(owner)
        self.assertEqual(CommissionAccrual.objects.get().amount, Decimal("60.00"))


class BonusAccrualTests(CommissionBase):
    def setUp(self):
        super().setUp()
        self.policy(CommissionPolicy.BONUS, "100.00")
        self.owner = self.pending_owner()
        now = timezone.now()
        Subscription.objects.create(
            business_owner=self.owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )

    def bonus(self):
        return CommissionAccrual.objects.filter(kind=CommissionPolicy.BONUS)

    def test_three_monthly_payments_earn_it_on_the_third(self):
        self.pay(self.owner)
        self.pay(self.owner)
        self.assertFalse(self.bonus().exists())
        self.pay(self.owner)
        accrual = self.bonus().get()
        self.assertEqual((accrual.staff, accrual.amount, accrual.status), (self.scout, Decimal("100.00"), "on_hold"))

    def test_a_single_three_month_payment_qualifies(self):
        self.pay(self.owner, 3)
        self.assertEqual(self.bonus().count(), 1)

    def test_a_twelve_month_payment_qualifies(self):
        self.pay(self.owner, 12)
        self.assertEqual(self.bonus().count(), 1)

    def test_a_fourth_payment_adds_nothing(self):
        self.pay(self.owner, 6)
        self.pay(self.owner, 1)
        self.assertEqual(self.bonus().count(), 1)

    def test_a_trial_never_counts(self):
        Subscription.objects.filter(business_owner=self.owner).update(is_trial=True)
        self.assertEqual(services.paid_months(self.owner), 0)
        self.pay(self.owner, 1)
        self.pay(self.owner, 1)
        self.assertFalse(self.bonus().exists())
        self.pay(self.owner, 1)  # the third paid month, after the trial
        self.assertEqual(self.bonus().count(), 1)

    def test_it_goes_to_the_manager_at_the_time_of_the_payment(self):
        self.pay(self.owner, 1)
        BusinessOwner.objects.filter(pk=self.owner.pk).update(account_manager=self.other)
        self.pay(self.owner, 3)
        self.assertEqual(self.bonus().get().staff, self.other)

    def test_no_manager_no_bonus(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(account_manager=None)
        self.pay(self.owner, 3)
        self.assertFalse(self.bonus().exists())

    def test_no_policy_no_bonus(self):
        CommissionPolicy.objects.all().delete()
        self.pay(self.owner, 3)
        self.assertFalse(self.bonus().exists())

    def test_a_policy_approved_after_three_paid_months_is_not_backfilled_by_the_next_payment(self):
        CommissionPolicy.objects.all().delete()
        self.pay(self.owner, 3)
        self.policy(CommissionPolicy.BONUS, "100.00")
        self.pay(self.owner, 1)
        self.assertFalse(self.bonus().exists())

    def test_a_manager_assigned_after_three_paid_months_earns_nothing_on_the_next_payment(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(account_manager=None)
        self.pay(self.owner, 3)
        BusinessOwner.objects.filter(pk=self.owner.pk).update(account_manager=self.scout)
        self.pay(self.owner, 1)
        self.assertFalse(self.bonus().exists())

    def test_the_normal_path_accrues_exactly_once(self):
        self.pay(self.owner, 1)
        self.pay(self.owner, 1)
        self.pay(self.owner, 1)
        self.pay(self.owner, 1)
        self.assertEqual(self.bonus().count(), 1)

    def test_progress_list_omits_a_business_already_past_three_months_without_a_bonus(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(account_manager=None)
        self.pay(self.owner, 3)
        BusinessOwner.objects.filter(pk=self.owner.pk).update(account_manager=self.scout)
        from commission.views import bonus_rows

        rows, _more = bonus_rows(self.scout, timezone.now())
        self.assertNotIn(self.owner.pk, [r["business_id"] for r in rows])

    def test_only_scouts_earn(self):
        for role_staff in (self.lead, self.boss):
            owner = self.pending_owner(registrar=role_staff, manager=role_staff, name="Role")
            Subscription.objects.create(
                business_owner=owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
                current_period_start=timezone.now(), current_period_end=timezone.now() + timedelta(days=30),
            )
            self.policy(CommissionPolicy.REGISTRATION, "50.00")
            kyc.approve_owner(owner.pk, self.boss if role_staff is self.lead else self.lead)
            self.pay(owner, 3)
        self.assertFalse(CommissionAccrual.objects.exists())

    def test_no_bonus_for_a_business_with_a_confirmed_reversing_case(self):
        fraud.confirm(fraud.raise_flag(FraudFlag.DUPLICATE, title="Case", business_owner=self.owner).pk, self.boss, note="Checked")
        self.pay(self.owner, 3)
        self.assertFalse(self.bonus().exists())

    def test_no_registration_commission_for_a_business_with_a_confirmed_reversing_case(self):
        self.policy(CommissionPolicy.REGISTRATION, "50.00")
        fraud.confirm(fraud.raise_flag(FraudFlag.FAKE_BUSINESS, title="Case", business_owner=self.owner).pk, self.boss, note="Checked")
        self.approve(self.owner)
        self.assertFalse(CommissionAccrual.objects.exists())

    def test_a_dismissed_case_does_not_block(self):
        flag = fraud.raise_flag(FraudFlag.DUPLICATE, title="Case", business_owner=self.owner)
        fraud.dismiss(flag.pk, self.boss, note="Fine")
        self.pay(self.owner, 3)
        self.assertEqual(self.bonus().count(), 1)


class ServerPricedMonthsTests(CommissionBase):
    def setUp(self):
        super().setUp()
        self.owner = self.pending_owner()

    def raw_pay(self, plan, months, amount="0.01"):
        from payments.models import CheckoutSession
        from payments.services import process_payment

        return process_payment(
            kind=CheckoutSession.SUBSCRIPTION, amount=Decimal(amount), purpose="Subscription", business_owner=self.owner,
            metadata={"plan": plan, "cycle_months": months},
        )

    def test_an_unknown_plan_adds_no_paid_months(self):
        self.raw_pay("no_such_plan", 3)
        self.assertEqual(services.paid_months(self.owner), 0)

    def test_an_invalid_cycle_adds_no_paid_months(self):
        self.raw_pay("product_basic", 5)
        self.assertEqual(services.paid_months(self.owner), 0)

    def test_a_valid_three_month_payment_adds_three(self):
        self.raw_pay("product_basic", 3, "100.00")
        self.assertEqual(services.paid_months(self.owner), 3)

    def test_the_endpoint_refuses_an_invalid_cycle(self):
        from rest_framework.test import APIClient
        from accounts.authentication import issue_token

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = client.post(
            "/api/billing/transactions/mine/",
            {"kind": "subscription", "amount": "0.01", "purpose": "x", "metadata": {"plan": "product_basic", "cycle_months": 5}},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("metadata", response.json())


class FallbackRenewalPricingTests(CommissionBase):
    """The tier's plan is awaiting approval, so the renewal prices off the owner's current plan."""

    def setUp(self):
        super().setUp()
        from accounts.authentication import issue_token
        from payments.models import CheckoutSession
        from rest_framework.test import APIClient

        self.CheckoutSession = CheckoutSession
        self.owner = self.pending_owner()
        self.plan = SubscriptionPlan.objects.get(tier="product_basic")
        now = timezone.now()
        self.sub = Subscription.objects.create(
            business_owner=self.owner, plan=self.plan, current_period_start=now,
            current_period_end=now - timedelta(days=1), status=Subscription.ACTIVE,
        )
        SubscriptionPlan.objects.filter(pk=self.plan.pk).update(status=SubscriptionPlan.PENDING_APPROVAL)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def post(self, amount="0.01", plan="product_basic", cycle=3):
        return self.client.post(
            "/api/billing/transactions/mine/",
            {"kind": "subscription", "amount": amount, "purpose": "x", "metadata": {"plan": plan, "cycle_months": cycle}},
            format="json",
        )

    def test_the_client_amount_is_replaced_by_the_current_plans_price(self):
        response = self.post()
        self.assertIn(response.status_code, (200, 201), response.content)
        session = self.CheckoutSession.objects.get(business_owner=self.owner)
        self.assertEqual(session.amount, self.plan.monthly_price * 3)
        self.assertEqual(session.status, self.CheckoutSession.SUCCESS)
        self.assertEqual(services.paid_months(self.owner), 3)
        self.sub.refresh_from_db()
        self.assertGreater(self.sub.current_period_end, timezone.now() + timedelta(days=80))

    def test_a_tier_that_resolves_to_no_plan_is_refused(self):
        response = self.post(plan="no_such_plan")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(self.CheckoutSession.objects.exists())

    def test_a_cheap_fallback_session_still_renews_but_adds_no_paid_months(self):
        # A session that was not priced by the server (0.01 for 3 months) renews but never counts.
        from payments.services import process_payment

        process_payment(
            kind=self.CheckoutSession.SUBSCRIPTION, amount=Decimal("0.01"), purpose="Subscription",
            business_owner=self.owner, metadata={"plan": "product_basic", "cycle_months": 3},
        )
        self.sub.refresh_from_db()
        self.assertGreater(self.sub.current_period_end, timezone.now() + timedelta(days=80))
        self.assertEqual(services.paid_months(self.owner), 0)


class LegacyPaidMonthsTests(CommissionBase):
    def make(self, owner, meta, status="success"):
        from payments.models import CheckoutSession

        return CheckoutSession.objects.create(
            business_owner=owner, kind=CheckoutSession.SUBSCRIPTION, amount="30.00", purpose="x", status=status, metadata=meta,
        )

    def test_the_helper_stamps_valid_leaves_stamped_and_zeroes_invalid(self):
        from payments.legacy import stamp_legacy_paid_months
        from payments.models import CheckoutSession

        owner = self.pending_owner()
        valid = self.make(owner, {"plan": "product_basic", "cycle_months": 3})
        stamped = self.make(owner, {"plan": "product_basic", "cycle_months": 3, "paid_months": 1})
        invalid = self.make(owner, {"plan": "product_basic", "cycle_months": 5})
        junk = self.make(owner, {"plan": "product_basic", "cycle_months": "abc"})
        none = self.make(owner, {})
        failed = self.make(owner, {"cycle_months": 3}, status="failed")
        stamp_legacy_paid_months(CheckoutSession)
        for obj in (valid, stamped, invalid, junk, none, failed):
            obj.refresh_from_db()
        self.assertEqual(valid.metadata["paid_months"], 3)
        self.assertEqual(stamped.metadata["paid_months"], 1)
        self.assertEqual(invalid.metadata["paid_months"], 0)
        self.assertEqual(junk.metadata["paid_months"], 0)
        self.assertEqual(none.metadata["paid_months"], 0)
        self.assertNotIn("paid_months", failed.metadata)

    def test_a_business_with_three_legacy_months_earns_no_bonus_and_is_not_listed_as_zero(self):
        from payments.legacy import stamp_legacy_paid_months
        from payments.models import CheckoutSession

        self.policy(CommissionPolicy.BONUS, "100.00")
        owner = self.pending_owner()
        now = timezone.now()
        Subscription.objects.create(
            business_owner=owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )
        self.make(owner, {"plan": "product_basic", "cycle_months": 3})
        self.assertEqual(services.paid_months(owner), 0)  # unstamped legacy row
        stamp_legacy_paid_months(CheckoutSession)
        self.assertEqual(services.paid_months(owner), 3)
        self.assertEqual(services.paid_months_by_owner([owner.pk])[owner.pk], 3)
        self.pay(owner, 1)
        self.assertFalse(CommissionAccrual.objects.filter(kind=CommissionPolicy.BONUS).exists())


class ReleaseAndReversalTests(CommissionBase):
    def setUp(self):
        super().setUp()
        self.policy()
        self.owner = self.pending_owner()
        self.approve(self.owner)
        self.accrual = CommissionAccrual.objects.get()

    def age(self, days):
        CommissionAccrual.objects.update(hold_until=timezone.now() - timedelta(days=days))

    def test_release_moves_only_lines_past_their_hold(self):
        self.assertEqual(release_commission_holds(), 0)
        self.accrual.refresh_from_db()
        self.assertEqual(self.accrual.status, "on_hold")
        self.age(1)
        self.assertEqual(release_commission_holds(), 1)
        self.accrual.refresh_from_db()
        self.assertEqual(self.accrual.status, "payable")
        self.assertEqual(release_commission_holds(), 0)

    def confirm(self, kind, owner=None):
        flag = fraud.raise_flag(kind, title="Case", business_owner=owner or self.owner)
        return fraud.confirm(flag.pk, self.boss, note="Checked")

    def test_each_reversing_kind_reverses_an_unreleased_line(self):
        for kind in (FraudFlag.DUPLICATE, FraudFlag.SIMILAR_NEARBY, FraudFlag.FAKE_BUSINESS):
            CommissionAccrual.objects.update(status="on_hold", reversed_reason="", reversed_at=None)
            self.confirm(kind)
            self.accrual.refresh_from_db()
            self.assertEqual((self.accrual.status, self.accrual.reversed_reason), ("reversed", kind))
            self.assertIsNotNone(self.accrual.reversed_at)
        self.assertTrue(ActivityEvent.objects.filter(verb="commission.reversed").exists())

    def test_a_payable_line_is_reversed_too(self):
        self.age(1)
        release_commission_holds()
        self.confirm(FraudFlag.FAKE_BUSINESS)
        self.accrual.refresh_from_db()
        self.assertEqual(self.accrual.status, "reversed")

    def test_nothing_after_it_is_in_a_batch_or_paid(self):
        for status in ("in_batch", "paid"):
            CommissionAccrual.objects.update(status=status)
            self.confirm(FraudFlag.DUPLICATE)
            self.accrual.refresh_from_db()
            self.assertEqual(self.accrual.status, status)

    def test_other_kinds_and_dismissed_cases_leave_it_alone(self):
        self.confirm(FraudFlag.OTHER)
        flag = fraud.raise_flag(FraudFlag.DUPLICATE, title="Case", business_owner=self.owner)
        fraud.dismiss(flag.pk, self.boss, note="Not a duplicate")
        self.accrual.refresh_from_db()
        self.assertEqual(self.accrual.status, "on_hold")

    def test_another_business_is_untouched(self):
        other = self.pending_owner()
        self.approve(other)
        self.confirm(FraudFlag.DUPLICATE, owner=other)
        self.assertEqual(CommissionAccrual.objects.filter(status="reversed").count(), 1)
        self.accrual.refresh_from_db()
        self.assertEqual(self.accrual.status, "on_hold")

    def test_a_reversed_line_is_not_earned_again_by_a_retry(self):
        self.confirm(FraudFlag.DUPLICATE)
        self.assertIsNone(services.accrue_registration(self.owner))
        self.assertEqual(CommissionAccrual.objects.count(), 1)
