from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction as db_transaction
from django.db.models import Avg, Count, Q, Sum
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import filters, generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission, RequiresSudo
from accounts.views import IsCustomer
from billing.models import Transaction
from listings.visibility import hidden_business_q
from notifications.services import (
    notify_business_owner,
    notify_customer,
    notify_staff_role,
)
from ledger import posting, sales
from ledger.models import BookingSale
from ledger.money import from_pesewas
from payments import booking_pay
from storefront.permissions import MarketplaceOpen
from payments.models import CheckoutSession
from payments.services import process_payment

from . import scan_notice
from .models import Event, EventPricingTier, EventRSVP, EventTicketType, Ticket
from .permissions import (
    IsCustomerOrBusinessOwner,
    IsEventOwner,
    IsEventOwnerOrCanApproveEvents,
    IsEventTicketTypeOwner,
)
from .serializers import (
    EventAttendeeSerializer,
    StaffEventAttendeeSerializer,
    EventDetailSerializer,
    EventEditSerializer,
    EventMediaSerializer,
    EventModerationSerializer,
    EventOwnerSerializer,
    EventPricingTierManageSerializer,
    EventPricingTierPublicSerializer,
    EventSubmitSerializer,
    EventTeaserSerializer,
    EventTicketTypeOwnerSerializer,
    EventTicketTypePublicSerializer,
    EventTicketTypeWriteSerializer,
    EventUnlockSerializer,
    StaffTicketCheckinListSerializer,
    TicketCheckinListSerializer,
    TicketEscrowLedgerSerializer,
    TicketPurchaseInputSerializer,
    TicketSerializer,
)


def _live_events_queryset():
    """Events currently visible to the public — approved, paid, and not yet
    past expires_at. See Event's class docstring for why "approved" alone
    isn't sufficient (payment is what starts the visibility window under
    this app's approve-then-pay sequencing).

    This is the single shared queryset backing EventListView (teaser),
    EventDetailView, and EventUnlockView (detail/teaser) — annotated here
    once with avg_rating/review_count (reviews/ratings/Q&A plan,
    docs/PROJECT_SCOPE.md) rather than per-caller, sourced from published
    Review rows. `distinct=True` on the Count guards against inflation from
    any other join — this queryset's own filters don't join anything, but
    EventListView additionally filters on category__slug/zone__name
    (FK lookups, not row-multiplying) and a name/description SearchFilter,
    so kept as a defensive measure regardless.
    """
    now = timezone.now()
    return Event.objects.filter(
        status=Event.APPROVED, paid_at__isnull=False, expires_at__gt=now
    ).exclude(
        # Suspended organizers' events, and the events of a business paused by
        # the subscription clock, drop out of public browse
        # (listings.visibility). Reversed automatically on unsuspend or
        # payment since it's a query-time filter, not a stored flag.
        hidden_business_q("submitted_by_business__")
        | Q(submitted_by_customer__is_suspended=True)
    ).annotate(
        avg_rating=Avg("reviews__rating", filter=Q(reviews__status="published")),
        review_count=Count("reviews", filter=Q(reviews__status="published"), distinct=True),
    )


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

    # An organizer (customer or business) may have at most this many events
    # outstanding (pending or live) at once; beyond that they must contact
    # staff to feature more.
    MAX_OUTSTANDING_EVENTS = 3

    def post(self, request):
        serializer = EventSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        event = Event(**serializer.validated_data)
        user = request.user
        if isinstance(user, BusinessOwner):
            event.submitted_by_business = user
        else:
            event.submitted_by_customer = user

        # Cap outstanding events per organizer. "Outstanding" = still pending, or
        # approved and not yet expired (rejected/expired ones don't count).
        now = timezone.now()
        if isinstance(user, BusinessOwner):
            owned = Event.objects.filter(submitted_by_business=user)
        else:
            owned = Event.objects.filter(submitted_by_customer=user)
        outstanding = owned.filter(
            Q(status=Event.PENDING)
            | Q(status=Event.APPROVED) & (Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        ).count()
        if outstanding >= self.MAX_OUTSTANDING_EVENTS:
            return Response(
                {
                    "detail": (
                        f"You can have at most {self.MAX_OUTSTANDING_EVENTS} events at a time. "
                        "Please contact AshantiHub staff if you'd like to feature more."
                    )
                },
                status=400,
            )

        try:
            event.full_clean(exclude=["access_code"])
        except DjangoValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}
            return Response(detail, status=400)

        event.save()
        notify_staff_role(
            "event.approve", "event_needs_approval", "New event submission",
            body=f"“{event.name}” has been submitted and needs review.",
            link="events-moderation", icon="🎉",
        )
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


# Fallback only for an Event whose visibility_days predates the
# EventPricingTier table (or otherwise doesn't match any configured tier) —
# so an already-approved-but-unpaid legacy event never becomes unpayable.
# Every new submission is validated against EventPricingTier at submit time
# (see EventSubmitSerializer.validate_visibility_days), so this path should
# not be hit for events created after this feature shipped.
_LEGACY_DAILY_RATE = Decimal("2.00")


class EventPricingTierListView(generics.ListAPIView):
    """GET /api/events/pricing-tiers/ — public, powers the visibility_days
    dropdown on the submission form."""

    serializer_class = EventPricingTierPublicSerializer
    permission_classes = [AllowAny]
    pagination_class = None
    queryset = EventPricingTier.objects.all()


