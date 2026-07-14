from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction as db_transaction
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import filters, generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission
from billing.models import Transaction

from .models import Event
from .permissions import IsCustomerOrBusinessOwner, IsEventOwner
from .serializers import (
    EventDetailSerializer,
    EventMediaSerializer,
    EventModerationSerializer,
    EventOwnerSerializer,
    EventSubmitSerializer,
    EventTeaserSerializer,
    EventUnlockSerializer,
)


def _live_events_queryset():
    """Events currently visible to the public — approved, paid, and not yet
    past expires_at. See Event's class docstring for why "approved" alone
    isn't sufficient (payment is what starts the visibility window under
    this app's approve-then-pay sequencing).
    """
    now = timezone.now()
    return Event.objects.filter(status=Event.APPROVED, paid_at__isnull=False, expires_at__gt=now)


class EventPagination(PageNumberPagination):
    page_size = 20


class EventListView(generics.ListAPIView):
    """GET /api/events/ — public, unauthenticated. Always returns the safe
    teaser subset for every live event regardless of access_level (private
    events still appear in the grid, just without sensitive fields) — see
    EventTeaserSerializer. Supports `category` (slug) and `zone` (name)
    filters plus `search` (name/description), mirroring
    PublicListingListView's filter conventions.
    """

    serializer_class = EventTeaserSerializer
    permission_classes = [AllowAny]
    pagination_class = EventPagination
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "description"]

    def get_queryset(self):
        return _live_events_queryset().order_by("event_date")

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)

        category_slug = self.request.query_params.get("category")
        if category_slug:
            queryset = queryset.filter(category__slug=category_slug)

        zone_name = self.request.query_params.get("zone")
        if zone_name:
            queryset = queryset.filter(zone__name=zone_name)

        return queryset


class EventDetailView(APIView):
    """GET /api/events/{id}/ — 404s for anything not currently live (pending,
    rejected, expired, or approved-but-unpaid — see _live_events_queryset),
    same "don't leak non-public state via 404 vs 200" convention as
    PublicListingDetailView. For a live event: full detail immediately if
    access_level=public; for access_level=private, full detail only if
    `?code=` matches access_code, else the teaser subset (never a partial
    leak, never a 403 — a missing/wrong code on this endpoint just falls
    back to the same teaser the list endpoint already shows).
    """

    permission_classes = [AllowAny]

    def get(self, request, pk):
        event = generics.get_object_or_404(_live_events_queryset(), pk=pk)
        code = request.query_params.get("code")
        if event.access_level == Event.PUBLIC or (code and code == event.access_code):
            return Response(EventDetailSerializer(event, context={"request": request}).data)
        return Response(EventTeaserSerializer(event, context={"request": request}).data)


class EventUnlockView(APIView):
    """POST /api/events/{id}/unlock/ — body {"code": "..."}. Alternative to
    the ?code= query param on the detail endpoint. Returns full detail on a
    matching code (or for an already-public event), 403 on mismatch — unlike
    the detail endpoint, this one *is* meant to signal failure explicitly,
    since the caller is actively trying to unlock rather than just browsing.
    """

    permission_classes = [AllowAny]

    def post(self, request, pk):
        event = generics.get_object_or_404(_live_events_queryset(), pk=pk)
        serializer = EventUnlockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        code = serializer.validated_data["code"]

        if event.access_level == Event.PUBLIC or code == event.access_code:
            return Response(EventDetailSerializer(event, context={"request": request}).data)
        return Response({"detail": "Invalid access code."}, status=403)


class EventMineListView(generics.ListAPIView):
    """GET /api/events/mine/ — the caller's own submitted events (any
    status), full detail + access_code regardless of access_level, so an
    organizer always has something to share. Unlike HeroMineView, this
    returns a list (not a single most-recent row) since an event submitter
    isn't limited to one outstanding submission at a time.
    """

    serializer_class = EventOwnerSerializer
    permission_classes = [IsAuthenticated, IsCustomerOrBusinessOwner]
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        if isinstance(user, BusinessOwner):
            return Event.objects.filter(submitted_by_business=user)
        return Event.objects.filter(submitted_by_customer=user)


class EventSubmitView(APIView):
    """POST /api/events/submit/ — authenticated customer or business owner.
    Creates a `pending` Event with no charge (payment happens after approval
    — see Event's class docstring for the confirmed sequencing). Media is
    uploaded separately via POST /api/events/{id}/media/, mirroring
    ListingPhotoCreateView's separate-upload-step convention.
    """

    permission_classes = [IsAuthenticated, IsCustomerOrBusinessOwner]

    def post(self, request):
        serializer = EventSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        event = Event(**serializer.validated_data)
        user = request.user
        if isinstance(user, BusinessOwner):
            event.submitted_by_business = user
        else:
            event.submitted_by_customer = user

        try:
            event.full_clean(exclude=["access_code"])
        except DjangoValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}
            return Response(detail, status=400)

        event.save()
        return Response(
            EventOwnerSerializer(event, context={"request": request}).data, status=201
        )


