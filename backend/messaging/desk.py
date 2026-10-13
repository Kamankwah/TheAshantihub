"""Read side of the Support inbox: the scoped, sorted queryset and the row and
thread payloads staff screens render. Everything here is read-only (it backs GET
endpoints, which must write nothing) and staff-only (it carries notes, authors
and internal context that no customer, owner or guest serializer may return)."""

import datetime

from django.db.models import Case, Exists, F, IntegerField, OuterRef, Q, Subquery, Value, When
from django.utils import timezone

from .models import Conversation, Message
from .serializers import StaffMessageSerializer

SCOPES = ("mine", "unassigned", "all", "past", "snoozed", "resolved")
SORTS = ("time_limit", "newest", "priority", "oldest")
EXCERPT = 140

KIND_LABELS = {"customer": "Customer", "business_owner": "Business owner", "guest": "Guest"}
SOURCE_LABELS = dict(Conversation.SOURCE_CHOICES)


def annotated(queryset):
    """The inbox queryset: the last PUBLIC message (notes and events never count as
    the customer's last word), the next time limit and a priority rank, with the
    related rows joined so a page of rows costs a handful of queries."""
    public = Message.objects.filter(conversation=OuterRef("pk"), kind=Message.MESSAGE, is_internal=False).order_by("-created_at")
    return (
        queryset.select_related(
            "customer", "business_owner__profile", "assignee", "resolved_by", "about_business__profile",
            "about_listing", "about_order",
        )
        .prefetch_related("tags")
        .annotate(
            last_body=Subquery(public.values("body")[:1]),
            last_sender=Subquery(public.values("sender_type")[:1]),
            last_at=Subquery(public.values("created_at")[:1]),
            next_due=Case(
                When(first_reply_at__isnull=True, first_reply_due__isnull=False, then=F("first_reply_due")),
                default=F("resolve_due"),
            ),
            prio_rank=Case(
                When(priority=Conversation.HIGH, then=Value(0)), When(priority=Conversation.MEDIUM, then=Value(1)),
                default=Value(2), output_field=IntegerField(),
            ),
        )
    )


def awake_q(now):
    return Q(status=Conversation.OPEN) & (Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now))


def past_q(now):
    return awake_q(now) & (Q(first_reply_at__isnull=True, first_reply_due__lt=now) | Q(resolve_due__lt=now))


def scoped(queryset, scope, user, now, *, mine_only=False, days=7):
    if scope == "mine":
        return queryset.filter(awake_q(now), assignee=user)
    if scope == "unassigned":
        return queryset.filter(awake_q(now), assignee__isnull=True)
    if scope == "all":
        return queryset.filter(awake_q(now))
    if scope == "past":
        rows = queryset.filter(past_q(now))
        return rows.filter(assignee=user) if mine_only else rows
    if scope == "snoozed":
        return queryset.filter(status=Conversation.OPEN, snoozed_until__gt=now)
    if scope == "resolved":
        return queryset.filter(status=Conversation.CLOSED, resolved_at__gte=now - datetime.timedelta(days=days))
    return queryset  # no scope: the legacy "everything" list


def searched(queryset, q):
    q = (q or "").strip()
    if not q:
        return queryset
    public_hit = Exists(Message.objects.filter(conversation=OuterRef("pk"), kind=Message.MESSAGE, body__icontains=q))
    cond = (
        Q(subject__icontains=q) | Q(customer__full_name__icontains=q) | Q(business_owner__full_name__icontains=q)
        | Q(business_owner__profile__business_name__icontains=q) | Q(about_business__profile__business_name__icontains=q)
        | Q(about_listing__name__icontains=q) | public_hit
    )
    digits = q.lstrip("#")
    if digits.isdigit() and len(digits) < 10:
        cond |= Q(pk=int(digits)) | Q(about_order_id=int(digits))
    if q.lower().startswith("guest"):
        cond |= Q(guest_token__isnull=False)
    return queryset.filter(cond)


def ordered(queryset, sort, scope):
    far = F("next_due").asc(nulls_last=True)
    if sort == "newest" or (sort not in SORTS and scope in ("resolved",)):
        return queryset.order_by(F("last_at").desc(nulls_last=True), "-id")
    if sort == "oldest":
        return queryset.order_by("created_at", "id")
    if sort == "priority":
        return queryset.order_by("prio_rank", far, "id")
    if scope == "resolved":
        return queryset.order_by("-resolved_at", "-id")
    if scope in ("snoozed",):
        return queryset.order_by("snoozed_until", "id")
    return queryset.order_by(far, "id")


