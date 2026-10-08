from rest_framework import serializers

from accounts.serializers import staff_brief

from . import services
from .models import ApprovalRequest
from .registry import get_kind


class ApprovalSerializer(serializers.ModelSerializer):
    kind_label = serializers.SerializerMethodField()
    maker = serializers.SerializerMethodField()
    assigned_to = serializers.SerializerMethodField()
    decided_by = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()
    can_decide = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            "id", "kind", "kind_label", "title", "status", "stage", "maker", "assigned_to", "pool_permission",
            "target", "maker_note", "decided_by", "decided_at", "decision_note", "due_at", "escalation_level",
            "created_at", "can_decide", "can_cancel",
        ]

    def get_kind_label(self, obj):
        kind = get_kind(obj.kind)
        return kind.label if kind is not None else obj.kind

    def get_maker(self, obj):
        return staff_brief(obj.maker)

    def get_assigned_to(self, obj):
        return staff_brief(obj.assigned_to)

    def get_decided_by(self, obj):
        return staff_brief(obj.decided_by)

    def get_target(self, obj):
        return {"type": obj.target_type, "id": obj.target_id, "label": obj.target_label}

    def get_can_decide(self, obj):
        return services.can_decide(obj, self.context["request"].user)

    def get_can_cancel(self, obj):
        return obj.status == ApprovalRequest.PENDING and obj.maker_id == self.context["request"].user.pk


class ApprovalDetailSerializer(ApprovalSerializer):
    diff = serializers.SerializerMethodField()
    stale = serializers.SerializerMethodField()

    class Meta(ApprovalSerializer.Meta):
        fields = ApprovalSerializer.Meta.fields + ["payload", "before", "diff", "stale"]

    def get_diff(self, obj):
        return services.diff_rows(obj)

    def get_stale(self, obj):
        return obj.status == ApprovalRequest.PENDING and services.is_stale(obj)