class EventMediaCreateView(generics.CreateAPIView):
    """POST /api/events/{id}/media/ — the event's own submitter attaches a
    gallery item. Mirrors ListingPhotoCreateView's shape exactly.
    """

    serializer_class = EventMediaSerializer
    permission_classes = [IsAuthenticated, IsEventOwner]

    def get_event(self):
        event = generics.get_object_or_404(Event, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, event)
        return event

    def perform_create(self, serializer):
        serializer.save(event=self.get_event())


# Simulated per-day GHS pricing for an event's paid visibility window — no
# EventPricing model exists (mirrors PROMOTION_DAILY_RATES in
# listings/views.py, which is similarly a static in-file rate for a purchase
# with no dedicated pricing model).
EVENT_DAILY_RATE = Decimal("2.00")


class EventPayView(APIView):
    """POST /api/events/{id}/pay/ — the organizer pays for their *already
    approved* event's visibility window (see Event's class docstring: this
    is the step that sets paid_at and computes expires_at, per the
    approve-then-pay sequencing). Creates a billing.Transaction on the
    correct nullable side (business_owner or customer) depending on who
    submitted — mirrors ListingPromoteView/OrderCheckoutView's simulated-
    payment pattern.
    """

    permission_classes = [IsAuthenticated, IsEventOwner]

    def post(self, request, pk):
        event = generics.get_object_or_404(Event, pk=pk)
        self.check_object_permissions(request, event)

        if event.status != Event.APPROVED:
            return Response(
                {"detail": "Only an approved event can be paid for."}, status=400
            )
        if event.paid_at is not None:
            return Response(
                {"detail": "This event has already been paid for."}, status=400
            )

        now = timezone.now()
        amount = EVENT_DAILY_RATE * event.visibility_days

        with db_transaction.atomic():
            event.paid_at = now
            event.expires_at = now + timedelta(days=event.visibility_days)
            event.save(update_fields=["paid_at", "expires_at"])

            txn_kwargs = {
                "amount": amount,
                "purpose": f"Event visibility payment for '{event.name}' ({event.visibility_days} days)",
                "status": Transaction.SUCCESS,
                "reference": f"AH-EVENT-{event.id}-{get_random_string(8).upper()}",
            }
            if event.submitted_by_business_id:
                txn_kwargs["business_owner"] = event.submitted_by_business
            else:
                txn_kwargs["customer"] = event.submitted_by_customer
            Transaction.objects.create(**txn_kwargs)

        return Response(EventOwnerSerializer(event, context={"request": request}).data)


class EventPendingQueueView(generics.ListAPIView):
    """Clones ModerationPendingQueueView's shape for events."""

    serializer_class = EventModerationSerializer
    queryset = Event.objects.filter(status=Event.PENDING).order_by("created_at")

    def get_permissions(self):
        return [HasRolePermission("event.approve")]


class EventModerationDetailView(generics.RetrieveAPIView):
    queryset = Event.objects.all()
    serializer_class = EventModerationSerializer

    def get_permissions(self):
        return [HasRolePermission("event.approve")]


class EventApproveView(APIView):
    """POST /api/events/{id}/approve/ — sets status=approved and approved_by.
    Does not itself start the paid visibility window (see Event's class
    docstring) — expires_at is only computed here defensively, in case
    paid_at was somehow already set before approval (not this app's normal
    flow, which is submit -> approve -> pay).
    """

    def get_permissions(self):
        return [HasRolePermission("event.approve")]

    def post(self, request, pk):
        event = generics.get_object_or_404(Event, pk=pk)
        event.status = Event.APPROVED
        event.rejection_reason = None
        event.approved_by = request.user
        update_fields = ["status", "rejection_reason", "approved_by"]

        if event.paid_at is not None and event.expires_at is None:
            event.expires_at = event.paid_at + timedelta(days=event.visibility_days)
            update_fields.append("expires_at")

        event.save(update_fields=update_fields)
        return Response({"id": event.id, "status": event.status, "expires_at": event.expires_at})


class EventRejectView(APIView):
    def get_permissions(self):
        return [HasRolePermission("event.approve")]

    def post(self, request, pk):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "A rejection reason is required."}, status=400)
        event = generics.get_object_or_404(Event, pk=pk)
        event.status = Event.REJECTED
        event.rejection_reason = reason
        event.save(update_fields=["status", "rejection_reason"])
        return Response({"id": event.id, "status": event.status})
