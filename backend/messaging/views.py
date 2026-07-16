from rest_framework import generics
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission
from notifications.services import (
    notify_business_owner,
    notify_customer,
    notify_staff_role,
)

from .models import Conversation, Message
from .serializers import (
    ConversationCreateSerializer,
    ConversationSerializer,
    MessageCreateSerializer,
    MessageSerializer,
    StaffConversationListSerializer,
)

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
        conversation = Conversation.objects.create(
            subject=serializer.validated_data["subject"],
            status=Conversation.OPEN,
            **scope,
        )
        Message.objects.create(
            conversation=conversation,
            sender_type=_sender_type(request),
            body=serializer.validated_data["body"],
        )
        notify_staff_role(
            "messaging.manage", "new_message", "New support conversation",
            body=f"{conversation.starter_display_name} started a support conversation.",
            link="messaging", icon="💬",
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
        message = Message.objects.create(
            conversation=conversation, sender_type=_sender_type(request), body=serializer.validated_data["body"],
        )
        conversation.save()  # bump updated_at (auto_now) for the staff queue's recency ordering
        return Response(MessageSerializer(message).data, status=201)


class StaffConversationPagination(PageNumberPagination):
    page_size = 20


class StaffConversationListView(generics.ListAPIView):
    """GET /api/messaging/staff/ — every conversation, staff-only
    (messaging.manage), each annotated with a needs_reply indicator."""

    serializer_class = StaffConversationListSerializer
    queryset = Conversation.objects.all().select_related("customer", "business_owner").prefetch_related("messages")
    pagination_class = StaffConversationPagination

    def get_permissions(self):
        return [HasRolePermission("messaging.manage")]


class StaffConversationDetailView(generics.RetrieveAPIView):
    """GET /api/messaging/staff/{id}/ — full thread for one conversation,
    staff-only. Not explicitly required by the original request but the
    natural companion to the list above (a "needs_reply" flag alone doesn't
    tell staff what to reply to) and to the reply endpoint below."""

    serializer_class = ConversationSerializer
    queryset = Conversation.objects.all().prefetch_related("messages")

    def get_permissions(self):
        return [HasRolePermission("messaging.manage")]


class StaffConversationReplyView(APIView):
    """POST /api/messaging/staff/{id}/reply/ — staff-only
    (messaging.manage), posts a Message with sender_type=staff."""

    def get_permissions(self):
        return [HasRolePermission("messaging.manage")]

    def post(self, request, pk):
        conversation = generics.get_object_or_404(Conversation, pk=pk)
        serializer = MessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = Message.objects.create(
            conversation=conversation, sender_type=Message.STAFF, body=serializer.validated_data["body"],
        )
        conversation.save()
        # Notify the account that owns the thread (a guest thread has no
        # account to notify — notify_* no-ops on a None recipient).
        if conversation.customer_id:
            notify_customer(
                conversation.customer, "support_reply", "AshantiHub Support replied",
                body="You have a new reply from AshantiHub Support.",
                link="/my-account", icon="💬",
            )
        elif conversation.business_owner_id:
            notify_business_owner(
                conversation.business_owner, "support_reply", "AshantiHub Support replied",
                body="You have a new reply from AshantiHub Support.",
                link="/business-dashboard", icon="💬",
            )
        return Response(MessageSerializer(message).data, status=201)
