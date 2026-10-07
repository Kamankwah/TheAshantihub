import datetime as dt

from django.utils import timezone
from rest_framework import serializers

from accounts.serializers import mask_but_last
from staff_tasks.services import create_task

from .models import CallLog, purposes_for

FUTURE_TOLERANCE = dt.timedelta(minutes=5)


class CallLogSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source="staff.full_name", read_only=True)

    class Meta:
        model = CallLog
        fields = [
            "id", "staff", "staff_name", "direction", "channel", "counterpart_type", "counterpart_id",
            "counterpart_name", "counterpart_phone", "related_type", "related_id", "related_label",
            "purpose", "outcome", "sentiment", "notes", "started_at", "duration_seconds",
            "follow_up_at", "follow_up_task", "created_at", "updated_at",
        ]
        read_only_fields = ["staff", "follow_up_task", "created_at", "updated_at"]

    def _viewer(self):
        return self.context["request"].user

    def validate_purpose(self, value):
        allowed = {code for code, _ in purposes_for(self._viewer().role.name)}
        if value not in allowed:
            raise serializers.ValidationError("That purpose isn't available for your role.")
        return value

    def validate_started_at(self, value):
        if value > timezone.now() + FUTURE_TOLERANCE:
            raise serializers.ValidationError("A call can't start in the future.")
        return value

    def validate_follow_up_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError("Pick a follow-up time in the future.")
        return value

    def create(self, validated_data):
        staff = self._viewer()
        call = CallLog.objects.create(staff=staff, **validated_data)
        if call.follow_up_at:
            label = call.counterpart_name or call.related_label or "call"
            call.follow_up_task = create_task(
                staff, f"Follow up: {label}", call.follow_up_at, source=call, created_by=staff
            )
            call.save(update_fields=["follow_up_task"])
        return call

    def to_representation(self, instance):
        data = super().to_representation(instance)
        viewer = self._viewer()
        sees_full = instance.staff_id == viewer.id or "calls.view_all" in viewer.effective_permission_codenames()
        if data["counterpart_phone"] and not sees_full:
            data["counterpart_phone"] = mask_but_last(data["counterpart_phone"], keep=3)
        return data