def person(conversation):
    """(kind, display name, person name) — guests carry no contact data at all."""
    if conversation.customer_id:
        return "customer", conversation.customer.full_name, conversation.customer.full_name
    if conversation.business_owner_id:
        owner = conversation.business_owner
        return "business_owner", owner.display_name, owner.full_name
    return "guest", f"Guest · thread {conversation.pk}", "Guest"


def about(conversation):
    business = conversation.about_business
    listing = conversation.about_listing
    order = conversation.about_order
    parts = []
    if business is not None:
        parts.append(business.display_name)
    if listing is not None:
        parts.append(listing.name)
    if order is not None:
        parts.append(f"Order #{order.pk}")
    return {
        "business": {"id": business.pk, "name": business.display_name} if business is not None else None,
        "listing": {"id": listing.pk, "name": listing.name} if listing is not None else None,
        "order": {"id": order.pk} if order is not None else None,
        "label": " · ".join(parts) or conversation.subject or "",
    }


def sla(conversation, now):
    """The clock a row shows: the first-reply target until Support has answered,
    then the resolve target. seconds_left is negative once it is over."""
    if conversation.status != Conversation.OPEN:
        return None
    if conversation.first_reply_at is None and conversation.first_reply_due is not None:
        kind, due = "first_reply", conversation.first_reply_due
    elif conversation.resolve_due is not None:
        kind, due = "resolve", conversation.resolve_due
    else:
        return None
    return {"kind": kind, "due": due, "seconds_left": int((due - now).total_seconds())}


def row(conversation, now=None):
    now = now or timezone.now()
    kind, display, person_name = person(conversation)
    last_body = getattr(conversation, "last_body", None)
    last_sender = getattr(conversation, "last_sender", None)
    last_at = getattr(conversation, "last_at", None)
    clock = sla(conversation, now)
    snoozed = conversation.status == Conversation.OPEN and conversation.snoozed_until is not None and conversation.snoozed_until > now
    return {
        "id": conversation.pk, "kind": kind, "kind_label": KIND_LABELS[kind], "display_name": display,
        "person_name": person_name, "starter_name": conversation.starter_display_name,
        "customer": conversation.customer_id, "business_owner": conversation.business_owner_id,
        "subject": conversation.subject, "status": conversation.status, "priority": conversation.priority,
        "assignee": {"id": conversation.assignee_id, "name": conversation.assignee.full_name} if conversation.assignee_id else None,
        "about": about(conversation),
        "last_message": {"body": (last_body or "")[:EXCERPT], "sender_type": last_sender, "at": last_at} if last_at else None,
        "last_message_at": last_at or conversation.created_at,
        "needs_reply": bool(conversation.status == Conversation.OPEN and last_sender is not None and last_sender != Message.STAFF),
        "sla": clock, "past_limit": bool(clock and clock["seconds_left"] < 0 and not snoozed),
        "first_reply_at": conversation.first_reply_at, "first_reply_due": conversation.first_reply_due,
        "resolve_due": conversation.resolve_due,
        "snoozed": snoozed, "snoozed_until": conversation.snoozed_until if snoozed else None,
        "resolved_at": conversation.resolved_at,
        "resolved_by": conversation.resolved_by.full_name if conversation.resolved_by_id else None,
        "resolution_code": conversation.resolution_code, "resolution_note": conversation.resolution_note,
        "unassigned_reason": conversation.unassigned_reason if conversation.assignee_id is None else "",
        "tags": [{"id": t.pk, "name": t.name} for t in conversation.tags.all()],
        "source": conversation.source, "source_label": SOURCE_LABELS.get(conversation.source, ""),
        "previous_conversation": conversation.previous_conversation_id,
        "created_at": conversation.created_at, "updated_at": conversation.updated_at,
    }


def thread(conversation, now=None):
    """One conversation for the middle pane: the row plus EVERY message, notes and
    timeline events included (staff shape)."""
    payload = row(conversation, now)
    payload["messages"] = StaffMessageSerializer(conversation.messages.select_related("author"), many=True).data
    return payload
