from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

import logging

from accounts.models import Role, StaffUser
from accounts.permissions import HasRolePermission, can_lead_team
from notifications.services import notify_staff, notify_staff_role
from staff_tasks.models import Task
from staff_tasks.services import create_task

from .models import ContactMessage, ContactReply
from .serializers import (
    ContactMessageSerializer, ContactMessageStaffSerializer, ContactMessageSubmitSerializer,
    ContactReplyInputSerializer,
)

logger = logging.getLogger(__name__)


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
        queryset = ContactMessage.objects.select_related("resolved_by", "passed_by").prefetch_related("replies__staff")
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
        return Response(ContactMessageSerializer(message, context={"request": request}).data)


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
        return Response(ContactMessageSerializer(message, context={"request": request}).data)


class ContactMessageMarkUnreadView(APIView):
    """POST /api/core/contact-messages/{id}/mark-unread/ — staff-only. Only a
    read message goes back to new; resolved is final (409)."""

    def get_permissions(self):
        return [HasRolePermission("contact_messages.manage")]

    def post(self, request, pk):
        with transaction.atomic():
            message = generics.get_object_or_404(ContactMessage.objects.select_for_update(), pk=pk)
            if message.status == ContactMessage.RESOLVED:
                return Response({"detail": "A resolved message cannot be marked unread."}, status=409)
            message.status = ContactMessage.NEW
            message.save(update_fields=["status"])
        return Response(ContactMessageSerializer(message, context={"request": request}).data)


class ContactMessageReplyView(APIView):
    """POST /api/core/contact-messages/{id}/reply/ {body} — email the sender
    from DEFAULT_FROM_EMAIL and keep a ContactReply row. No conversation is
    created (the sender has no account to open one). A failed send keeps the row
    with email_sent=False and answers 502, so nothing claims it went out."""

    def get_permissions(self):
        return [HasRolePermission("contact_messages.manage")]

    def post(self, request, pk):
        message = generics.get_object_or_404(ContactMessage, pk=pk)
        serializer = ContactReplyInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        body = serializer.validated_data["body"].strip()
        if not body:
            return Response({"body": ["Write a reply first."]}, status=400)
        if not message.email:
            return Response(
                {"detail": "This message has no email address. Call them and log the call instead."}, status=400
            )
        try:
            send_mail(
                subject=f"Re: {message.subject}", message=body, from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[message.email], fail_silently=False,
            )
            sent = True
        except Exception:
            logger.exception("Contact reply email failed for message %s", message.pk)
            sent = False
        with transaction.atomic():
            reply = ContactReply.objects.create(message=message, staff=request.user, body=body, email_sent=sent)
            locked = ContactMessage.objects.select_for_update().get(pk=message.pk)
            if locked.status == ContactMessage.NEW:
                locked.status = ContactMessage.READ
                locked.save(update_fields=["status"])
        if not sent:
            return Response({"detail": "The email could not be sent. Try again, or call them."}, status=502)
        message.refresh_from_db()
        message = ContactMessage.objects.prefetch_related("replies__staff").get(pk=message.pk)
        return Response(ContactMessageStaffSerializer(message, context={"request": request}).data, status=201)


def operations_lead_for(staff):
    """Who gets a message passed to Operations: the sender's own manager when
    that manager leads a team, else an active Operations team lead, else a
    Super Admin."""
    manager = staff.manager
    if manager is not None and manager.is_active and not manager.is_suspended and can_lead_team(manager):
        return manager
    active = StaffUser.objects.filter(is_active=True, is_suspended=False)
    for role in (Role.OPERATIONS, Role.SUPER_ADMIN):
        for candidate in active.filter(role__name=role).order_by("id"):
            if can_lead_team(candidate):
                return candidate
    return None


class ContactMessagePassToOperationsView(APIView):
    """POST /api/core/contact-messages/{id}/pass-to-operations/ {note?} — a
    follow-up Task for the Operations lead carrying the message text. There is
    no leads model; the Task and a bell notice are the whole hand-off."""

    def get_permissions(self):
        return [HasRolePermission("contact_messages.manage")]

    def post(self, request, pk):
        note = str(request.data.get("note") or "").strip()[:1000]
        with transaction.atomic():
            message = generics.get_object_or_404(ContactMessage.objects.select_for_update(), pk=pk)
            if message.passed_to_operations_at:
                return Response({"detail": "Already passed to Operations."}, status=409)
            lead = operations_lead_for(request.user)
            if lead is None:
                return Response({"detail": "There is no Operations lead to pass this to."}, status=409)
            text = f"From {message.name} ({message.get_category_display()}), {message.subject}\n\n{message.message}"
            if note:
                text += f"\n\nNote from {request.user.full_name}: {note}"
            create_task(
                lead, f"Follow up: {message.subject}"[:200], timezone.now() + timedelta(days=1),
                notes=text, source=message, created_by=request.user, kind=Task.OPS_FOLLOW_UP,
            )
            message.passed_to_operations_at = timezone.now()
            message.passed_by = request.user
            message.save(update_fields=["passed_to_operations_at", "passed_by"])
        notify_staff(
            lead, "contact_message", "Contact message passed to you",
            body=f"{request.user.full_name} passed on: {message.subject}", link="tasks", icon="✉️",
        )
        message = ContactMessage.objects.select_related("resolved_by", "passed_by").prefetch_related("replies__staff").get(pk=pk)
        return Response(ContactMessageStaffSerializer(message, context={"request": request}).data)
