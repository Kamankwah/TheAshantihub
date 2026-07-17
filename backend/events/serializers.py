from rest_framework import serializers

from listings.models import Category
from listings.serializers import CategorySerializer, ZoneSerializer

from .models import Event, EventMedia, EventPricingTier, EventRSVP, EventTicketType, Ticket


class EventMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventMedia
        fields = ["id", "media", "media_type", "order"]


class EventTeaserSerializer(serializers.ModelSerializer):
    """Safe subset returned for every event regardless of access_level, on
    both the list endpoint and the detail endpoint (when no/invalid code is
    supplied for a private event): name, category, hero media, event_date,
    zone/general-area. Deliberately excludes address/lat/lng/going_count/
    description/media-gallery/access_code — see EventDetailSerializer for
    the full set.
    """

    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    hero_media = serializers.SerializerMethodField()
    is_private = serializers.SerializerMethodField()
    # Same "annotated but not always present" safety pattern as
    # listings.serializers.PublicListingSerializer — populated by the
    # reviews-count/avg-rating queryset annotation on _live_events_queryset
    # (reviews/ratings/Q&A plan, docs/PROJECT_SCOPE.md).
    avg_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    # Ticketing (event ticketing + escrow work) — whether this event has any
    # active ticket type at all, so the frontend can decide whether to show
    # a "Buy Tickets" affordance on the teaser without a separate fetch.
    has_tickets = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id", "name", "category", "zone", "event_date", "hero_media", "is_private",
            "avg_rating", "review_count", "has_tickets",
        ]

    def get_avg_rating(self, obj):
        return getattr(obj, "avg_rating", None)

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0)

    def get_has_tickets(self, obj):
        return obj.ticket_types.filter(is_active=True).exists()

    def get_hero_media(self, obj):
        first = obj.media.all()[:1]
        first = list(first)
        if not first:
            return None
        request = self.context.get("request")
        url = first[0].media.url
        return request.build_absolute_uri(url) if request is not None else url

    def get_is_private(self, obj):
        return obj.access_level == Event.PRIVATE


class EventDetailSerializer(serializers.ModelSerializer):
    """Full public detail shape — returned immediately for access_level=public
    events, or for a private event once a valid ?code=/unlock code has been
    supplied. Adds address/lat/lng/going_count/description/full media
    gallery on top of the teaser fields. Does NOT include access_code (a
    caller who unlocked a private event already knows the code they
    supplied; the organizer's own access_code is only surfaced via
    EventOwnerSerializer on /api/events/mine/).
    """

    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    media = EventMediaSerializer(many=True, read_only=True)
    # Same "annotated but not always present" safety pattern as
    # EventTeaserSerializer above.
    avg_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    # Minimal public exposure of who organized this event — reasonable and
    # expected for a public event listing (comparable to any event platform
    # showing its host). Deliberately NOT on EventTeaserSerializer, which
    # keeps its existing safe-subset contract untouched.
    organizer = serializers.SerializerMethodField()
    # See EventTeaserSerializer.get_has_tickets — same field, also exposed
    # on the full detail shape.
    has_tickets = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id", "name", "description", "category", "zone", "address", "lat", "lng",
            "event_date", "going_count", "access_level", "media", "avg_rating",
            "review_count", "organizer", "has_tickets",
        ]

    def get_avg_rating(self, obj):
        return getattr(obj, "avg_rating", None)

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0)

    def get_has_tickets(self, obj):
        return obj.ticket_types.filter(is_active=True).exists()

    def get_organizer(self, obj):
        if obj.submitted_by_business_id:
            return {
                "kind": "business",
                "id": obj.submitted_by_business_id,
                "full_name": obj.submitted_by_business.full_name,
            }
        return {
            "kind": "customer",
            "id": obj.submitted_by_customer_id,
            "full_name": obj.submitted_by_customer.full_name,
        }


class EventOwnerSerializer(serializers.ModelSerializer):
    """The organizer's own view of their event (GET /api/events/mine/,
    POST /api/events/submit/'s response, POST /api/events/{id}/pay/'s
    response) — full detail plus access_code and lifecycle/status fields,
    regardless of access_level.
    """

    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    media = EventMediaSerializer(many=True, read_only=True)

    class Meta:
        model = Event
        fields = [
            "id", "name", "description", "category", "zone", "address", "lat", "lng",
            "event_date", "visibility_days", "status", "rejection_reason", "access_level",
            "access_code", "paid_at", "expires_at", "going_count", "media", "created_at",
        ]
        read_only_fields = fields


class EventModerationSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the approval queue/detail views — mirrors
    listings.serializers.ModerationListingSerializer's field selection.
    """

    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    media = EventMediaSerializer(many=True, read_only=True)
    submitted_by_customer_name = serializers.CharField(
        source="submitted_by_customer.full_name", read_only=True, default=None
    )
    submitted_by_business_name = serializers.CharField(
        source="submitted_by_business.full_name", read_only=True, default=None
    )
    reviewed_by_name = serializers.CharField(
        source="reviewed_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = Event
        fields = [
            "id", "name", "description", "category", "zone", "address", "lat", "lng",
            "event_date", "visibility_days", "status", "rejection_reason", "access_level",
            "access_code", "paid_at", "expires_at", "going_count", "media", "created_at",
            "submitted_by_customer", "submitted_by_customer_name",
            "submitted_by_business", "submitted_by_business_name",
            "approved_by", "reviewed_by_name", "reviewed_at",
        ]


class EventSubmitSerializer(serializers.ModelSerializer):
    """Input shape for POST /api/events/submit/. `submitted_by_customer`/
    `submitted_by_business` are set by the view from request.user, not
    accepted from the client. Category is validated here as event-kind at
    the application level (Category.kind has no DB constraint tying it to
    a given consumer).
    """

    class Meta:
        model = Event
        fields = [
            "category", "zone", "name", "description", "address", "lat", "lng",
            "event_date", "visibility_days", "access_level",
        ]
        extra_kwargs = {"access_level": {"required": False}}

    def validate_category(self, value):
        if value.kind != Category.EVENT:
            raise serializers.ValidationError("Category must be an event-kind category.")
        return value

    def validate_visibility_days(self, value):
        if not EventPricingTier.objects.filter(duration_days=value).exists():
            raise serializers.ValidationError(
                "visibility_days must match one of the configured pricing tiers."
            )
        return value


class EventEditSerializer(serializers.ModelSerializer):
    """Input shape for an organizer editing their event (business item 3 /
    Wave E). Only the content fields — NOT visibility_days (that's what renewal
    is for) or any lifecycle/payment field. The view resets status to pending
    for re-approval but keeps paid_at, so no re-payment is needed.
    """

    class Meta:
        model = Event
        fields = [
            "category", "zone", "name", "description", "address", "lat", "lng",
            "event_date", "access_level",
        ]
        extra_kwargs = {f: {"required": False} for f in fields}

    def validate_category(self, value):
        if value.kind != Category.EVENT:
            raise serializers.ValidationError("Category must be an event-kind category.")
        return value


class EventPricingTierPublicSerializer(serializers.ModelSerializer):
    """Public shape (GET /api/events/pricing-tiers/) — only the live price,
    never the pending one (an unapproved future price isn't public)."""

    class Meta:
        model = EventPricingTier
        fields = ["id", "duration_days", "live_price"]
        read_only_fields = fields


class EventPricingTierManageSerializer(serializers.ModelSerializer):
    """Staff shape (accountant/super_admin) — includes the pending proposal,
    if any."""

    proposed_by_name = serializers.CharField(
        source="proposed_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = EventPricingTier
        fields = [
            "id", "duration_days", "live_price", "pending_price",
            "proposed_by", "proposed_by_name", "proposed_at", "updated_at",
        ]
        read_only_fields = fields


class EventUnlockSerializer(serializers.Serializer):
    code = serializers.CharField()


class EventAttendeeSerializer(serializers.ModelSerializer):
    """Organizer/staff-facing shape for GET /api/events/{id}/rsvps/ (Phase 7).
    Surfaces the attendee's name + phone/email — reasonable contact info for
    an event organizer to reach a "going" attendee, without exposing
    anything beyond what `Customer` already models (no password_hash etc).
    """

    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    customer_email = serializers.EmailField(source="customer.email", read_only=True)

    class Meta:
        model = EventRSVP
        fields = [
            "id", "customer", "customer_name", "customer_phone", "customer_email",
            "status", "rsvp_at",
        ]


class EventTicketTypePublicSerializer(serializers.ModelSerializer):
    """Public shape for GET /api/events/{id}/ticket-types/ — what a buyer
    sees before purchasing. Deliberately excludes quantity_sold/is_active
    (organizer-only, see EventTicketTypeOwnerSerializer) in favour of a
    single derived quantity_remaining, mirroring how EventTeaserSerializer
    only ever exposes derived/safe fields.
    """

    quantity_remaining = serializers.SerializerMethodField()

    class Meta:
        model = EventTicketType
        fields = ["id", "name", "description", "price", "delivery_method", "quantity_remaining"]

    def get_quantity_remaining(self, obj):
        if obj.quantity_total is None:
            return None
        return max(0, obj.quantity_total - obj.quantity_sold)


class EventTicketTypeOwnerSerializer(EventTicketTypePublicSerializer):
    """Organizer's own view of a ticket type — adds the raw
    quantity_total/quantity_sold/is_active/created_at on top of the public
    fields.
    """

    class Meta(EventTicketTypePublicSerializer.Meta):
        fields = EventTicketTypePublicSerializer.Meta.fields + [
            "quantity_total", "quantity_sold", "is_active", "created_at",
        ]


class EventTicketTypeWriteSerializer(serializers.ModelSerializer):
    """Input shape for creating/editing an EventTicketType (organizer-only,
    see IsEventTicketTypeOwner).
    """

    class Meta:
        model = EventTicketType
        fields = ["name", "description", "price", "delivery_method", "quantity_total", "is_active"]

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("price must be greater than 0.")
        return value

    def validate(self, attrs):
        quantity_total = attrs.get(
            "quantity_total", getattr(self.instance, "quantity_total", None)
        )
        quantity_sold = getattr(self.instance, "quantity_sold", 0)
        if quantity_total is not None and quantity_total < quantity_sold:
            raise serializers.ValidationError(
                {"quantity_total": "quantity_total cannot be less than quantity_sold."}
            )
        return attrs


class TicketPurchaseInputSerializer(serializers.Serializer):
    """Input shape for POST /api/events/{id}/tickets/purchase/."""

    ticket_type = serializers.PrimaryKeyRelatedField(
        queryset=EventTicketType.objects.filter(is_active=True)
    )
    quantity = serializers.IntegerField(min_value=1, max_value=10)


class TicketSerializer(serializers.ModelSerializer):
    """A purchased Ticket, from the buyer's own point of view (purchase
    response, GET /api/events/tickets/mine/). ticket_type/event are
    hand-built dicts rather than nested ModelSerializers, mirroring
    EventDetailSerializer.get_organizer's exact style.
    """

    ticket_type = serializers.SerializerMethodField()
    event = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "id", "code", "price", "delivery_method", "escrow_status", "delivered_at",
            "refunded_at", "ticket_type", "event",
        ]

    def get_ticket_type(self, obj):
        return {"id": obj.ticket_type_id, "name": obj.ticket_type.name}

    def get_event(self, obj):
        event = obj.ticket_type.event
        return {"id": event.id, "name": event.name, "event_date": event.event_date}


class TicketCheckinListSerializer(serializers.ModelSerializer):
    """Organizer/staff-facing shape for GET /api/events/{id}/tickets/
    checkin-list/ and the response of POST .../checkin/ — mirrors
    EventAttendeeSerializer's exact field-sourcing style.
    """

    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)
    purchased_by_name = serializers.CharField(source="purchased_by.full_name", read_only=True)
    purchased_by_phone = serializers.CharField(source="purchased_by.phone", read_only=True)

    class Meta:
        model = Ticket
        fields = [
            "id", "code", "delivery_method", "delivered_at", "escrow_status",
            "ticket_type_name", "purchased_by_name", "purchased_by_phone",
        ]


class TicketEscrowLedgerSerializer(serializers.ModelSerializer):
    """Staff-facing (escrow.view/escrow.release/escrow.refund) shape for the
    escrow ledger and the release/hold/refund action responses.
    """

    event_name = serializers.CharField(source="ticket_type.event.name", read_only=True)
    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)
    purchased_by_name = serializers.CharField(source="purchased_by.full_name", read_only=True)
    released_by_staff_name = serializers.CharField(
        source="escrow_released_by_staff.full_name", read_only=True, default=None
    )
    refunded_by_staff_name = serializers.CharField(
        source="refunded_by_staff.full_name", read_only=True, default=None
    )

    class Meta:
        model = Ticket
        fields = [
            "id", "code", "price", "escrow_status", "escrow_held_at", "escrow_released_at",
            "escrow_override_note", "delivered_at", "refunded_at", "refund_reason",
            "event_name", "ticket_type_name", "purchased_by_name",
            "released_by_staff_name", "refunded_by_staff_name",
        ]
