from rest_framework import serializers

from .models import Task


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["id", "title", "notes", "due_at", "status", "done_at", "source_type", "source_id", "created_at"]
        read_only_fields = ["status", "done_at", "source_type", "source_id", "created_at"]