class EventPricingTierManageListView(generics.ListAPIView):
    """GET /api/events/pricing-tiers/manage/ — staff view including any
    pending proposal. Viewable by whoever can propose OR approve a change."""

    serializer_class = EventPricingTierManageSerializer
    pagination_class = None
    queryset = EventPricingTier.objects.all()

    def get_permissions(self):
        return [HasAnyRolePermission("event_pricing.manage", "event_pricing.approve")]


class EventPricingTierProposeView(APIView):
    """POST /api/events/pricing-tiers/{id}/propose/ — body {"price": "25.00"}.
    Accountant-only. Does not change the live price — see
    EventPricingTierApproveView/RejectView for what commits or discards it.
    """

    def get_permissions(self):
        return [HasRolePermission("event_pricing.manage")]

    def post(self, request, pk):
        tier = generics.get_object_or_404(EventPricingTier, pk=pk)
        try:
            price = Decimal(str(request.data.get("price")))
            if price <= 0:
                raise ValueError
        except (TypeError, ValueError, ArithmeticError):
            return Response({"price": "A positive price is required."}, status=400)

        tier.pending_price = price
        tier.proposed_by = request.user
        tier.proposed_at = timezone.now()
        tier.save(update_fields=["pending_price", "proposed_by", "proposed_at"])
        return Response(EventPricingTierManageSerializer(tier).data)


class EventPricingTierApproveView(APIView):
    """POST /api/events/pricing-tiers/{id}/approve/ — super_admin-only.
    Commits pending_price -> live_price and clears the pending fields."""

    def get_permissions(self):
        return [HasRolePermission("event_pricing.approve")]

    def post(self, request, pk):
        tier = generics.get_object_or_404(EventPricingTier, pk=pk)
        if tier.pending_price is None:
            return Response({"detail": "This tier has no pending proposal."}, status=400)

        tier.live_price = tier.pending_price
        tier.pending_price = None
        tier.proposed_by = None
        tier.proposed_at = None
        tier.save(update_fields=["live_price", "pending_price", "proposed_by", "proposed_at"])
        return Response(EventPricingTierManageSerializer(tier).data)


class EventPricingTierRejectView(APIView):
    """POST /api/events/pricing-tiers/{id}/reject/ — super_admin-only.
    Clears the pending proposal without changing the live price."""

    def get_permissions(self):
        return [HasRolePermission("event_pricing.approve")]

    def post(self, request, pk):
        tier = generics.get_object_or_404(EventPricingTier, pk=pk)
        if tier.pending_price is None:
            return Response({"detail": "This tier has no pending proposal."}, status=400)

        tier.pending_price = None
        tier.proposed_by = None
        tier.proposed_at = None
        tier.save(update_fields=["pending_price", "proposed_by", "proposed_at"])
        return Response(EventPricingTierManageSerializer(tier).data)


class EventOwnerUpdateView(generics.UpdateAPIView):
    """PATCH /api/events/mine/{id}/ — the organizer edits their event's content
    (business item 3 / Wave E). Editing sends it back to `pending` for
    re-approval but KEEPS paid_at/expires_at, so no re-payment is needed — a
    re-approved edit simply goes live again on the same paid window. Images are
    edited separately via POST /api/events/{id}/media/ (already IsEventOwner).
    visibility_days isn't editable here (that's renewal's job).
    """

    queryset = Event.objects.all()
    serializer_class = EventEditSerializer
    permission_classes = [IsAuthenticated, IsEventOwner]
    http_method_names = ["patch"]

    def perform_update(self, serializer):
        event = serializer.save()
        # Any edit re-enters moderation. A rejected event being fixed, or a
        # live one being changed, both go back to pending.
        if event.status != Event.PENDING:
            event.status = Event.PENDING
            event.rejection_reason = None
            event.reviewed_by = None
            event.reviewed_at = None
            event.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
            notify_staff_role(
                "event.approve", "event_needs_approval", "Edited event needs re-approval",
                body=f"“{event.name}” was edited and needs re-approval.",
                link="events-moderation", icon="🎉",
            )


class EventRenewView(APIView):
    """POST /api/events/{id}/renew/ {additional_days} — the organizer extends
    their event's visibility window (business item 3 / Wave E). Priced off the
    EventPricingTier for `additional_days` (must match a tier). Works on a live
    OR expired event that has already been paid for; the payment's finalizer
    extends expires_at (from now if the window had lapsed) and un-expires it.
    """

    permission_classes = [IsAuthenticated, IsEventOwner]

    def post(self, request, pk):
        event = generics.get_object_or_404(Event, pk=pk)
        self.check_object_permissions(request, event)

        if event.paid_at is None or event.status not in (Event.APPROVED, Event.EXPIRED):
            return Response(
                {"detail": "Only a paid, live or expired event can be renewed."}, status=400
            )
        try:
            additional_days = int(request.data.get("additional_days"))
        except (TypeError, ValueError):
            return Response({"additional_days": "A whole number of days is required."}, status=400)

        tier = EventPricingTier.objects.filter(duration_days=additional_days).first()
        if tier is None:
            return Response(
                {"additional_days": "Must match one of the configured pricing tiers."}, status=400
            )
        amount = tier.live_price

        with db_transaction.atomic():
            payment_kwargs = {
                "kind": CheckoutSession.EVENT_RENEW,
                "amount": amount,
                "purpose": f"Event renewal for '{event.name}' (+{additional_days} days)",
                "metadata": {"event_id": event.id, "renew_days": additional_days},
            }
            if event.submitted_by_business_id:
                payment_kwargs["business_owner"] = event.submitted_by_business
            else:
                payment_kwargs["customer"] = event.submitted_by_customer
            result = process_payment(**payment_kwargs)

            if result["mode"] == "redirect":
                return Response(
                    {"mode": "redirect", "checkout_url": result["checkout_url"], "reference": result["reference"]},
                    status=200,
                )
            event.refresh_from_db()

        return Response(EventOwnerSerializer(event, context={"request": request}).data)


