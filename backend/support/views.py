"""Support desk People screens: lookup, recents, the 360 profiles, the
profile-opened audit ping and staff-started conversations. Read views need
users.view (Support holds it, never users.manage); starting a conversation needs
messaging.manage."""
import datetime

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer, StaffUser
from accounts.permissions import HasRolePermission
from activity import services as activity
from activity.models import ActivityEvent
from listings.models import Listing
from messaging import services as desk
from messaging.models import Conversation, Message
from notifications.services import notify_customer
from orders.models import Order

from . import people

# A staff-started thread is a message to a real person's inbox: an agent may
# start this many per hour.
START_PER_HOUR = 10
PROFILE_AUDIT_WINDOW = datetime.timedelta(hours=1)
VERB_PROFILE_VIEWED = "support.profile_viewed"


class _Read(APIView):
    def get_permissions(self):
        return [HasRolePermission("users.view")]


class PeopleLookupView(_Read):
    """GET people/?q=&type=all|customers|businesses — name, masked phone, order
    number (#10) or business name. Fewer than two characters finds nothing."""

    def get(self, request):
        kind = request.query_params.get("type", "all")
        if kind not in ("all", "customers", "businesses"):
            raise ValidationError({"type": "Use all, customers or businesses."})
        return Response(people.lookup(request.query_params.get("q", ""), kind))


class PeopleRecentView(_Read):
    """GET people/recent/ — "Recently in touch with Support"."""

    def get(self, request):
        return Response(people.recents())


class CustomerProfileView(_Read):
    """GET staff/customers/<id>/360/ — Support-visible fields only. A plain
    read: opening the profile is recorded by the separate profile-opened ping."""

    def get(self, request, pk):
        return Response(people.customer_360(get_object_or_404(Customer, pk=pk), request.user))


class BusinessProfileView(_Read):
    def get(self, request, pk):
        owner = get_object_or_404(
            BusinessOwner.objects.select_related("profile", "profile__zone", "subscription__plan", "account_manager"), pk=pk
        )
        return Response(people.business_360(owner, request.user))


class ProfileOpenedView(_Read):
    """POST profile-opened/ {kind: customer|business, id} — the screen calls
    this once when a profile is opened ("every profile you open is recorded").
    Writes one support.profile_viewed activity event, at most one per (agent,
    profile) per hour. GETs stay free of writes, so the audit is a POST; it is
    exempt from the automatic request log because it logs itself, deduped."""

    activity_exempt = True

    def post(self, request):
        kind, pk = request.data.get("kind"), request.data.get("id")
        if kind not in ("customer", "business") or not str(pk).isdigit() or int(pk) > 2**31 - 1:
            raise ValidationError({"detail": "Say which profile was opened."})
        model = Customer if kind == "customer" else BusinessOwner
        subject = get_object_or_404(model, pk=int(pk))
        now = timezone.now()
        with transaction.atomic():
            # Serialise this agent's pings so two tabs cannot both log.
            StaffUser.objects.select_for_update().get(pk=request.user.pk)
            seen = ActivityEvent.objects.filter(
                actor_type=ActivityEvent.STAFF, actor_id=request.user.pk, verb=VERB_PROFILE_VIEWED,
                target_type=model._meta.label_lower, target_id=str(subject.pk),
                occurred_at__gte=now - PROFILE_AUDIT_WINDOW,
            ).exists()
            if not seen:
                label = subject.full_name if kind == "customer" else subject.display_name
                activity.record(
                    request.user, VERB_PROFILE_VIEWED, target=subject, method="POST", target_label=label,
                    summary=f"Opened {kind} profile", request=request,
                )
        return Response({"recorded": not seen})


class StartConversationView(APIView):
    """POST staff/customers/<id>/start-conversation/ {body, about_order?,
    about_business?, topic?} — Support writes first to a customer WITH an
    account. The thread is with AshantiHub Support about an order or business
    (never with the business); the customer is notified in the app. Never for
    business owners or guests (no such route); a per-agent hourly cap applies."""

    def get_permissions(self):
        return [HasRolePermission("messaging.manage")]

    def post(self, request, pk):
        customer = get_object_or_404(Customer, pk=pk)
        body = request.data.get("body")
        if not isinstance(body, str) or not body.strip():
            raise ValidationError({"body": "Write the first message."})
        if len(body) > 4000:
            raise ValidationError({"body": "That message is too long."})
        order = business = None
        subject = (request.data.get("topic") or "").strip()[:120] if isinstance(request.data.get("topic"), str) else ""
        if request.data.get("about_order") not in (None, ""):
            order = Order.objects.filter(pk=str(request.data["about_order"]).lstrip("#") or 0, customer=customer).first() \
                if str(request.data["about_order"]).lstrip("#").isdigit() else None
            if order is None:
                raise ValidationError({"about_order": "That order does not belong to this customer."})
        if request.data.get("about_business") not in (None, ""):
            raw = request.data["about_business"]
            business = BusinessOwner.objects.filter(pk=raw, listings__status=Listing.PUBLISHED).distinct().first() \
                if str(raw).isdigit() else None
            if business is None:
                raise ValidationError({"about_business": "Pick a business with live listings."})
        if order is None and business is None and not subject:
            raise ValidationError({"detail": "Say what it is about: an order, a business, or a short topic."})
        if not subject:
            subject = f"Order #{order.pk}" if order is not None else business.display_name
        with transaction.atomic():
            # Serialise this agent's starts so the cap cannot be raced past.
            StaffUser.objects.select_for_update().get(pk=request.user.pk)
            recent = Conversation.objects.filter(
                source="staff_started", created_at__gte=timezone.now() - datetime.timedelta(hours=1),
                messages__author=request.user,
            ).distinct().count()
            if recent >= START_PER_HOUR:
                raise Throttled(detail="You have started the most conversations allowed this hour. Try again later.")
            now = timezone.now()
            conversation = Conversation.objects.create(
                customer=customer, subject=subject, source="staff_started", assignee=request.user,
                about_order=order, about_business=business,
                first_reply_at=now,
            )
            Message.objects.create(
                conversation=conversation, sender_type=Message.STAFF, body=body.strip(), author=request.user,
            )
            desk.stamp_clocks(conversation)
        notify_customer(
            customer, "support_reply", "AshantiHub Support started a conversation with you",
            body="Open your account to read it and reply.", link="/my-account", icon="💬",
        )
        return Response({"id": conversation.pk, "subject": conversation.subject}, status=201)
