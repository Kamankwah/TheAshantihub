from rest_framework import serializers

from listings.models import Category
from listings.serializers import CategorySerializer, ZoneSerializer

from .models import Event, EventMedia, EventRSVP


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

    class Meta:
        model = Event
        fields = [
            "id", "name", "category", "zone", "event_date", "hero_media", "is_private",
            "avg_rating", "review_count",
        ]

    def get_avg_rating(self, obj):
        return getattr(obj, "avg_rating", None)

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0)

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

    class Meta:
        model = Event
        fields = [
            "id", "name", "description", "category", "zone", "address", "lat", "lng",
            "event_date", "going_count", "access_level", "media", "avg_rating",
            "review_count", "organizer",
        ]

    def get_avg_rating(self, obj):
        return getattr(obj, "avg_rating", None)

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0)

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

    class Meta:
        model = Event
        fields = [
            "id", "name", "description", "category", "zone", "address", "lat", "lng",
            "event_date", "visibility_days", "status", "rejection_reason", "access_level",
            "access_code", "paid_at", "expires_at", "going_count", "media", "created_at",
            "submitted_by_customer", "submitted_by_customer_name",
            "submitted_by_business", "submitted_by_business_name",
            "approved_by",
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
        if not (7 <= value <= 90):
            raise serializers.ValidationError("visibility_days must be between 7 and 90.")
        return value


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
