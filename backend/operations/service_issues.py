"""Service problems on the team's businesses (canvas screens 16, 17 and 05),
read-only. Three sources, nothing typed in:

- contact messages (contact.ContactMessage), matched to a business owner by the
  sender's email or phone (accounts.phones.phone_key);
- disputes (disputes.Dispute) on an order that holds one of the business's
  listings;
- conversations (messaging.Conversation) where the business owner is the one
  talking to AshantiHub Support.

A conversation about a business started by a customer or guest only carries a
"Re:" subject line, so it is not linked here. The module reads; replying as
Support (messaging.manage) and deciding a dispute stay with their own screens.

Deliveries: today's DeliveryAssignment rows and the open Dispute rows. There is
no rider offer, handover code, GPS or return model yet (the Delivery phase)."""
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from accounts.models import BusinessOwner, Role
from accounts.phones import filter_by_phone
from contact.models import ContactMessage
from disputes.models import Dispute
from messaging.models import Conversation, Message
from orders.models import DeliveryAssignment, Order

from .scoreboard import scouts_in_scope

TYPES = ("contact", "dispute", "chat")
TYPE_LABELS = {"contact": "Contact form", "dispute": "Order dispute", "chat": "Owner chat"}
OPEN_DISPUTE = (Dispute.OPEN, Dispute.INVESTIGATING)
UNMATCHED_CAP = 200
EXCERPT = 300


def team_owner_filter(user):
    """The owners whose businesses are in the caller's scope: those managed by
    their scouts (or by themselves). A Super Admin sees every business."""
    if user.role.name == Role.SUPER_ADMIN:
        return Q()
    ids = [s.pk for s in scouts_in_scope(user, "team")] + [user.pk]
    return Q(account_manager_id__in=ids)


def match_owner(email, phone):
    """The business owner a contact message belongs to, matched by the sender's
    email (any case) or phone (last nine digits, against the login phone and the
    business contact phone), or None."""
    owners = BusinessOwner.objects.select_related("profile", "account_manager")
    if email:
        found = owners.filter(email__iexact=email.strip()).first()
        if found:
            return found
    if phone:
        found = filter_by_phone(owners, "login_phone", phone).first()
        if found:
            return found
        return filter_by_phone(owners, "profile__business_contact_phone", phone).first()
    return None


def _seconds(since, now):
    return max(0, int((now - since).total_seconds()))


def _owner_fields(owner):
    manager = owner.account_manager if owner else None
    return {
        "business": owner.display_name if owner else "—", "business_id": owner.pk if owner else None,
        "account_manager": manager.full_name if manager else None, "account_manager_id": manager.pk if manager else None,
    }


def _contact_item(message, owner, now):
    resolved = message.status == ContactMessage.RESOLVED
    if resolved:
        handled = message.resolved_by.full_name if message.resolved_by_id else "Resolved"
    elif message.status == ContactMessage.NEW:
        handled = "Not picked up yet"
    else:
        handled = "Read, not resolved yet"
    return {
        "key": f"contact-{message.pk}", "type": "contact", "type_label": TYPE_LABELS["contact"], "id": message.pk,
        **_owner_fields(owner),
        "what": f"{message.subject} · matched by the sender's {'email' if message.email and owner.email and owner.email.lower() == message.email.lower() else 'phone'}",
        "detail": message.message, "from": f"{message.name} · {message.email}",
        "handled_by": handled, "opened_at": message.created_at, "open_seconds": _seconds(message.created_at, now),
        "status": "resolved" if resolved else "open", "resolved_at": message.resolved_at,
    }


def _dispute_businesses(dispute):
    seen = {}
    if dispute.order_id:
        for item in dispute.order.items.all():
            owner = item.listing.business_owner
            seen.setdefault(owner.pk, owner)
    return list(seen.values())


def _dispute_item(dispute, owner, now):
    final = dispute.status in Dispute.FINAL_STATUSES
    if final:
        handled = dispute.resolved_by.full_name if dispute.resolved_by_id else "Closed"
    elif dispute.flagged_by_id:
        handled = dispute.flagged_by.full_name
    else:
        handled = "Not picked up yet"
    order = f"Order #{dispute.order_id}" if dispute.order_id else "No order attached"
    return {
        "key": f"dispute-{dispute.pk}", "type": "dispute", "type_label": TYPE_LABELS["dispute"], "id": dispute.pk,
        **_owner_fields(owner),
        "what": f"{order} · {dispute.get_reason_display()}", "detail": dispute.description,
        "from": dispute.raised_by.full_name if dispute.raised_by_id else None,
        "handled_by": handled, "opened_at": dispute.created_at, "open_seconds": _seconds(dispute.created_at, now),
        "status": "resolved" if final else "open", "resolved_at": dispute.updated_at if final else None,
        "dispute_status": dispute.get_status_display(),
    }


