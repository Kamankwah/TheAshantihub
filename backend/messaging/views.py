from django.db import transaction
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer

from .models import Conversation, Message
from .serializers import (
    ConversationCreateSerializer,
    ConversationSerializer,
    MessageCreateSerializer,
    MessageSerializer,
)
from . import services

# A guest token is a browser-generated random id (crypto.randomUUID —
# 36 chars) persisted in localStorage. The length floor rejects trivially
# guessable tokens; there's no server-side registry of valid tokens — the
# token IS the credential, same trust model as an unguessable URL.
GUEST_TOKEN_MIN_LENGTH = 16
GUEST_TOKEN_MAX_LENGTH = 64


def _guest_token(request):
    """The caller-supplied guest token, or None. Read from the query string
    on GET and the body on POST — deliberately not a custom header, which
    would need a CORS_ALLOW_HEADERS addition to survive preflight."""
    token = request.query_params.get("guest_token") or (
        request.data.get("guest_token") if isinstance(request.data, dict) else None
    )
    if not token or not (GUEST_TOKEN_MIN_LENGTH <= len(token) <= GUEST_TOKEN_MAX_LENGTH):
        return None
    return token


def _conversation_scope(request):
    """Filter kwargs scoping conversations to the caller: a signed-in
    Customer/BusinessOwner sees their account's threads; an anonymous caller
    sees the threads matching their guest token. Raises PermissionDenied for
    a staff session (its inbox is the staff endpoints below) or an anonymous
    caller with no usable token."""
    if isinstance(request.user, Customer):
        return {"customer": request.user}
    if isinstance(request.user, BusinessOwner):
        return {"business_owner": request.user}
    if request.user is None or not request.user.is_authenticated:
        token = _guest_token(request)
        if token:
            return {"guest_token": token}
        raise PermissionDenied("A guest_token is required for anonymous messaging.")
    raise PermissionDenied("Staff read support threads via /api/messaging/staff/.")


def _sender_type(request):
    if isinstance(request.user, Customer):
        return Message.CUSTOMER
    if isinstance(request.user, BusinessOwner):
        return Message.BUSINESS_OWNER
    return Message.GUEST


def _about_links(data, request):
    """The optional about_* ids a surface sent, resolved to rows the CALLER may name.
    Staff-only context, never serialized back. Anything the caller could not
    legitimately point at is silently dropped (the thread still starts):
    - customer: only their own orders; published listings/businesses.
    - business owner: only their own business and listings, and orders that
      contain their listings.
    - guest: no order link; published listings/businesses only."""
    from listings.models import Listing
    from orders.models import Order

    user = request.user
    is_customer = isinstance(user, Customer)
    is_owner = isinstance(user, BusinessOwner)
    links = {}
    if data.get("about_listing"):
        listings = Listing.objects.filter(pk=data["about_listing"])
        listings = listings.filter(business_owner=user) if is_owner else listings.filter(status=Listing.PUBLISHED)
        listing = listings.select_related("business_owner").first()
        if listing:
            links["about_listing"] = listing
            links["about_business"] = listing.business_owner
    if data.get("about_business") and "about_business" not in links:
        if is_owner:
            if data["about_business"] == user.pk:
                links["about_business"] = user
        else:
            owner = BusinessOwner.objects.filter(
                pk=data["about_business"], listings__status=Listing.PUBLISHED
            ).distinct().first()
            if owner:
                links["about_business"] = owner
    if data.get("about_order"):
        orders = Order.objects.none()
        if is_customer:
            orders = Order.objects.filter(pk=data["about_order"], customer=user)
        elif is_owner:
            orders = Order.objects.filter(pk=data["about_order"], items__listing__business_owner=user).distinct()
        order = orders.first()
        if order:
            links["about_order"] = order
    return links


class ConversationListCreateView(generics.ListCreateAPIView):
    """GET /api/messaging/conversations/ — the caller's own conversations,
    full thread included; anonymous callers pass ?guest_token=. POST starts
    a new one with the caller's first message in one call (anonymous callers
    include guest_token in the body). Throttled per-IP for anonymous callers
    (ScopedRateThrottle keys authed callers by user id, anonymous by IP).
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "messaging"

    def get_serializer_class(self):
        return ConversationCreateSerializer if self.request.method == "POST" else ConversationSerializer

    def get_queryset(self):
        return Conversation.objects.filter(**_conversation_scope(self.request)).prefetch_related("messages")

    def create(self, request, *args, **kwargs):
        scope = _conversation_scope(request)
        serializer = ConversationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            conversation = services.start_conversation(
                subject=data["subject"],
                source="guest_chat" if "guest_token" in scope and data["source"] == "app" else data["source"],
                **_about_links(data, request),
                **scope,
            )
            Message.objects.create(
                conversation=conversation,
                sender_type=_sender_type(request),
                body=serializer.validated_data["body"],
            )
            # The assignee is told; an unassigned thread tells whoever is on shift (not the whole desk).
            who = conversation.starter_display_name if conversation.guest_token is None else f"Guest (thread {conversation.pk})"
            services.notify_assignee(
                conversation, "New support conversation", f"{who} started a support conversation.",
                link="support-mine" if conversation.assignee_id else "support-unassigned",
            )
        return Response(ConversationSerializer(conversation).data, status=201)


class ConversationMessageCreateView(APIView):
    """POST /api/messaging/conversations/{id}/messages/ — reply within the
    caller's own conversation (account- or guest-token-scoped). 404s for a
    conversation outside the caller's scope, same convention as
    orders.views.OrderDetailView."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "messaging"

    def post(self, request, pk):
        conversation = generics.get_object_or_404(
            Conversation.objects.filter(**_conversation_scope(request)), pk=pk
        )
        serializer = MessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Wakes a snoozed thread, reopens one resolved within 7 days, or (older) starts a
        # new linked conversation; see messaging.services.route_customer_message.
        _, message = services.route_customer_message(conversation.pk, _sender_type(request), serializer.validated_data["body"])
        return Response(MessageSerializer(message).data, status=201)
