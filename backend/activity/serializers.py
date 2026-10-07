from rest_framework import serializers

from .models import ActivityEvent


class ActivityEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityEvent
        fields = [
            "id", "occurred_at", "actor_type", "actor_id", "actor_role", "actor_label",
            "verb", "method", "target_type", "target_id", "target_label", "summary", "before", "after",
        ]
