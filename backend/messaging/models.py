import datetime

from django.db import models

from accounts.models import BusinessOwner, Customer, StaffUser


class Conversation(models.Model):
    """A staff support ticket thread — a signed-in Customer or BusinessOwner
    messaging AshantiHub support, and staff replying. This is NEVER a
    business-owner-to-customer direct-contact channel — see CLAUDE.md's
    "Businesses cannot be contacted directly" section, a hard fraud-
    prevention boundary already established elsewhere in this codebase. Both
    a Customer and a BusinessOwner reach staff through this exact same
    model/API; nothing here lets either party see or message the other.

    Exactly one of `customer`/`business_owner` is set per row — same
    "exactly one of two nullable FKs" shape as billing.Transaction's
    business_owner/customer pair, enforced by the CheckConstraint below.
    """

    OPEN = "open"
    CLOSED = "closed"
    STATUS_CHOICES = [(OPEN, "Open"), (CLOSED, "Closed")]

    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, null=True, blank=True, related_name="conversations"
    )
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, null=True, blank=True, related_name="conversations"
    )
    # Anonymous guest support chat: a browser-generated random token
    # (persisted in localStorage) stands in for an account. Exactly one of
    # customer/business_owner/guest_token is set per row — the constraint
    # below. NULL (never "") when unused so the exactly-one check stays a
    # clean isnull test.
    guest_token = models.CharField(max_length=64, null=True, blank=True, db_index=True)
    subject = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OPEN)

    # --- Support desk fields (the Support dashboard). All optional: a thread
    # started before the desk existed simply sits unassigned. ---
    HIGH, MEDIUM, LOW = "high", "medium", "low"
    PRIORITY_CHOICES = [(HIGH, "High"), (MEDIUM, "Medium"), (LOW, "Low")]
    # Where the thread was started (shown as "Started from the listing page").
    SOURCE_CHOICES = [
        ("app", "The app"), ("listing_page", "A listing page"), ("order_page", "An order page"),
        ("business_dashboard", "The business dashboard"), ("guest_chat", "Guest chat"),
        ("staff_started", "Started by Support"), ("chatbot", "Chat assistant"),
    ]
    assignee = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_conversations"
    )
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default=MEDIUM)
    # What the conversation is ABOUT. The thread is always with AshantiHub
    # Support, never with the business: these are context links for staff only.
    about_business = models.ForeignKey(
        BusinessOwner, on_delete=models.SET_NULL, null=True, blank=True, related_name="support_conversations_about"
    )
    about_listing = models.ForeignKey(
        "listings.Listing", on_delete=models.SET_NULL, null=True, blank=True, related_name="support_conversations"
    )
    about_order = models.ForeignKey(
        "orders.Order", on_delete=models.SET_NULL, null=True, blank=True, related_name="support_conversations"
    )
    previous_conversation = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="follow_ups"
    )
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="app")
    # The chat assistant's intake: who the visitor says they are, so Support can call, text or email back.
    # Staff-only; empty for every other source. Never serialized to a customer, owner or guest.
    contact_name = models.CharField(max_length=120, blank=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=30, blank=True)
    tags = models.ManyToManyField("ConversationTag", blank=True, related_name="conversations")
    snoozed_until = models.DateTimeField(null=True, blank=True)
    snoozed_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="resolved_conversations"
    )
    resolution_code = models.CharField(max_length=20, blank=True)
    resolution_note = models.CharField(max_length=300, blank=True)
    first_reply_at = models.DateTimeField(null=True, blank=True)
    # Why round-robin left it unassigned ("Everyone on shift is at their limit").
    unassigned_reason = models.CharField(max_length=200, blank=True)
    # Clock targets, stored so the breach queries are indexed (set on create /
    # priority change from SupportSettings; see messaging.services).
    first_reply_due = models.DateTimeField(null=True, blank=True, db_index=True)
    resolve_due = models.DateTimeField(null=True, blank=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    # Bumped (a plain re-save, not update_fields-limited) on every new
    # Message so the staff queue can order by "most recently active" —
    # see messaging.views.
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(customer__isnull=False, business_owner__isnull=True, guest_token__isnull=True)
                    | models.Q(customer__isnull=True, business_owner__isnull=False, guest_token__isnull=True)
                    | models.Q(customer__isnull=True, business_owner__isnull=True, guest_token__isnull=False)
                ),
                name="conversation_exactly_one_starter",
            ),
        ]

    @property
    def starter_display_name(self):
        if self.customer_id:
            return self.customer.full_name
        if self.business_owner_id:
            return self.business_owner.full_name
        return "Guest"

    def __str__(self):
        return f"Conversation with {self.starter_display_name} ({self.status})"


