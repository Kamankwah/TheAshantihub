from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .models import Subscription, SubscriptionPlan, Transaction


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPlan
        fields = ["id", "tier", "name", "monthly_price", "annual_price", "features", "is_recommended"]


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = SubscriptionPlanSerializer(read_only=True)

    class Meta:
        model = Subscription
        fields = [
            "id", "plan", "billing_cycle", "status",
            "current_period_start", "current_period_end", "created_at", "updated_at",
        ]


class SubscribeSerializer(serializers.Serializer):
    """Input serializer for the subscribe/change-plan action.

    Persists the subscription state that results from the simulated MoMoPayment
    "success" flow — this endpoint does not itself verify any payment.
    """

    plan = serializers.SlugRelatedField(slug_field="tier", queryset=SubscriptionPlan.objects.all())
    billing_cycle = serializers.ChoiceField(choices=Subscription.BILLING_CYCLE_CHOICES)

    def save(self, business_owner):
        plan = self.validated_data["plan"]
        billing_cycle = self.validated_data["billing_cycle"]
        now = timezone.now()
        period_length = timedelta(days=365) if billing_cycle == Subscription.ANNUAL else timedelta(days=30)

        subscription, _ = Subscription.objects.update_or_create(
            business_owner=business_owner,
            defaults={
                "plan": plan,
                "billing_cycle": billing_cycle,
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
