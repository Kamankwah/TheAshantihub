from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from accounts.models import BusinessOwnerProfile

from .models import Subscription, SubscriptionPlan, Transaction

# python-dateutil is NOT a project dependency (backend/requirements.txt) —
# every "N months from now" calculation in this file approximates a calendar
# month as 30 days via timedelta(days=30 * cycle_months) rather than
# dateutil.relativedelta(months=cycle_months).


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    """Public-facing plan shape — used by the public plan list
    (SubscriptionPlanListView, already filtered to status="active") and
    nested inside SubscriptionSerializer. Deliberately excludes
    status/rejection_reason: not meaningful for a plan a caller can only ever
    see here because it's already active.
    """

    class Meta:
        model = SubscriptionPlan
        fields = [
            "id", "tier", "name", "kind", "monthly_price", "features", "is_recommended",
            "max_active_listings", "hero_days", "boost_credits_per_month",
        ]


class SubscriptionPlanAdminSerializer(serializers.ModelSerializer):
    """Staff-facing CRUD shape backing subscription_plans.manage/.approve —
    includes status/rejection_reason, both of which SubscriptionPlanSerializer
    hides from the public. Used by SubscriptionPlanAdminListCreateView (list
    all + create), SubscriptionPlanAdminUpdateView (patch), and
    SubscriptionPlanPendingQueueView (list pending).
    """

    class Meta:
        model = SubscriptionPlan
        fields = [
            "id", "tier", "name", "kind", "monthly_price", "features", "is_recommended",
            "status", "rejection_reason", "max_active_listings", "hero_days",
            "boost_credits_per_month",
        ]
        read_only_fields = ["id"]

    def create(self, validated_data):
        # Never trust client-submitted status on creation — every new plan
        # starts pending_approval regardless of what's submitted, mirroring
        # listings.HeroMediaSubmission/Listing's own "status only changes via
        # moderation" convention.
        validated_data["status"] = SubscriptionPlan.PENDING_APPROVAL
        validated_data["rejection_reason"] = None
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # An edit to an already-live plan must go back through approval —
        # mirrors listings.OwnerListingSerializer's convention of guarding
        # status transitions inside the serializer, not the view.
        if instance.status == SubscriptionPlan.ACTIVE_STATUS:
            validated_data["status"] = SubscriptionPlan.PENDING_APPROVAL
            validated_data["rejection_reason"] = None
        return super().update(instance, validated_data)


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = SubscriptionPlanSerializer(read_only=True)

    class Meta:
        model = Subscription
        fields = [
            "id", "plan", "cycle_months", "is_trial", "status",
            "current_period_start", "current_period_end", "created_at", "updated_at",
        ]


class SubscribeSerializer(serializers.Serializer):
    """Input serializer for the subscribe/change-plan/renew action
    (SubscriptionMeView.post). Persists the subscription state that results
    from the simulated MoMoPayment "success" flow — this endpoint does not
    itself verify any payment.

    Distinct from StartTrialSerializer below: this path always sets
    is_trial=False (change-plan/renew after the initial free trial, never the
    trial itself) and never touches business_kind.
    """

    plan = serializers.SlugRelatedField(
        slug_field="tier",
        queryset=SubscriptionPlan.objects.filter(status=SubscriptionPlan.ACTIVE_STATUS),
    )
    cycle_months = serializers.ChoiceField(choices=Subscription.CYCLE_CHOICES)

    def save(self, business_owner):
        plan = self.validated_data["plan"]
        cycle_months = self.validated_data["cycle_months"]
        now = timezone.now()
        period_length = timedelta(days=30 * cycle_months)

        subscription, _ = Subscription.objects.update_or_create(
            business_owner=business_owner,
            defaults={
                "plan": plan,
                "cycle_months": cycle_months,
                "is_trial": False,
                "status": Subscription.ACTIVE,
                "current_period_start": now,
                "current_period_end": now + period_length,
            },
        )
        return subscription


class StartTrialSerializer(serializers.Serializer):
    """Input serializer for POST /api/billing/subscriptions/start-trial/ —
    the registration-time free trial start
    (accounts.BusinessOwner.compute_registration_step()'s "plan_selection"
    step). Distinct from SubscribeSerializer above: always creates
    is_trial=True and additionally sets BusinessOwnerProfile.business_kind,
    since this is the one-time moment a business owner first picks their
    product/service kind.
    """

    business_kind = serializers.ChoiceField(choices=BusinessOwnerProfile.BUSINESS_KIND_CHOICES)
    # Restricting the queryset to active plans means an unknown/pending/
    # rejected tier slug naturally 400s here as "does not exist" — the same
    # validation SubscribeSerializer's plan field already relies on.
    plan = serializers.SlugRelatedField(
        slug_field="tier",
        queryset=SubscriptionPlan.objects.filter(status=SubscriptionPlan.ACTIVE_STATUS),
    )
    cycle_months = serializers.ChoiceField(choices=Subscription.CYCLE_CHOICES)

    def validate(self, attrs):
        if attrs["plan"].kind != attrs["business_kind"]:
            raise serializers.ValidationError(
                {"plan": "This plan's kind does not match the submitted business_kind."}
            )
        return attrs

    def save(self, business_owner):
        plan = self.validated_data["plan"]
        business_kind = self.validated_data["business_kind"]
        cycle_months = self.validated_data["cycle_months"]
        now = timezone.now()
        period_length = timedelta(days=30 * cycle_months)

        profile = business_owner.profile
        profile.business_kind = business_kind
        profile.save(update_fields=["business_kind"])

        subscription, _ = Subscription.objects.update_or_create(
            business_owner=business_owner,
            defaults={
                "plan": plan,
                "cycle_months": cycle_months,
                "is_trial": True,
                "status": Subscription.ACTIVE,
                "current_period_start": now,
                "current_period_end": now + period_length,
            },
        )
        return subscription


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ["id", "amount", "purpose", "status", "reference", "created_at"]
        read_only_fields = ["id", "created_at"]
        extra_kwargs = {"status": {"required": False}}


class TransactionReportSerializer(serializers.ModelSerializer):
    # SerializerMethodField rather than a dotted `source=` CharField because
    # exactly one of business_owner/customer is set per row (see
    # Transaction's CheckConstraint) — a dotted source would try to read
    # `.full_name` off whichever FK is None.
    business_owner_name = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = [
            "id", "business_owner", "business_owner_name", "customer", "customer_name",
            "amount", "purpose", "status", "reference", "created_at",
        ]

    def get_business_owner_name(self, obj):
        return obj.business_owner.full_name if obj.business_owner_id else None

    def get_customer_name(self, obj):
        return obj.customer.full_name if obj.customer_id else None