class EventPayView(APIView):
    """POST /api/events/{id}/pay/ — the organizer pays for their *already
    approved* event's visibility window (see Event's class docstring: this
    is the step that sets paid_at and computes expires_at, per the
    approve-then-pay sequencing). Routed through
    payments.services.process_payment() (docs/HUBTEL_INTEGRATION.md, plan
    Workstream E) rather than writing a billing.Transaction directly.

    In simulated mode this behaves exactly as before: paid_at/expires_at are
    set synchronously in this same request (via
    payments.services._finalize_event_pay, run inline by process_payment()).
    In Hubtel mode, paid_at/expires_at stay null and the response is instead
    `{"mode": "redirect", "checkout_url": ..., "reference": ...}` — the event
    only becomes live once payments.views.HubtelWebhookView confirms
    payment.
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

        tier = EventPricingTier.objects.filter(duration_days=event.visibility_days).first()
        # tier.live_price is the flat total for the whole window, not a
        # per-day rate — do not multiply by visibility_days here.
        amount = tier.live_price if tier else _LEGACY_DAILY_RATE * event.visibility_days

        with db_transaction.atomic():
            payment_kwargs = {
                "kind": CheckoutSession.EVENT_PAY,
                "amount": amount,
                "purpose": f"Event visibility payment for '{event.name}' ({event.visibility_days} days)",
                "metadata": {"event_id": event.id},
            }
            if event.submitted_by_business_id:
                payment_kwargs["business_owner"] = event.submitted_by_business
            else:
                payment_kwargs["customer"] = event.submitted_by_customer
            result = process_payment(**payment_kwargs)

            if result["mode"] == "redirect":
                return Response(
                    {
                        "mode": "redirect",
                        "checkout_url": result["checkout_url"],
                        "reference": result["reference"],
                    },
                    status=200,
                )

            event.refresh_from_db()

        return Response(EventOwnerSerializer(event, context={"request": request}).data)


# The three UI tabs → stored statuses. Event.EXPIRED is deliberately absent:
# an expired event is a lapsed listing, not a moderation outcome, so it belongs
# on none of these tabs.
EVENT_STATUS_MAP = {
    "pending": Event.PENDING,
    "approved": Event.APPROVED,
    "rejected": Event.REJECTED,
}


class EventPendingQueueView(generics.ListAPIView):
    """GET /api/events/moderation/pending/?status=pending|approved|rejected —
    clones ModerationPendingQueueView's shape for events. The path still says
    "pending" for historical reasons; the tab comes from ?status=, defaulting
    to pending, with an unknown value falling back to pending.
    """

    serializer_class = EventModerationSerializer

    def get_permissions(self):
        return [HasRolePermission("event.approve")]

    def get_queryset(self):
        tab = self.request.query_params.get("status", "pending")
        event_status = EVENT_STATUS_MAP.get(tab, Event.PENDING)
        queryset = Event.objects.filter(status=event_status)
        if event_status == Event.PENDING:
            # A work queue — oldest first.
            return queryset.order_by("created_at")
        # History — most recently actioned first. Events moderated before this
        # queue existed have no reviewed_at, hence the created_at fallback.
        return queryset.order_by("-reviewed_at", "-created_at")


class EventModerationDetailView(generics.RetrieveAPIView):
    queryset = Event.objects.all()
    serializer_class = EventModerationSerializer

    def get_permissions(self):
        return [HasRolePermission("event.approve")]


def _notify_event_organizer(event, kind, title, body="", link="", icon=""):
    """Notify whichever account submitted the event — a BusinessOwner or a
    Customer (exactly one is set, per Event's own CheckConstraint)."""
    if event.submitted_by_business_id:
        notify_business_owner(event.submitted_by_business, kind, title, body=body, link=link, icon=icon)
    else:
        notify_customer(event.submitted_by_customer, kind, title, body=body, link=link, icon=icon)


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
        event.reviewed_by = request.user
        event.reviewed_at = timezone.now()
        update_fields = [
            "status", "rejection_reason", "approved_by", "reviewed_by", "reviewed_at",
        ]

        if event.paid_at is not None and event.expires_at is None:
            event.expires_at = event.paid_at + timedelta(days=event.visibility_days)
            update_fields.append("expires_at")

        event.save(update_fields=update_fields)
        _notify_event_organizer(
            event, "event_approved", "Event approved",
            body=f"“{event.name}” was approved. Pay to publish it and open RSVPs.",
            link="/events", icon="✅",
        )
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
        event.reviewed_by = request.user
        event.reviewed_at = timezone.now()
        event.save(
            update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"]
        )
        _notify_event_organizer(
            event, "event_rejected", "Event not approved",
            body=f"“{event.name}” was rejected: {reason}",
            link="/events", icon="⚠️",
        )
        return Response({"id": event.id, "status": event.status})


class EventReReviewView(APIView):
    """POST /api/events/moderation/{id}/re-review/ — sends a rejected event
    back to the pending queue, clearing the rejection.
    """

    def get_permissions(self):
        return [HasRolePermission("event.approve")]

    def post(self, request, pk):
        event = generics.get_object_or_404(Event, pk=pk)
        if event.status != Event.REJECTED:
            return Response(
                {"detail": "Only a rejected event can be sent back for re-review."},
                status=400,
            )
        event.status = Event.PENDING
        event.rejection_reason = None
        event.reviewed_by = None
        event.reviewed_at = None
        event.save(
            update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"]
        )
        notify_staff_role(
            "event.approve", "event_needs_approval", "Event re-opened for review",
            body=f"“{event.name}” was sent back and needs a fresh decision.",
            link="events-moderation", icon="🎉",
        )
        return Response({"id": event.id, "status": event.status})


class EventRSVPView(APIView):
    """POST/DELETE /api/events/{id}/rsvp/ — Phase 7
    (docs/BUSINESS_EVENTS_ROADMAP.md). Customer-only (not business owner —
    RSVP is an attendee concept, distinct from IsCustomerOrBusinessOwner's
    "either account type may submit an event" gate used elsewhere in this
    app). Only ever targets *live* events (mirrors _live_events_queryset —
    an event that is pending/rejected/expired/approved-but-unpaid isn't
    something anyone should be able to RSVP to, same as it isn't visible on
    the detail endpoint).

    Private-event gating mirrors EventDetailView/EventUnlockView exactly:
    since Phase 6 is deliberately stateless (no server-side "already
    unlocked" session), a private event's POST body must itself carry a
    matching `code`, checked against `event.access_code` the same way the
    detail endpoint checks `?code=`. Wrong/missing code on a private event
    is a 403 (this endpoint, like /unlock/ and unlike the detail endpoint,
    is an explicit action the caller is taking, so it fails loudly rather
    than silently degrading to a teaser).
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        event = generics.get_object_or_404(_live_events_queryset(), pk=pk)
        code = (request.data.get("code") or "").strip()
        if event.access_level == Event.PRIVATE and code != event.access_code:
            return Response({"detail": "Invalid or missing access code."}, status=403)

        with db_transaction.atomic():
            event = Event.objects.select_for_update().get(pk=event.pk)
            rsvp = EventRSVP.objects.filter(event=event, customer=request.user).first()

            if rsvp is not None and rsvp.status == EventRSVP.GOING:
                # Already going — idempotent no-op success, not an error.
                return Response(
                    {"event": event.id, "status": rsvp.status, "going_count": event.going_count}
                )

            going_count = EventRSVP.objects.filter(event=event, status=EventRSVP.GOING).count()
            if event.capacity is not None and going_count >= event.capacity:
                return Response({"detail": "This event is at capacity."}, status=400)

            if rsvp is None:
                rsvp = EventRSVP.objects.create(
                    event=event, customer=request.user, status=EventRSVP.GOING
                )
                created = True
            else:
                rsvp.status = EventRSVP.GOING
                rsvp.save(update_fields=["status", "updated_at"])
                created = False

            event.sync_going_count()

        return Response(
            {"event": event.id, "status": rsvp.status, "going_count": event.going_count},
            status=201 if created else 200,
        )

    def delete(self, request, pk):
        event = generics.get_object_or_404(_live_events_queryset(), pk=pk)

        with db_transaction.atomic():
            event = Event.objects.select_for_update().get(pk=event.pk)
            rsvp = EventRSVP.objects.filter(event=event, customer=request.user).first()

            if rsvp is None or rsvp.status == EventRSVP.CANCELLED:
                # No RSVP to cancel — no-op, not an error.
                return Response(status=204)

            rsvp.status = EventRSVP.CANCELLED
            rsvp.save(update_fields=["status", "updated_at"])
            event.sync_going_count()

        return Response(status=204)


class EventAttendeesListView(generics.ListAPIView):
    """GET /api/events/{id}/rsvps/ — organizer-only (the event's own
    submitter) or staff holding `event.approve`, paginated list of `going`
    attendees (Phase 7). Organizers get names only; staff also get the
    attendee's phone and email (see the two serializers).
    """

    permission_classes = [IsAuthenticated, IsEventOwnerOrCanApproveEvents]
    pagination_class = EventPagination

    def get_serializer_class(self):
        if isinstance(self.request.user, StaffUser):
            return StaffEventAttendeeSerializer
        return EventAttendeeSerializer

    def get_event(self):
        event = generics.get_object_or_404(Event, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, event)
        return event

    def get_queryset(self):
        return EventRSVP.objects.filter(event=self.get_event(), status=EventRSVP.GOING)


class EventTicketTypeListCreateView(generics.ListCreateAPIView):
    """GET /api/events/{id}/ticket-types/ — public, unauthenticated list of
    a *live* event's active ticket types (mirrors _live_events_queryset's
    gating — an event that isn't currently public shouldn't be sellable).
    POST — the event's own organizer defines a new ticket type
    (event ticketing + escrow work).
    """

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), IsEventOwner()]
        return [AllowAny()]

    def get_serializer_class(self):
        if self.request.method == "POST":
            return EventTicketTypeWriteSerializer
        return EventTicketTypePublicSerializer

    def get_queryset(self):
        event = generics.get_object_or_404(_live_events_queryset(), pk=self.kwargs["pk"])
        return event.ticket_types.filter(is_active=True)

    def get_event(self):
        event = generics.get_object_or_404(Event, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, event)
        return event

    def perform_create(self, serializer):
        serializer.save(event=self.get_event())


class EventTicketTypeMineListView(generics.ListAPIView):
    """GET /api/events/{id}/ticket-types/mine/ — the event's own organizer's
    view of all their ticket types (active or not), unpaginated, mirroring
    EventMineListView's "an organizer's own data isn't paginated" shape.
    """

    serializer_class = EventTicketTypeOwnerSerializer
    permission_classes = [IsAuthenticated, IsEventOwner]
    pagination_class = None

    def get_event(self):
        event = generics.get_object_or_404(Event, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, event)
        return event

    def get_queryset(self):
        return self.get_event().ticket_types.all()


class EventTicketTypeUpdateView(generics.RetrieveUpdateAPIView):
    """PATCH /api/events/ticket-types/{type_id}/ — the ticket type's own
    event organizer edits it (e.g. adjusting quantity_total, deactivating
    it). Response is re-serialized via EventTicketTypeOwnerSerializer so a
    successful edit's response carries the same shape as the "mine" list
    above, not the bare write-serializer echo.
    """

    queryset = EventTicketType.objects.all()
    permission_classes = [IsAuthenticated, IsEventTicketTypeOwner]
    lookup_url_kwarg = "type_id"

    def get_serializer_class(self):
        if self.request.method in ("PATCH", "PUT"):
            return EventTicketTypeWriteSerializer
        return EventTicketTypeOwnerSerializer

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(EventTicketTypeOwnerSerializer(instance).data)


class TicketPurchaseView(APIView):
    """POST /api/events/{id}/tickets/purchase/ — a signed-in customer buys
    one or more tickets of a given type for a *live* event (event
    ticketing + escrow work). Mirrors EventRSVPView's
    select_for_update()-then-check-then-create oversell-prevention pattern
    (locked on EventTicketType rather than Event, since the thing being
    contended over is ticket inventory, not RSVP capacity), and is routed
    through payments.booking_pay.pay(), which wraps payments.services.process_payment()
    (docs/HUBTEL_INTEGRATION.md, plan Workstream E, and the ledger's processing charge) rather than writing a billing.Transaction directly.

    Inventory (`quantity_sold`) is reserved **optimistically, under this same
    lock, before the payment is ever started** — in simulated mode this
    is no different from before (the reservation and the Transaction are
    both committed together, synchronously). In Hubtel mode it means a
    ticket is provisionally "sold" the moment checkout starts, not once
    payment is confirmed; if the webhook later reports failure/expiry
    instead of success, payments.services._fail_ticket_purchase rolls the
    reservation back. This optimistic-reserve-then-rollback approach is
    necessary because oversell-prevention requires the lock+check+reserve to
    happen atomically at checkout time — it cannot be deferred to whenever
    the webhook eventually arrives, or two concurrent Hubtel checkouts could
    both "succeed" against the same last unit of inventory.

    Each resulting Ticket starts life escrow_status=held regardless of
    provider: the money isn't considered "delivered to the organizer" until
    the ticket is checked in (EventCheckinView) or a staff accountant
    manually releases/refunds it.
    """

    permission_classes = [IsAuthenticated, IsCustomer, MarketplaceOpen]

    def post(self, request, pk):
        input_serializer = TicketPurchaseInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        quantity = input_serializer.validated_data["quantity"]
        try:
            method = booking_pay.method_from(request.data)
        except booking_pay.Refused as exc:
            return Response(exc.body, status=exc.status_code)

        event = generics.get_object_or_404(_live_events_queryset(), pk=pk)
        # Tickets for an event a customer organised stay outside the ledger (Plan 1b S10): no business holds them, so
        # nothing could take the money from a wallet.
        in_ledger = event.submitted_by_business_id is not None
        if method == booking_pay.WALLET and not in_ledger:
            return Response(
                {"detail": "Tickets for this event can only be paid by mobile money.", "code": "wallet_not_accepted"},
                status=409,
            )

        try:
            with db_transaction.atomic():
                try:
                    ticket_type = EventTicketType.objects.select_for_update().get(
                        pk=input_serializer.validated_data["ticket_type"].pk,
                        event=event,
                        is_active=True,
                    )
                except EventTicketType.DoesNotExist:
                    return Response({"detail": "Ticket type not found for this event."}, status=404)

                if (
                    ticket_type.quantity_total is not None
                    and ticket_type.quantity_sold + quantity > ticket_type.quantity_total
                ):
                    return Response({"detail": "Not enough tickets remaining."}, status=400)

                # Reserve inventory now, under this lock, regardless of provider
                # — see docstring above for why this can't wait for webhook
                # confirmation.
                ticket_type.quantity_sold += quantity
                ticket_type.save(update_fields=["quantity_sold"])

                result, processing = booking_pay.pay(
                    kind=CheckoutSession.TICKET_PURCHASE,
                    amount=ticket_type.price * quantity,
                    purpose=f"{quantity}x '{ticket_type.name}' ticket(s) for '{event.name}'",
                    customer=request.user,
                    metadata={
                        "event_id": event.id,
                        "ticket_type_id": ticket_type.id,
                        "quantity": quantity,
                        "customer_id": request.user.id,
                        "delivery_method": ticket_type.delivery_method,
                        "unit_price": str(ticket_type.price),
                    },
                    method=method,
                    in_ledger=in_ledger,
                )

                if result["mode"] == "redirect":
                    return Response(booking_pay.redirect_body(result, processing, in_ledger=in_ledger), status=200)

                # Immediate/simulated mode — process_payment() already ran
                # payments.services._finalize_ticket_purchase, which created the
                # Ticket row(s) and recorded their ids on the session's metadata.
                ticket_ids = result["session"].metadata.get("ticket_ids", [])
                tickets = Ticket.objects.filter(id__in=ticket_ids)
        except posting.InsufficientFunds as exc:
            return booking_pay.too_low(exc)  # the reservation rolled back with the payment

        return Response(
            TicketSerializer(tickets, many=True, context={"request": request}).data, status=201
        )


def _checkin_serializer_for(user):
    """Staff see the ticket buyer's phone; an event's organizer never does."""
    return StaffTicketCheckinListSerializer if isinstance(user, StaffUser) else TicketCheckinListSerializer


LEDGER_RELEASES = "With the ledger on, this ticket's money is released by Support's call to the customer."


def _ledger_sale(ticket):
    """The ledger's booking sale this ticket was bought in (ledger Plan 1b), or None: the ledger is off, the purchase
    was made before it was on, or the event's organiser is a customer. Only a ticket in a sale has its money in the
    ledger, and then its escrow flag follows the sale (ledger.sales.release)."""
    from ledger import escrow
    from ledger.models import BookingSale

    if not escrow.enabled():
        return None
    return BookingSale.objects.filter(session__transaction_id=ticket.transaction_id).first()


class EventCheckinListView(generics.ListAPIView):
    """GET /api/events/{id}/tickets/checkin-list/ — organizer/staff-only
    (same gate as GET .../rsvps/) roster of every ticket sold for this
    event, for at-the-door reference.
    """

    permission_classes = [IsAuthenticated, IsEventOwnerOrCanApproveEvents]
    pagination_class = EventPagination

    def get_serializer_class(self):
        return _checkin_serializer_for(self.request.user)

    def get_event(self):
        event = generics.get_object_or_404(Event, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, event)
        return event

    def get_queryset(self):
        return Ticket.objects.filter(ticket_type__event=self.get_event())


class EventCheckinView(APIView):
    """POST /api/events/{id}/tickets/checkin/ — organizer/staff scans or
    keys in a ticket's `code` to admit the holder. This is the normal,
    non-exceptional path by which escrow is released when the ledger holds no
    money for the ticket: a held, undelivered, non-refunded ticket with no
    ledger sale is marked delivered and auto-released in the same write
    (escrow_released_by_staff stays null, distinguishing an auto-release from
    a manual EscrowReleaseView override). A ticket in a ledger sale is only
    marked delivered (evidence) and the buyer is told once (events.scan_notice);
    the money releases on the clock (ledger.sales.release_due), never on a scan.
    """

    permission_classes = [IsAuthenticated, IsEventOwnerOrCanApproveEvents]

    def post(self, request, pk):
        event = generics.get_object_or_404(Event, pk=pk)
        self.check_object_permissions(request, event)

        code = (request.data.get("code") or "").strip()
        with db_transaction.atomic():
            # Locked, so a scan and a refund of the same ticket never cross (ledger Plan 1b S15).
            ticket = generics.get_object_or_404(
                Ticket.objects.select_for_update(of=("self",)), code=code, ticket_type__event=event,
            )

            if ticket.delivered_at is not None:
                return Response({"detail": "This ticket has already been checked in."}, status=400)
            if ticket.refunded_at is not None:
                return Response(
                    {"detail": "This ticket was refunded and cannot be checked in."}, status=400
                )

            ticket.delivered_at = timezone.now()
            ticket.delivered_by_staff = request.user if isinstance(request.user, StaffUser) else None
            update_fields = ["delivered_at", "delivered_by_staff"]

            # With the ledger on, a ticket bought in a booking sale is released by the clock (ledger.sales.release_at), not by the scan.
            sale = _ledger_sale(ticket)
            if ticket.escrow_status == Ticket.HELD and sale is None:
                ticket.escrow_status = Ticket.RELEASED
                ticket.escrow_released_at = timezone.now()
                update_fields += ["escrow_status", "escrow_released_at"]

            ticket.save(update_fields=update_fields)
            scan_notice.send(ticket, sale)
        return Response(_checkin_serializer_for(request.user)(ticket).data)


class EscrowLedgerListView(generics.ListAPIView):
    """GET /api/events/tickets/escrow/ — staff `escrow.view` (seeded onto
    the accountant role, docs/PROJECT_SCOPE.md). Optional `?status=held|
    released` and `?event=<id>` filters, mirroring EventListView.
    filter_queryset's style.
    """

    serializer_class = TicketEscrowLedgerSerializer
    pagination_class = EventPagination

    def get_permissions(self):
        return [HasRolePermission("escrow.view")]

    def get_queryset(self):
        return Ticket.objects.select_related("ticket_type__event", "purchased_by", "escrow_released_by_staff", "refunded_by_staff").order_by("-created_at")

    def filter_queryset(self, queryset):
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(escrow_status=status_param)

        event_id = self.request.query_params.get("event")
        if event_id:
            queryset = queryset.filter(ticket_type__event_id=event_id)

        # The Accountant's screen: one state (a refunded ticket is its own state) and a search.
        state = self.request.query_params.get("state")
        if state == "refunded":
            queryset = queryset.filter(refunded_at__isnull=False)
        elif state == "late":
            queryset = queryset.filter(
                escrow_status=Ticket.HELD, refunded_at__isnull=True, delivered_at__isnull=True,
                ticket_type__event__event_date__lt=timezone.now(),
            )
        elif state in (Ticket.HELD, Ticket.RELEASED):
            queryset = queryset.filter(escrow_status=state, refunded_at__isnull=True)
        query = (self.request.query_params.get("q") or "").strip()[:80]
        if query:
            queryset = queryset.filter(
                Q(code__icontains=query) | Q(ticket_type__event__name__icontains=query) | Q(purchased_by__full_name__icontains=query)
            )
        return queryset


class EscrowSummaryView(APIView):
    """GET /api/events/tickets/escrow/summary/ — staff `escrow.view`. Ticket money by
    state, and the held tickets whose event date has already passed. Tickets are the
    only money AshantiHub holds: orders and bookings have no escrow record."""

    def get_permissions(self):
        return [HasRolePermission("escrow.view")]

    def get(self, request):
        zero = Decimal("0.00")
        held = Q(escrow_status=Ticket.HELD, refunded_at__isnull=True)
        totals = Ticket.objects.aggregate(
            held=Sum("price", filter=held), held_n=Count("id", filter=held),
            released=Sum("price", filter=Q(escrow_status=Ticket.RELEASED, refunded_at__isnull=True)),
            released_n=Count("id", filter=Q(escrow_status=Ticket.RELEASED, refunded_at__isnull=True)),
            refunded=Sum("price", filter=Q(refunded_at__isnull=False)), refunded_n=Count("id", filter=Q(refunded_at__isnull=False)),
            late=Sum("price", filter=held & Q(delivered_at__isnull=True, ticket_type__event__event_date__lt=timezone.now())),
            late_n=Count("id", filter=held & Q(delivered_at__isnull=True, ticket_type__event__event_date__lt=timezone.now())),
        )
        money = lambda value: f"{(value or zero):.2f}"
        return Response({
            "simulated": settings.PAYMENTS_PROVIDER == "simulated",
            "held": {"amount": money(totals["held"]), "count": totals["held_n"]},
            "released": {"amount": money(totals["released"]), "count": totals["released_n"]},
            "refunded": {"amount": money(totals["refunded"]), "count": totals["refunded_n"]},
            "held_after_event": {"amount": money(totals["late"]), "count": totals["late_n"]},
            "not_recorded": [
                {"name": "Orders and bookings", "why": "Order and booking money is not held in escrow yet, so none is listed here."},
                {"name": "Release timers", "why": "No release-after-delivery rule is built; a ticket is released at check-in or by staff."},
            ],
        })


def _required_note(value):
    """A staff note for an escrow action: trimmed, 3 to 500 characters, or None."""
    text = str(value or "").strip()
    return text[:500] if len(text) >= 3 else None


class EscrowReleaseView(APIView):
    """POST /api/events/tickets/{ticket_id}/escrow/release/ — staff
    `escrow.release` manually releases a held ticket's payment before/
    without a normal check-in (exception path — e.g. a physical-delivery
    ticket where check-in doesn't apply). Body may carry an optional
    `note` recorded as escrow_override_note. A ticket in a ledger booking sale
    answers 409 {"code": "ledger_on"}: Support's call releases it.
    """

    def get_permissions(self):
        # Money leaves escrow: the password is asked again.
        return [HasRolePermission("escrow.release"), RequiresSudo()]

    def post(self, request, ticket_id):
        note = _required_note(request.data.get("note"))
        if note is None:
            return Response({"note": "Write a note of at least 3 characters: every release is explained."}, status=400)
        if _ledger_sale(generics.get_object_or_404(Ticket, pk=ticket_id)) is not None:
            return Response({"detail": LEDGER_RELEASES, "code": "ledger_on"}, status=409)
        with db_transaction.atomic():
            ticket = generics.get_object_or_404(Ticket.objects.select_for_update(), pk=ticket_id)

            if ticket.refunded_at is not None:
                return Response({"detail": "This ticket was refunded and cannot be released."}, status=400)
            if ticket.escrow_status == Ticket.RELEASED:
                return Response({"detail": "This ticket's escrow is already released."}, status=400)

            ticket.escrow_status = Ticket.RELEASED
            ticket.escrow_released_at = timezone.now()
            ticket.escrow_released_by_staff = request.user
            ticket.escrow_override_note = note
            ticket.save(
                update_fields=[
                    "escrow_status", "escrow_released_at", "escrow_released_by_staff",
                    "escrow_override_note",
                ]
            )
        return Response(TicketEscrowLedgerSerializer(ticket).data)


class EscrowHoldView(APIView):
    """POST /api/events/tickets/{ticket_id}/escrow/hold/ — staff
    `escrow.release` reverses an escrow release back to held (exception
    path — e.g. a dispute raised after an already-checked-in ticket was
    released). Deliberately leaves delivered_at untouched: "held" is purely
    an escrow-ledger state here, not an undo of check-in itself. A ticket in a
    ledger booking sale answers 409 {"code": "ledger_on"}.
    """

    def get_permissions(self):
        return [HasRolePermission("escrow.release")]

    def post(self, request, ticket_id):
        note = _required_note(request.data.get("note"))
        if note is None:
            return Response({"note": "Write a note of at least 3 characters: every hold is explained."}, status=400)
        if _ledger_sale(generics.get_object_or_404(Ticket, pk=ticket_id)) is not None:
            return Response({"detail": LEDGER_RELEASES, "code": "ledger_on"}, status=409)
        with db_transaction.atomic():
            ticket = generics.get_object_or_404(Ticket.objects.select_for_update(), pk=ticket_id)

            if ticket.refunded_at is not None:
                return Response({"detail": "This ticket was refunded and cannot be held."}, status=400)
            if ticket.escrow_status == Ticket.HELD:
                return Response({"detail": "This ticket's escrow is already held."}, status=400)

            ticket.escrow_status = Ticket.HELD
            ticket.escrow_released_at = None
            ticket.escrow_released_by_staff = None
            ticket.escrow_override_note = note
            ticket.save(
                update_fields=[
                    "escrow_status", "escrow_released_at", "escrow_released_by_staff",
                    "escrow_override_note",
                ]
            )
        return Response(TicketEscrowLedgerSerializer(ticket).data)


class EscrowRefundView(APIView):
    """POST /api/events/tickets/{ticket_id}/escrow/refund/ — staff
    `escrow.refund` (accountant-only, not shared with escrow.release/
    escrow.view — a stricter permission for the one action that actually
    moves money back out) refunds a still-held, undelivered ticket. Creates
    a negative-amount Transaction as the refund's ledger record, mirroring
    how every other financial action in this app books a Transaction
    rather than mutating one in place.

    With the ledger on (the ticket has a BookingSale) the price goes back to the buyer's AshantiHub wallet instead,
    through ledger.sales.refund_ticket: one BookingRefund per ticket, plus the same REFUNDED Transaction; the response
    adds `wallet_refund`.
    """

    def get_permissions(self):
        return [HasRolePermission("escrow.refund"), RequiresSudo()]

    def post(self, request, ticket_id):
        reason = _required_note(request.data.get("reason"))
        if reason is None:
            return Response({"reason": "Write a reason of at least 3 characters: every refund is explained."}, status=400)
        sale = _ledger_sale(generics.get_object_or_404(Ticket, pk=ticket_id))
        if sale is not None:
            # With the ledger on, the ticket's price goes back to the buyer's AshantiHub wallet (ledger Plan 1b S9).
            from ledger import sales
            from ledger.money import from_pesewas
            from ledger.refunds import RefundError

            try:
                ticket, given = sales.refund_ticket(sale, ticket_id, by=request.user, reason=reason)
            except sales.TicketRefundError as exc:
                return Response({"detail": exc.message}, status=400)
            except RefundError as exc:
                return Response({"detail": exc.message}, status=exc.status_code)
            back = from_pesewas(given.amount_pesewas)
            notify_customer(
                ticket.purchased_by, "booking", "Your ticket was refunded",
                body=f"GH₵ {back} for your ticket to “{ticket.ticket_type.event.name}” went back to your AshantiHub wallet.",
                link="/my-account", icon="🎟️",
            )
            return Response({**TicketEscrowLedgerSerializer(ticket).data, "wallet_refund": str(back)})
        with db_transaction.atomic():
            ticket = generics.get_object_or_404(Ticket.objects.select_for_update(), pk=ticket_id)

            if ticket.delivered_at is not None:
                return Response(
                    {"detail": "This ticket has already been delivered and cannot be refunded."},
                    status=400,
                )
            if ticket.refunded_at is not None:
                return Response({"detail": "This ticket has already been refunded."}, status=400)

            Transaction.objects.create(
                customer=ticket.purchased_by,
                amount=-ticket.price,
                status=Transaction.REFUNDED,
                purpose=f"Refund for ticket {ticket.code} ('{ticket.ticket_type.event.name}')",
                reference=f"AH-REFUND-{ticket.id}-{get_random_string(8).upper()}",
            )
            ticket.refunded_at = timezone.now()
            ticket.refunded_by_staff = request.user
            ticket.refund_reason = reason
            ticket.save(update_fields=["refunded_at", "refunded_by_staff", "refund_reason"])

        return Response(TicketEscrowLedgerSerializer(ticket).data)


class MyTicketsListView(generics.ListAPIView):
    """GET /api/events/tickets/mine/ — the signed-in customer's own
    purchased tickets, unpaginated (mirrors EventTicketTypeMineListView/
    EventMineListView's "own data isn't paginated" convention).
    """

    serializer_class = TicketSerializer
    permission_classes = [IsAuthenticated, IsCustomer]
    pagination_class = None

    def get_queryset(self):
        return Ticket.objects.filter(purchased_by=self.request.user).order_by("-created_at")


class TicketPurchaseCancelView(APIView):
    """POST /api/events/tickets/purchases/{sale id}/cancel/ — the customer cancels a whole ticket purchase under the
    organiser's policy: no refunds unless the organiser set `refund_until_days_before`, then in full until then (409
    otherwise, and once the event has passed or a ticket was scanned)."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        sale = generics.get_object_or_404(BookingSale, pk=pk, customer=request.user, kind=BookingSale.TICKETS)
        try:
            given = sales.cancel_by_customer(sale)
        except sales.CancelError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        sales.tell_cancelled(sale, given)
        return Response({"cancelled": True, "wallet_refund": str(from_pesewas(given.amount_pesewas))})
