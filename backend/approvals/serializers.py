from rest_framework import serializers

from accounts.serializers import staff_brief

from . import rules, services
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
    maker_team = serializers.SerializerMethodField()
    escalated = serializers.SerializerMethodField()
    next_move = serializers.SerializerMethodField()
    requires_sudo = serializers.SerializerMethodField()
    signoff = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            "id", "amount", "requires_sudo", "required_approvals", "signoff", "kind", "kind_label", "title", "status", "stage", "maker", "assigned_to", "pool_permission",
            "target", "maker_note", "decided_by", "decided_at", "decision_note", "due_at", "escalation_level",
            "created_at", "can_decide", "can_cancel", "maker_team", "escalated", "next_move",
        ]

    def get_requires_sudo(self, obj):
        kind = get_kind(obj.kind)
        return bool(kind is not None and kind.requires_sudo)

    def get_signoff(self, obj):
        """Who has signed and what is still missing, for the "Who signs off" card."""
        return {
            "required": obj.required_approvals,
            "waiting_on": services.waiting_on(obj),
            "signed": [
                {"slot": d.slot, "staff": staff_brief(d.staff), "at": d.decided_at, "note": d.note}
                for d in services._decisions(obj)
            ],
            # Only meaningful on a request that needs a co-signer.
            "cosigner_named": rules.cosigner_named() if obj.required_approvals > 1 else None,
        }

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


    def get_maker_team(self, obj):
        """Whose team the maker is on, from the viewer's side: "mine" when the viewer is their manager."""
        manager = obj.maker.manager
        return {"mine": manager is not None and manager.pk == self.context["request"].user.pk,
                "manager": manager.full_name if manager is not None else None}

    def get_escalated(self, obj):
        return obj.status == ApprovalRequest.PENDING and obj.escalation_level > 0

    def get_next_move(self, obj):
        return services.next_move(obj)


class ApprovalDetailSerializer(ApprovalSerializer):
    diff = serializers.SerializerMethodField()
    stale = serializers.SerializerMethodField()
    timeline = serializers.SerializerMethodField()
    consequences = serializers.SerializerMethodField()

    class Meta(ApprovalSerializer.Meta):
        fields = ApprovalSerializer.Meta.fields + ["payload", "before", "diff", "stale", "timeline", "consequences"]

    def to_representation(self, obj):
        data = super().to_representation(obj)
        kind = get_kind(obj.kind)
        if kind is not None and kind.public_payload is not None:
            data["payload"] = services.logged_payload(kind, obj)
        return data

    def get_timeline(self, obj):
        return services.timeline(obj)

    def get_consequences(self, obj):
        kind = get_kind(obj.kind)
        if kind is None or kind.consequences is None or obj.status != ApprovalRequest.PENDING:
            return []
        return kind.consequences(obj)

    def get_diff(self, obj):
        return services.diff_rows(obj)

    def get_stale(self, obj):
        return obj.status == ApprovalRequest.PENDING and services.is_stale(obj)
