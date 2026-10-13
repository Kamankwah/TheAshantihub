from rest_framework import serializers

from accounts.claims import mask_email
from accounts.phones import mask_phone

from .models import ContactMessage, ContactReply


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

    def _masked(self):
        request = self.context.get("request")
        role = getattr(getattr(request, "user", None), "role", None)
        return getattr(role, "name", "") == "support"

    def to_representation(self, obj):
        data = super().to_representation(obj)
        if self._masked():
            data["email"] = mask_email(obj.email)
            data["phone"] = mask_phone(obj.phone) if obj.phone else ""
        return data


class ContactReplySerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source="staff.full_name", read_only=True, default=None)

    class Meta:
        model = ContactReply
        fields = ["id", "staff_name", "body", "email_sent", "sent_at"]
        read_only_fields = fields


class ContactMessageStaffSerializer(ContactMessageSerializer):
    """The staff list adds the business the sender is matched to by email or
    phone (accounts.phones), so the message also shows in Support issues, the
    customer account it matches, and the email replies sent. For the Support
    role the sender's email and phone are masked: the reply goes out from the
    server, so the agent never needs the full address."""

    match = serializers.SerializerMethodField()
    account = serializers.SerializerMethodField()
    replies = ContactReplySerializer(many=True, read_only=True)
    has_email = serializers.SerializerMethodField()
    passed_to_operations_at = serializers.DateTimeField(read_only=True)
    passed_by_name = serializers.CharField(source="passed_by.full_name", read_only=True, default=None)

    class Meta(ContactMessageSerializer.Meta):
        fields = ContactMessageSerializer.Meta.fields + [
            "match", "account", "replies", "has_email", "passed_to_operations_at", "passed_by_name",
        ]
        read_only_fields = fields

    def get_has_email(self, obj):
        return bool(obj.email)

    def get_account(self, obj):
        """The customer account sharing the sender's email or phone, or None.
        Only the name and id: the profile screen shows the rest."""
        from accounts.models import Customer
        from accounts.phones import filter_by_phone

        customers = Customer.objects.all()
        found = customers.filter(email__iexact=obj.email.strip()).first() if obj.email else None
        if found is None and obj.phone:
            found = filter_by_phone(customers, "phone", obj.phone).first()
        if found is None:
            return None
        return {
            "customer_id": found.pk, "name": found.full_name,
            "email": mask_email(found.email) if found.email else "",
            "phone": mask_phone(found.phone) if found.phone else "",
        }

    def get_match(self, obj):
        from operations.service_issues import match_owner

        owner = match_owner(obj.email, obj.phone)
        if owner is None:
            return None
        manager = owner.account_manager
        return {
            "business_id": owner.pk, "business": owner.display_name,
            "account_manager": manager.full_name if manager else None,
            "kyc_status": owner.kyc_status,
        }


class ContactReplyInputSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=5000)