def _chat_item(conversation, now):
    owner = conversation.business_owner
    last = conversation.messages.order_by("-created_at").first()
    closed = conversation.status == Conversation.CLOSED
    return {
        "key": f"chat-{conversation.pk}", "type": "chat", "type_label": TYPE_LABELS["chat"], "id": conversation.pk,
        **_owner_fields(owner),
        "what": conversation.subject or "Owner message to Support",
        "detail": (last.body[:EXCERPT] if last else ""), "from": owner.full_name,
        "handled_by": "Support", "opened_at": conversation.created_at, "open_seconds": _seconds(conversation.created_at, now),
        "status": "resolved" if closed else "open", "resolved_at": conversation.updated_at if closed else None,
        "last_from_staff": bool(last and last.sender_type == Message.STAFF),
    }


def service_issues(user, *, kind="all", manager=None, status="open", now=None):
    """The Support issues list for the caller's businesses plus counts. `status`
    is open (oldest first) or resolved (newest first)."""
    now = now or timezone.now()
    status = status if status in ("open", "resolved") else "open"
    team = team_owner_filter(user)
    owners_q = BusinessOwner.objects.filter(team)
    if manager:
        owners_q = owners_q.filter(account_manager_id=manager)
    week = now - timedelta(days=7)
    rows = []

    if kind in ("all", "contact"):
        messages = ContactMessage.objects.select_related("resolved_by")
        messages = messages.filter(status=ContactMessage.RESOLVED, resolved_at__gte=week) if status == "resolved" else messages.exclude(status=ContactMessage.RESOLVED)
        owner_ids = None
        for message in messages.order_by("-created_at")[:UNMATCHED_CAP]:
            owner = match_owner(message.email, message.phone)
            if owner is None:
                continue
            if owner_ids is None:
                owner_ids = set(owners_q.values_list("pk", flat=True))
            if owner.pk in owner_ids:
                rows.append(_contact_item(message, owner, now))

    if kind in ("all", "dispute"):
        disputes = Dispute.objects.select_related("order", "raised_by", "flagged_by", "resolved_by").prefetch_related("order__items__listing__business_owner__account_manager", "order__items__listing__business_owner__profile")
        disputes = disputes.filter(status__in=Dispute.FINAL_STATUSES, updated_at__gte=week) if status == "resolved" else disputes.filter(status__in=OPEN_DISPUTE)
        owner_ids = set(owners_q.values_list("pk", flat=True))
        for dispute in disputes.filter(order__isnull=False).order_by("-created_at")[:UNMATCHED_CAP]:
            mine = [o for o in _dispute_businesses(dispute) if o.pk in owner_ids]
            if mine:
                rows.append(_dispute_item(dispute, mine[0], now))

    if kind in ("all", "chat"):
        chats = Conversation.objects.filter(business_owner__in=owners_q).select_related("business_owner__profile", "business_owner__account_manager")
        chats = chats.filter(status=Conversation.CLOSED, updated_at__gte=week) if status == "resolved" else chats.filter(status=Conversation.OPEN)
        for conversation in chats.order_by("-created_at")[:UNMATCHED_CAP]:
            rows.append(_chat_item(conversation, now))

    for row in rows:
        row["kind_label"] = row["type_label"]  # the Overview's issue rows read kind_label
    rows.sort(key=lambda row: row["opened_at"], reverse=status == "resolved")
    return rows


def open_issue_count(user, now=None):
    """The Support issues badge: open items across the three sources."""
    return len(service_issues(user, status="open", now=now))


def resolved_this_week(user, now=None):
    return len(service_issues(user, status="resolved", now=now))


def issues_payload(user, *, kind="all", manager=None, status="open", now=None):
    now = now or timezone.now()
    rows = service_issues(user, kind=kind if kind in TYPES else "all", manager=manager, status=status, now=now)
    everything = service_issues(user, status="open", now=now)
    counts = {t: sum(1 for r in everything if r["type"] == t) for t in TYPES}
    managers = {}
    for owner in BusinessOwner.objects.filter(team_owner_filter(user), account_manager__isnull=False).select_related("account_manager").distinct():
        managers[owner.account_manager.pk] = owner.account_manager.full_name
    return {
        "issues": rows, "open_total": len(everything), "counts": counts,
        "resolved_this_week": resolved_this_week(user, now),
        "managers": [{"id": pk, "name": name} for pk, name in sorted(managers.items(), key=lambda kv: kv[1])],
    }


# ---- Deliveries & returns (screen 17) ---------------------------------------

LAST_EVENT = (("confirmed_at", "Confirmed by customer"), ("delivered_at", "Delivered"), ("picked_up_at", "Picked up"), ("assigned_at", "Assigned"))
IN_FLIGHT = (DeliveryAssignment.ASSIGNED, DeliveryAssignment.PICKED_UP)
DELIVERY_ROWS = 100


def open_disputes():
    return Dispute.objects.filter(status__in=OPEN_DISPUTE)


def deliveries_open_count():
    """The Deliveries badge: open disputes (every business)."""
    return open_disputes().count()


