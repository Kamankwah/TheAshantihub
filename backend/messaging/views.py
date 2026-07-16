from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission

from .models import Conversation, Message
from .serializers import (
    ConversationCreateSerializer,
    ConversationSerializer,
    MessageCreateSerializer,
    MessageSerializer,
    StaffConversationListSerializer,
)


class IsCustomerOrBusinessOwner(BasePermission):
    """Either signed-in account type may hold a support conversation — this
    is the customer/business-owner-facing half of messaging, never a
    business-to-customer channel (see models.Conversation's docstring)."""

    def has_permission(self, request, view):
        return isinstance(request.user, (Customer, BusinessOwner))


def _starter_kwargs(user):
    """{"customer": user} or {"business_owner": user} depending on which
    account type is signed in — mirrors billing.Transaction's
    business_owner/customer FK-pair convention."""
    if isinstance(user, Customer):
        return {"customer": user}
    return {"business_owner": user}


def _sender_type(user):
    return Message.CUSTOMER if isinstance(user, Customer) else Message.BUSINESS_OWNER


class ConversationListCreateView(generics.ListCreateAPIView):
    """GET /api/messaging/conversations/ — the caller's own conversations
    (Customer or BusinessOwner), full thread included. POST starts a new one
    with the caller's first message in one call.
    """

    permission_classes = [IsAuthenticated, IsCustomerOrBusinessOwner]

    def get_serializer_class(self):
        return ConversationCreateSerializer if self.request.method == "POST" else ConversationSerializer

    def get_queryset(self):
        return Conversation.objects.filter(**_starter_kwargs(self.request.user)).prefetch_related("messages")

    def create(self, request, *args, **kwargs):
        serializer = ConversationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        conversation = Conversation.objects.create(
            subject=serializer.validated_data["subject"],
            status=Conversation.OPEN,
            **_starter_kwargs(request.user),
        )
        Message.objects.create(
            conversation=conversation,
            sender_type=_sender_type(request.user),
            body=serializer.validated_data["body"],
        )
        return Response(ConversationSerializer(conversation).data, status=201)


class ConversationMessageCreateView(APIView):
    """POST /api/messaging/conversations/{id}/messages/ — reply within the
    caller's own conversation. 404s for another account's conversation (the
    lookup is pre-scoped to the caller, same convention as
    orders.views.OrderDetailView)."""

    permission_classes = [IsAuthenticated, IsCustomerOrBusinessOwner]

    def post(self, request, pk):
        conversation = generics.get_object_or_404(
            Conversation.objects.filter(**_starter_kwargs(request.user)), pk=pk
        )
        serializer = MessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = Message.objects.create(
            conversation=conversation, sender_type=_sender_type(request.user), body=serializer.validated_data["body"],
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
        return Response(MessageSerializer(message).data, status=201)
