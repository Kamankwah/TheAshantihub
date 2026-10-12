from rest_framework import serializers

from accounts.models import BusinessOwner

from . import services
from .models import FraudFlag


class FraudFlagSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    business_owner = serializers.SerializerMethodField()
    related_business_owner = serializers.SerializerMethodField()
    staff_subject = serializers.SerializerMethodField()
    raised_by_name = serializers.CharField(source="raised_by.full_name", read_only=True, default=None)
    resolved_by_name = serializers.CharField(source="resolved_by.full_name", read_only=True, default=None)
    can_suspend = serializers.SerializerMethodField()
    commission_reversal = serializers.SerializerMethodField()

    class Meta:
        model = FraudFlag
        fields = [
            "id", "kind", "kind_label", "status", "source", "title", "detail", "evidence",
            "business_owner", "related_business_owner", "staff_subject", "raised_by_name", "created_at",
            "resolved_by_name", "resolved_at", "resolution_note", "can_suspend", "commission_reversal",
        ]

    def get_business_owner(self, obj):
        owner = obj.business_owner
        if owner is None:
            return None
        manager = owner.account_manager
        return {
            "id": owner.id,
            "display_name": owner.display_name,
            "account_manager_name": manager.full_name if manager is not None else None,
        }

    def get_related_business_owner(self, obj):
        owner = obj.related_business_owner
        return None if owner is None else {"id": owner.id, "display_name": owner.display_name}

    def get_staff_subject(self, obj):
        staff = obj.staff_subject
        return None if staff is None else {"id": staff.id, "full_name": staff.full_name}

    def get_can_suspend(self, obj):
        return services.can_suspend(obj)

    def get_commission_reversal(self, obj):
        """What confirming this open case would reverse (commission.services.
        reverse_for_flag): the business's lines not yet in a payout, or None."""
        if obj.status != FraudFlag.OPEN or obj.business_owner_id is None:
            return None
        from commission.models import CommissionAccrual
        from commission.services import REVERSING_KINDS

        if obj.kind not in REVERSING_KINDS:
            return None
        lines = list(CommissionAccrual.objects.filter(
            business_owner_id=obj.business_owner_id, status__in=[CommissionAccrual.ON_HOLD, CommissionAccrual.PAYABLE],
        ).select_related("staff"))
        if not lines:
            return None
        holds = [line.hold_until for line in lines if line.status == CommissionAccrual.ON_HOLD]
        return {
            "lines": len(lines), "amount": str(sum(line.amount for line in lines)),
            "staff": sorted({line.staff.full_name for line in lines}),
            "hold_until": max(holds) if holds else None,
        }


class FraudFlagCreateSerializer(serializers.Serializer):
    """A case raised by hand ("Raise a case")."""

    kind = serializers.ChoiceField(
        choices=[(key, label) for key, label in FraudFlag.KIND_CHOICES if key in FraudFlag.STAFF_RAISABLE],
        error_messages={"invalid_choice": "Choose fake business, duplicate or other."},
    )
    title = serializers.CharField(max_length=200)
    detail = serializers.CharField(allow_blank=True, default="")
    business_owner = serializers.PrimaryKeyRelatedField(
        queryset=BusinessOwner.objects.all(), allow_null=True, default=None,
    )

    def validate(self, attrs):
        if attrs["kind"] in (FraudFlag.FAKE_BUSINESS, FraudFlag.DUPLICATE) and attrs.get("business_owner") is None:
            raise serializers.ValidationError({"business_owner": "Choose the business this case is about."})
        return attrs
