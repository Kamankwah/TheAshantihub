from rest_framework import serializers

from .models import ContactMessage


class ContactMessageSubmitSerializer(serializers.Serializer):
    """Input shape for POST /api/core/contact/ — shape validation only, not
    business rules (there are none here beyond "is this a valid category").
    The view does `ContactMessage.objects.create(**validated_data)` directly,
    same convention as ReviewSubmitSerializer.
    """

    category = serializers.ChoiceField(choices=ContactMessage.CATEGORY_CHOICES)
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    subject = serializers.CharField(max_length=200)
    message = serializers.CharField()

    def validate(self, data):
        data["phone"] = data.get("phone", "")
        return data


class ContactMessageSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the moderation/triage list — everything on the
    model, plus resolved_by_name so staff can see who resolved it without a
    second lookup (mirrors ReviewModerationSerializer's hidden_by_name).
    """

    resolved_by_name = serializers.CharField(
        source="resolved_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = ContactMessage
        fields = [
            "id", "category", "name", "email", "phone", "subject", "message",
            "status", "resolved_by", "resolved_by_name", "resolved_at", "created_at",
        ]
        read_only_fields = fields