def _order_businesses(order):
    seen = {}
    for item in order.items.all():
        owner = item.listing.business_owner
        seen.setdefault(owner.pk, {"id": owner.pk, "name": owner.display_name})
    return list(seen.values())


def deliveries_payload(now=None):
    now = now or timezone.now()
    today = timezone.localdate(now)
    base = DeliveryAssignment.objects.select_related("order", "dispatch").prefetch_related(
        "order__items__listing__business_owner__profile",
    )
    todays = base.filter(Q(assigned_at__date=today) | Q(status__in=IN_FLIGHT)).order_by("-assigned_at")
    total = todays.count()
    assignments = []
    for row in todays[:DELIVERY_ROWS]:
        label, at = "Assigned", row.assigned_at
        for field, text in LAST_EVENT:
            value = getattr(row, field)
            if value:
                label, at = text, value
                break
        order = row.order
        assignments.append({
            "id": row.pk, "order_id": order.pk, "businesses": _order_businesses(order),
            "to": order.delivery_address or None, "rider": row.dispatch.full_name if row.dispatch_id else None,
            "status": row.status, "status_label": row.get_status_display(),
            "delivery_status": order.delivery_status, "delivery_status_label": order.get_delivery_status_display(),
            "last_update": at, "last_update_label": label,
        })
    disputes = []
    queryset = open_disputes().select_related("order", "raised_by", "flagged_by").prefetch_related(
        "order__items__listing__business_owner__profile",
    ).order_by("created_at")
    for dispute in queryset:
        disputes.append({
            "id": dispute.pk, "order_id": dispute.order_id,
            "businesses": _order_businesses(dispute.order) if dispute.order_id else [],
            "reason": dispute.get_reason_display(), "status": dispute.status, "status_label": dispute.get_status_display(),
            "description": dispute.description[:EXCERPT], "raised_by": dispute.raised_by.full_name if dispute.raised_by_id else None,
            "handled_by": dispute.flagged_by.full_name if dispute.flagged_by_id else None,
            "opened_at": dispute.created_at, "open_seconds": _seconds(dispute.created_at, now),
        })
    return {
        "today": today, "assignments": assignments, "assignments_total": total, "assigned_today": base.filter(assigned_at__date=today).count(),
        "disputes": disputes, "dispute_total": len(disputes),
        "delivery_status_choices": [{"value": v, "label": label} for v, label in Order.DELIVERY_STATUS_CHOICES],
    }


# ---- Support team (screen 05) ------------------------------------------------

def support_team_payload(user, now=None):
    from accounts import sessions
    from accounts.models import StaffUser
    from calls.models import CallLog
    from django.db.models import Count, OuterRef, Subquery
    from reports.models import StaffReport

    now = now or timezone.now()
    today = timezone.localdate(now)
    agents = StaffUser.objects.filter(role__name=Role.SUPPORT, is_active=True, invite_token__isnull=True)
    if user.role.name != Role.SUPER_ADMIN:
        agents = agents.filter(manager=user)
    agents = sessions.with_last_sign_in(agents).order_by("full_name")
    rows = []
    for agent in agents:
        report = StaffReport.objects.filter(staff=agent, period=StaffReport.DAY, period_start=today).first()
        last = StaffReport.objects.filter(staff=agent, status__in=[StaffReport.SUBMITTED, StaffReport.ACKNOWLEDGED, StaffReport.RETURNED]).order_by("-period_start").first()
        rows.append({
            "id": agent.pk, "name": agent.full_name, "suspended": agent.is_suspended,
            "last_sign_in_at": agent.last_sign_in_at,
            "calls_today": CallLog.objects.filter(staff=agent, started_at__date=today).count(),
            "report_today": report.status if report else None,
            "last_report": {"date": last.period_start, "status": last.status} if last else None,
        })

    last_sender = Subquery(Message.objects.filter(conversation=OuterRef("pk")).order_by("-created_at").values("sender_type")[:1])
    open_chats = Conversation.objects.filter(status=Conversation.OPEN).annotate(last_sender=last_sender)
    waiting = open_chats.exclude(last_sender=Message.STAFF)
    oldest = waiting.order_by("updated_at").first()
    kinds = open_chats.aggregate(
        customer=Count("pk", filter=Q(customer__isnull=False)), owner=Count("pk", filter=Q(business_owner__isnull=False)),
        guest=Count("pk", filter=Q(guest_token__isnull=False)),
    )
    week = now - timedelta(days=7)
    return {
        "agents": rows,
        "queue": {
            "open": open_chats.count(), "awaiting_reply": waiting.count(),
            "oldest_waiting_seconds": _seconds(oldest.updated_at, now) if oldest else None,
            "closed_this_week": Conversation.objects.filter(status=Conversation.CLOSED, updated_at__gte=week).count(),
            "closed_total": Conversation.objects.filter(status=Conversation.CLOSED).count(),
            "by_starter": {"customers": kinds["customer"], "business_owners": kinds["owner"], "guests": kinds["guest"]},
        },
    }
