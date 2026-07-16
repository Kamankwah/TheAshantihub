from rest_framework import serializers

from .models import Conversation, Message


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "conversation", "sender_type", "body", "created_at"]
        read_only_fields = fields


class ConversationSerializer(serializers.ModelSerializer):
    """Full-thread shape — used both by the caller's own conversation list/
    detail (customer or business owner) and by the staff detail view. Not
    used for the staff *list* view, which uses StaffConversationListSerializer
    below instead (metadata + a needs_reply indicator, not every message
    body, matching reviews.ReviewModerationSerializer's "the list view has
    its own shape" convention).
    """

    messages = MessageSerializer(many=True, read_only=True)
    starter_name = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id", "customer", "business_owner", "starter_name", "subject", "status",
            "messages", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_starter_name(self, obj):
        return obj.starter_display_name


class ConversationCreateSerializer(serializers.Serializer):
    """Input shape for POST /api/messaging/conversations/ — starts a new
    conversation with the caller's first message in one call (no separate
    "create empty conversation then post a message" round trip)."""

    subject = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    body = serializers.CharField()


class MessageCreateSerializer(serializers.Serializer):
    """Input shape for both the caller-side and staff-side reply endpoints."""

    body = serializers.CharField()


class StaffConversationListSerializer(serializers.ModelSerializer):
    """Staff queue shape (GET /api/messaging/staff/) — adds a needs_reply
    indicator (True when the conversation is still open and its latest
    message isn't from staff) so staff can triage the list without opening
    every thread, without a separate "unread" model field to keep in sync.
    """

    starter_name = serializers.SerializerMethodField()
    needs_reply = serializers.SerializerMethodField()
    last_message_at = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id", "customer", "business_owner", "starter_name", "subject", "status",
            "needs_reply", "last_message_at", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_starter_name(self, obj):
        return obj.starter_display_name

    def _last_message(self, obj):
        # Relies on the queryset having .prefetch_related("messages") so
        # obj.messages.all() doesn't hit the DB per row; Message.Meta.ordering
        # is ["created_at"] ascending, so the last element is the latest.
        msgs = list(obj.messages.all())
        return msgs[-1] if msgs else None

    def get_needs_reply(self, obj):
        last = self._last_message(obj)
        return bool(obj.status == Conversation.OPEN and last is not None and last.sender_type != Message.STAFF)

    def get_last_message_at(self, obj):
        last = self._last_message(obj)
        return last.created_at if last else obj.created_at
