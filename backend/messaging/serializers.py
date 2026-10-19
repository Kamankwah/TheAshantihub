from rest_framework import serializers

from accounts.phones import normalize_gh_phone

from .models import Conversation, Message


def is_public_message(message):
    """True only for a plain message the customer/owner/guest may read. Internal
    notes and timeline events are staff-only: EVERY non-staff serializer goes
    through this filter (the note-leak contract; see tests/test_note_leak.py)."""
    return message.kind == Message.MESSAGE and not message.is_internal


def contact_of(conversation):
    """The chat-assistant visitor's contact details, or None. Staff payloads only."""
    if not (conversation.contact_email or conversation.contact_phone or conversation.contact_name):
        return None
    return {"name": conversation.contact_name, "email": conversation.contact_email, "phone": conversation.contact_phone}


class MessageSerializer(serializers.ModelSerializer):
    """The customer/owner/guest shape of a message: no author, no note flag."""

    class Meta:
        model = Message
        fields = ["id", "conversation", "sender_type", "body", "created_at"]
        read_only_fields = fields


class StaffMessageSerializer(serializers.ModelSerializer):
    """Staff-only shape: adds the kind (message / note / event) and the author.
    Never used on a customer, owner or guest endpoint."""

    author_name = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "conversation", "sender_type", "kind", "is_internal", "body", "author", "author_name", "created_at"]
        read_only_fields = fields

    def get_author_name(self, obj):
        return obj.author.full_name if obj.author_id else ""


class ConversationSerializer(serializers.ModelSerializer):
    """Full-thread shape — used both by the caller's own conversation list/
    detail (customer or business owner) and by the staff detail view. Not
    used for the staff *list* view, which uses StaffConversationListSerializer
    below instead (metadata + a needs_reply indicator, not every message
    body, matching reviews.ReviewModerationSerializer's "the list view has
    its own shape" convention).
    """

    messages = serializers.SerializerMethodField()
    starter_name = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id", "customer", "business_owner", "starter_name", "subject", "status",
            "messages", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_messages(self, obj):
        # Plain messages only: an internal note or timeline event never leaves
        # the server through this (customer / owner / guest) serializer.
        return MessageSerializer([m for m in obj.messages.all() if is_public_message(m)], many=True).data

    def get_starter_name(self, obj):
        return obj.starter_display_name


class StaffConversationDetailSerializer(ConversationSerializer):
    """Staff thread: every message, internal notes and timeline events included.
    Subclasses the customer shape only to share its metadata fields; `messages`
    is overridden, so this must never be used on a non-staff endpoint."""

    contact = serializers.SerializerMethodField()

    class Meta(ConversationSerializer.Meta):
        fields = ConversationSerializer.Meta.fields + ["contact"]
        read_only_fields = fields

    def get_contact(self, obj):
        return contact_of(obj)

    def get_messages(self, obj):
        return StaffMessageSerializer(obj.messages.all(), many=True).data


class ConversationCreateSerializer(serializers.Serializer):
    """Input shape for POST /api/messaging/conversations/ — starts a new
    conversation with the caller's first message in one call (no separate
    "create empty conversation then post a message" round trip)."""

    subject = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    body = serializers.CharField()
    # Optional context from the surface that knows it (listing page, order page,
    # business dashboard help). Ids only; a bad id is ignored, never an error,
    # because the conversation matters more than its label.
    about_business = serializers.IntegerField(required=False, allow_null=True)
    about_listing = serializers.IntegerField(required=False, allow_null=True)
    about_order = serializers.IntegerField(required=False, allow_null=True)
    source = serializers.ChoiceField(
        choices=["app", "listing_page", "order_page", "business_dashboard", "guest_chat", "chatbot"],
        required=False, default="app",
    )
    # Chat assistant intake (source == "chatbot"): all three required then, ignored for any other source.
    contact_name = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    contact_email = serializers.EmailField(required=False, allow_blank=True, default="")
    contact_phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["source"] != "chatbot":
            attrs["contact_name"] = attrs["contact_email"] = attrs["contact_phone"] = ""
            return attrs
        attrs["contact_name"] = attrs["contact_name"].strip()
        attrs["contact_email"] = attrs["contact_email"].strip()
        errors = {f: ["This field is required."] for f in ("contact_name", "contact_email", "contact_phone") if not attrs[f].strip()}
        if errors:
            raise serializers.ValidationError(errors)
        try:
            attrs["contact_phone"] = normalize_gh_phone(attrs["contact_phone"])
        except ValueError as error:
            raise serializers.ValidationError({"contact_phone": [str(error)]})
        return attrs


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
        # Notes and timeline events do not count as the customer's last word.
        msgs = [m for m in obj.messages.all() if is_public_message(m)]
        return msgs[-1] if msgs else None

    def get_needs_reply(self, obj):
        last = self._last_message(obj)
        return bool(obj.status == Conversation.OPEN and last is not None and last.sender_type != Message.STAFF)

    def get_last_message_at(self, obj):
        last = self._last_message(obj)
        return last.created_at if last else obj.created_at
