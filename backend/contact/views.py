from django.utils import timezone
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from notifications.services import notify_staff_role

from .models import ContactMessage
from .serializers import ContactMessageSerializer, ContactMessageStaffSerializer, ContactMessageSubmitSerializer


class ContactMessageSubmitView(APIView):
    """POST /api/core/contact/ — public/anonymous contact-form submission.
    No eligibility/auth checks (unlike ReviewSubmitView) — anyone can
    submit. Validates shape only, then creates the row.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ContactMessageSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = ContactMessage.objects.create(**serializer.validated_data)
        notify_staff_role(
            "contact_messages.manage", "contact_message", "New contact message",
            body=f"{message.name} sent a {message.get_category_display().lower()} enquiry: {message.subject}",
            link="contact-messages", icon="✉️",
        )
        return Response(ContactMessageSerializer(message).data, status=201)


class ContactMessagePagination(PageNumberPagination):
    page_size = 20


class ContactMessageListView(generics.ListAPIView):
    """GET /api/core/contact-messages/ — all submissions regardless of
    status, staff-only (contact_messages.manage).
    """

    serializer_class = ContactMessageStaffSerializer
    pagination_class = ContactMessagePagination

    def get_queryset(self):
        """?status=new|read|resolved|open (open = not resolved) and ?category=."""
        queryset = ContactMessage.objects.select_related("resolved_by")
        status = self.request.query_params.get("status")
        if status == "open":
            queryset = queryset.exclude(status=ContactMessage.RESOLVED)
        elif status in dict(ContactMessage.STATUS_CHOICES):
            queryset = queryset.filter(status=status)
        category = self.request.query_params.get("category")
        if category in dict(ContactMessage.CATEGORY_CHOICES):
            queryset = queryset.filter(category=category)
        return queryset

    def get_permissions(self):
        return [HasRolePermission("contact_messages.manage")]


class ContactMessageMarkReadView(APIView):
    """POST /api/core/contact-messages/{id}/read/ — staff-only. No-op if the
    message is already resolved (resolved is final and must not be
    downgraded back to read).
    """

    def get_permissions(self):
        return [HasRolePermission("contact_messages.manage")]

    def post(self, request, pk):
        message = generics.get_object_or_404(ContactMessage, pk=pk)
        if message.status != ContactMessage.RESOLVED:
            message.status = ContactMessage.READ
            message.save(update_fields=["status"])
        return Response(ContactMessageSerializer(message).data)


class ContactMessageResolveView(APIView):
    """POST /api/core/contact-messages/{id}/resolve/ — staff-only.
    Unconditionally marks the message resolved by the requesting staff user.
    """

    def get_permissions(self):
        return [HasRolePermission("contact_messages.manage")]

    def post(self, request, pk):
        message = generics.get_object_or_404(ContactMessage, pk=pk)
        message.status = ContactMessage.RESOLVED
        message.resolved_by = request.user
        message.resolved_at = timezone.now()
        message.save(update_fields=["status", "resolved_by", "resolved_at"])
        return Response(ContactMessageSerializer(message).data)
