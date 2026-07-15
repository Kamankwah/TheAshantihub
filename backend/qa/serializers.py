from rest_framework import serializers

from .models import Question


class QuestionSerializer(serializers.ModelSerializer):
    """Public read shape for GET /api/qa/questions/listing/<pk>/,
    /event/<pk>/.
    """

    asked_by_name = serializers.CharField(source="asked_by.full_name", read_only=True)

    class Meta:
        model = Question
        fields = [
            "id", "target_type", "asked_by_name", "question_text",
            "answer_text", "answered_at", "created_at",
        ]
        read_only_fields = fields


class QuestionAskSerializer(serializers.Serializer):
    """Input shape for POST /api/qa/questions/ — shape validation only.
    Target existence is resolved/404d in the view.
    """

    target_type = serializers.ChoiceField(choices=Question.TARGET_TYPE_CHOICES)
    target_id = serializers.IntegerField()
    question_text = serializers.CharField()


class QuestionAnswerSerializer(serializers.Serializer):
    """Input shape for POST /api/qa/questions/{id}/answer/ — a non-empty
    answer_text is required, mirroring ModerationRejectView's reason
    requirement.
    """

    answer_text = serializers.CharField()

    def validate_answer_text(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("answer_text is required.")
        return value
