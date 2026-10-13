from rest_framework import serializers

from .models import ActivityEvent


class ActivityEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityEvent
        fields = [
            "id", "occurred_at", "actor_type", "actor_id", "actor_role", "actor_label",
            "verb", "method", "target_type", "target_id", "target_label", "summary", "before", "after",
        ]


class ActivityEventDetailSerializer(ActivityEventSerializer):
    """For a holder of activity.view_all (Super Admin): the same line plus what
    proves it was not altered (its hash and the one before) and where it came from."""

    class Meta(ActivityEventSerializer.Meta):
        fields = ActivityEventSerializer.Meta.fields + ["on_behalf_of_id", "ip", "user_agent", "hash", "prev_hash"]