class Message(models.Model):
    CUSTOMER = "customer"
    BUSINESS_OWNER = "business_owner"
    STAFF = "staff"
    GUEST = "guest"
    SENDER_TYPE_CHOICES = [
        (CUSTOMER, "Customer"),
        (BUSINESS_OWNER, "Business Owner"),
        (STAFF, "Staff"),
        (GUEST, "Guest"),
    ]

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender_type = models.CharField(max_length=15, choices=SENDER_TYPE_CHOICES)
    body = models.TextField()
    # The staff member who wrote a staff message or note (null for the
    # customer/owner/guest side and for old rows).
    author = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # An internal note (or a timeline event) is visible to staff ONLY. Every
    # customer/owner/guest serializer must exclude anything that is not a plain
    # message (messaging.serializers.is_public_message; contract-tested).
    MESSAGE, NOTE, EVENT = "message", "note", "event"
    KIND_CHOICES = [(MESSAGE, "Message"), (NOTE, "Internal note"), (EVENT, "Timeline event")]
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=MESSAGE)
    is_internal = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    @property
    def is_public(self):
        return self.kind == self.MESSAGE and not self.is_internal

    def save(self, *args, **kwargs):
        # A note or event can never be a public message, whatever the caller set.
        if self.kind != self.MESSAGE:
            self.is_internal = True
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.sender_type} message in conversation {self.conversation_id}"


class ConversationTag(models.Model):
    """A label on a conversation ("late-rider"). Names are lower-case with dashes."""

    name = models.SlugField(max_length=40, unique=True)
    description = models.CharField(max_length=200, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CannedReply(models.Model):
    """A saved reply a Support agent can drop into a thread. The body may hold
    {placeholders}; a preview fills them from real records and marks any it
    cannot resolve (nothing is guessed). A reply never carries a phone number
    or a WhatsApp link (validated where it is saved)."""

    ANYONE, CUSTOMERS, OWNERS = "anyone", "customers", "owners"
    AUDIENCE_CHOICES = [(ANYONE, "Anyone"), (CUSTOMERS, "Customers"), (OWNERS, "Business owners")]

    title = models.CharField(max_length=80)
    shortcut = models.CharField(max_length=30, unique=True)  # "/late"
    body = models.TextField()
    audience = models.CharField(max_length=10, choices=AUDIENCE_CHOICES, default=ANYONE)
    uses = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_by = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    retired_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.shortcut


class SupportSettings(models.Model):
    """The one row of Support desk rules, edited by Operations (support.limits):
    time limits per priority, business hours, capacity and round-robin. The
    default values are the owner's recommended starting point."""

    first_reply_minutes = models.JSONField(default=dict)  # {"high": 15, "medium": 30, "low": 120}
    resolve_minutes = models.JSONField(default=dict)  # {"high": 480, "medium": 720, "low": 1440}
    open_days = models.JSONField(default=list)  # weekday numbers, Monday = 0
    opens_at = models.TimeField(default=datetime.time(8, 0))
    closes_at = models.TimeField(default=datetime.time(20, 0))
    capacity_per_agent = models.PositiveIntegerField(default=6)
    round_robin = models.BooleanField(default=True)
    updated_by = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    DEFAULT_FIRST_REPLY = {"high": 15, "medium": 30, "low": 120}
    DEFAULT_RESOLVE = {"high": 480, "medium": 720, "low": 1440}
    DEFAULT_DAYS = [0, 1, 2, 3, 4, 5]

    @classmethod
    def load(cls):
        row, _ = cls.objects.get_or_create(
            pk=1,
            defaults={
                "first_reply_minutes": cls.DEFAULT_FIRST_REPLY,
                "resolve_minutes": cls.DEFAULT_RESOLVE,
                "open_days": cls.DEFAULT_DAYS,
            },
        )
        return row

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)


class SupportAgentState(models.Model):
    """Whether an agent is taking new conversations. "On shift" for round-robin
    is: signed in, not Away, not on leave or holiday. There is no roster."""

    staff = models.OneToOneField(StaffUser, on_delete=models.CASCADE, related_name="support_state")
    away = models.BooleanField(default=False)
    away_until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
