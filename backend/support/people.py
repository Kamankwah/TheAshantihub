"""What the Support desk may see of a customer or a business.

Every shape here is an explicit whitelist built by hand, never a
ModelSerializer over the account tables, so a field added to Customer,
BusinessOwner or BusinessOwnerProfile later cannot reach Support by accident.
Never in a Support payload: payout accounts and MoMo numbers, TIN, Ghana Card
number or images, passwords, sign-in codes, saved payment details, a full phone
or email, or a customer's street address (tests/test_people.py walks the JSON
for all of these)."""
from django.db.models import Count, Max, Q, Sum
from django.utils import timezone

from accounts.claims import mask_email
from accounts.models import BusinessOwner, Customer
from accounts.phones import filter_by_phone, mask_phone, phone_key
from accounts.serializers import hours_payload
from billing.clock import subscription_state
from calls.models import CallLog, purposes_for
from calls.views import visible_calls
from disputes.models import Dispute
from fraud.models import FraudFlag
from listings.models import Listing
from messaging.models import Conversation
from orders.models import Order
from reviews.models import Review

LIMIT = 25
RECENT_LIMIT = 12
_PURPOSES = dict(purposes_for("super_admin"))
_OPEN_DISPUTES = (Dispute.OPEN, Dispute.INVESTIGATING)


def _chip(key, label):
    return {"key": key, "label": label}


def _thread_status(conversation, now=None):
    now = now or timezone.now()
    if conversation.status != Conversation.OPEN:
        return "Resolved"
    if conversation.snoozed_until and conversation.snoozed_until > now:
        return "Snoozed"
    return "Open"


def _person_phone(raw):
    return mask_phone(raw) if raw else None


# --- status chips: only from real flags -----------------------------------
def customer_status(customer, open_dispute):
    if customer.is_suspended:
        return _chip("suspended", "Suspended")
    if open_dispute:
        return _chip("dispute", "Open dispute")
    return _chip("active", "Active")


def business_status(owner, has_open_flag):
    if owner.is_suspended:
        return _chip("suspended", "Suspended")
    if has_open_flag:
        return _chip("review", "Under Operations review")
    sub = getattr(owner, "subscription", None)
    if sub is not None:
        state = subscription_state(sub)
        if state["state"] in ("overdue", "paused"):
            day = state.get("overdue_day")
            return _chip("overdue", f"Subscription overdue · day {day}" if day else "Subscription overdue")
    if owner.identity_verified:  # the mark follows approved identity documents, as on the desk pane
        return _chip("verified", "Verified business")
    return _chip("active", "Active")


def _open_flag_ids(owner_ids):
    return set(
        FraudFlag.objects.filter(status=FraudFlag.OPEN, business_owner_id__in=owner_ids)
        .values_list("business_owner_id", flat=True)
    )


def _customer_rows(customers, matched_orders=None):
    ids = [c.pk for c in customers]
    orders = dict(Order.objects.filter(customer_id__in=ids).values("customer_id").annotate(n=Count("pk")).values_list("customer_id", "n"))
    open_threads = dict(
        Conversation.objects.filter(customer_id__in=ids, status=Conversation.OPEN)
        .values("customer_id").annotate(n=Count("pk")).values_list("customer_id", "n")
    )
    disputes = set(
        Dispute.objects.filter(raised_by_id__in=ids, status__in=_OPEN_DISPUTES).values_list("raised_by_id", flat=True)
    )
    rows = []
    for c in customers:
        n = orders.get(c.pk, 0)
        rows.append({
            "kind": "customer", "id": c.pk, "name": c.full_name, "type": "Customer",
            "area": None, "phone": _person_phone(c.phone),
            "activity": f"{n} order{'s' if n != 1 else ''} · since {c.created_at:%b %Y}",
            "open_conversations": open_threads.get(c.pk, 0),
            "status": customer_status(c, c.pk in disputes),
            "matched_order": (matched_orders or {}).get(c.pk),
            "business_name": None,
        })
    return rows


def _business_rows(owners):
    ids = [o.pk for o in owners]
    live = dict(
        Listing.objects.filter(business_owner_id__in=ids, status=Listing.PUBLISHED)
        .values("business_owner_id").annotate(n=Count("pk")).values_list("business_owner_id", "n")
    )
    counts = {}
    for conv in Conversation.objects.filter(status=Conversation.OPEN).filter(
        Q(business_owner_id__in=ids) | Q(about_business_id__in=ids)
    ).values("pk", "business_owner_id", "about_business_id"):
        for owner_id in {conv["business_owner_id"], conv["about_business_id"]} & set(ids):
            counts[owner_id] = counts.get(owner_id, 0) + 1
    flags = _open_flag_ids(ids)
    rows = []
    for o in owners:
        profile = getattr(o, "profile", None)
        n = live.get(o.pk, 0)
        rows.append({
            "kind": "business", "id": o.pk, "name": o.display_name, "type": "Business",
            "area": profile.zone.name if profile is not None and profile.zone_id else None,
            "phone": _person_phone(o.login_phone),
            "activity": f"{n} listing{'s' if n != 1 else ''} live" if n else "No live listings",
            "open_conversations": counts.get(o.pk, 0),
            "status": business_status(o, o.pk in flags),
            "matched_order": None, "business_name": o.display_name,
            "owner_name": o.full_name,
        })
    return rows


def _owner_qs():
    return BusinessOwner.objects.select_related("profile", "profile__zone", "subscription__plan")


def lookup(query, kind="all"):
    """Customers and business owners matching a name, a phone, an order number
    (`#10` or a bare number up to 8 digits) or a business name."""
    query = (query or "").strip()
    if len(query) < 2:
        return []
    customers, owners, matched = Customer.objects.none(), BusinessOwner.objects.none(), {}
    order_digits = query[1:] if query.startswith("#") else query
    is_order_number = order_digits.isdigit() and (query.startswith("#") or len(order_digits) <= 6)
    key = phone_key(query)
    if is_order_number:
        for order in Order.objects.filter(pk=int(order_digits)).select_related("customer"):
            matched[order.customer_id] = order.pk
        customers = Customer.objects.filter(pk__in=matched.keys())
        owners = BusinessOwner.objects.filter(listings__order_items__order_id=int(order_digits)).distinct()
    elif key:
        customers = filter_by_phone(Customer.objects.all(), "phone", query)
        owners = filter_by_phone(BusinessOwner.objects.all(), "login_phone", query)
    else:
        customers = Customer.objects.filter(Q(full_name__icontains=query) | Q(email__iexact=query))
        owners = BusinessOwner.objects.filter(
            Q(full_name__icontains=query) | Q(profile__business_name__icontains=query) | Q(email__iexact=query)
        )
    rows = []
    if kind in ("all", "customers"):
        rows += _customer_rows(list(customers.order_by("full_name")[:LIMIT]), matched)
    if kind in ("all", "businesses"):
        rows += _business_rows(list(_owner_qs().filter(pk__in=owners.values("pk")).order_by("full_name")[:LIMIT]))
    return rows


def recents():
    """Who Support was last in touch with: the starters of the latest
    conversations and the counterparts of the latest logged calls."""
    seen, order = {}, []

    def note(kind, pk, at):
        if pk is None or (kind, pk) in seen:
            return
        seen[(kind, pk)] = at
        order.append((kind, pk))

    events = []
    for conv in Conversation.objects.exclude(customer=None, business_owner=None).order_by("-updated_at")[:40]:
        events.append((conv.updated_at, "customer" if conv.customer_id else "business", conv.customer_id or conv.business_owner_id))
    for call in CallLog.objects.filter(counterpart_type__in=["customer", "business_owner"], counterpart_id__isnull=False).order_by("-started_at")[:40]:
        events.append((call.started_at, "customer" if call.counterpart_type == "customer" else "business", call.counterpart_id))
    for at, kind, pk in sorted(events, key=lambda e: e[0], reverse=True):
        note(kind, pk, at)
    order = order[:RECENT_LIMIT]
    customers = {c.pk: c for c in Customer.objects.filter(pk__in=[p for k, p in order if k == "customer"])}
    owners = {o.pk: o for o in _owner_qs().filter(pk__in=[p for k, p in order if k == "business"])}
    rows_by = {}
    for row in _customer_rows(list(customers.values())):
        rows_by[("customer", row["id"])] = row
    for row in _business_rows(list(owners.values())):
        rows_by[("business", row["id"])] = row
    return [rows_by[key] for key in order if key in rows_by]


# --- Customer 360 ----------------------------------------------------------
def _order_status(order):
    if order.status == Order.CANCELLED:
        return "Cancelled"
    if order.status == Order.PENDING:
        return "Awaiting payment"
    return dict(Order.DELIVERY_STATUS_CHOICES).get(order.delivery_status, order.delivery_status)


def _conversation_row(conv, now):
    about = None
    if conv.about_business_id:
        about = conv.about_business.display_name
    elif conv.about_order_id:
        about = f"Order #{conv.about_order_id}"
    return {
        "id": conv.pk, "subject": conv.subject, "about": about or conv.subject or "Support",
        "status": _thread_status(conv, now), "priority": conv.priority,
        "assignee": conv.assignee.full_name if conv.assignee_id else None,
        "started_at": conv.created_at, "resolved_at": conv.resolved_at,
    }


def _call_row(call):
    return {
        "id": call.pk, "started_at": call.started_at, "direction": call.direction, "channel": call.channel,
        "purpose": _PURPOSES.get(call.purpose, call.purpose.replace("_", " ").capitalize()),
        "outcome": call.get_outcome_display(), "duration_seconds": call.duration_seconds,
        "staff": call.staff.full_name, "related_label": call.related_label,
        "notes": (call.notes or "")[:160],
    }


def customer_360(customer, viewer):
    now = timezone.now()
    orders = list(
        Order.objects.filter(customer=customer).order_by("-placed_at")
        .prefetch_related("items__listing__business_owner__profile")[:20]
    )
    all_orders = Order.objects.filter(customer=customer)
    paid = all_orders.filter(status=Order.PAID)
    value = paid.aggregate(total=Sum("total_amount"))["total"] or 0
    by_method = dict(all_orders.values("delivery_method").annotate(n=Count("pk")).values_list("delivery_method", "n"))
    convs = Conversation.objects.filter(customer=customer).select_related("assignee", "about_business__profile")
    open_convs = convs.filter(status=Conversation.OPEN).count()
    calls_qs = visible_calls(viewer).filter(counterpart_type="customer", counterpart_id=customer.pk)
    last_call = calls_qs.aggregate(m=Max("started_at"))["m"]
    disputes = Dispute.objects.filter(raised_by=customer)
    reviews = Review.objects.filter(author=customer)
    pending_reviews = reviews.filter(status=Review.PENDING).count()
    order_rows = []
    for o in orders:
        items = list(o.items.all())
        sellers = []
        for item in items:
            name = item.listing.business_owner.display_name
            if name not in sellers:
                sellers.append(name)
        what = items[0].listing.name if items else ""
        if len(items) > 1:
            what += f" + {len(items) - 1} more"
        order_rows.append({
            "id": o.pk, "placed_at": o.placed_at, "from": ", ".join(sellers), "what": what,
            "how": o.get_delivery_method_display(), "total": str(o.total_amount), "status": _order_status(o),
        })
    return {
        "kind": "customer",
        "profile": {
            "id": customer.pk, "name": customer.full_name, "phone": _person_phone(customer.phone),
            "email": mask_email(customer.email) or None, "since": customer.created_at,
            "is_suspended": customer.is_suspended,
            "status": customer_status(customer, disputes.filter(status__in=_OPEN_DISPUTES).exists()),
        },
        "kpis": {
            "orders": all_orders.count(), "door_to_door": by_method.get(Order.DOOR_TO_DOOR, 0),
            "pickup": by_method.get(Order.STORE_PICKUP, 0), "order_value": str(value),
            "conversations": convs.count(), "open_conversations": open_convs,
            "calls": calls_qs.count(), "last_call_at": last_call,
            "disputes": disputes.count(), "reviews": reviews.count(), "pending_reviews": pending_reviews,
        },
        "orders": order_rows,
        "conversations": [_conversation_row(c, now) for c in convs.order_by("-updated_at")[:20]],
        "calls": [_call_row(c) for c in calls_qs.order_by("-started_at")[:20]],
        "disputes": [
            {
                "id": d.pk, "order_id": d.order_id, "reason": d.get_reason_display(),
                "status": d.get_status_display(), "created_at": d.created_at,
            }
            for d in disputes.order_by("-created_at")[:20]
        ],
        "reviews": [_review_row(r) for r in reviews.select_related("listing", "business_owner__profile", "event").order_by("-created_at")[:20]],
    }


def _review_row(review):
    if review.listing_id:
        target = review.listing.name
    elif review.business_owner_id:
        target = review.business_owner.display_name
    elif review.event_id:
        target = review.event.name
    else:
        target = "Organizer"
    return {
        "id": review.pk, "target": target, "rating": review.rating, "status": review.status,
        "created_at": review.created_at, "excerpt": (review.comment or "")[:160],
    }


def business_360(owner, viewer):
    """A business as Support sees it: identity (masked), listings, subscription
    state, account manager and the conversations and calls about it. Never the
    payout, tax or Ghana Card details."""
    now = timezone.now()
    profile = getattr(owner, "profile", None)
    listings = Listing.objects.filter(business_owner=owner)
    by_status = dict(listings.values("status").annotate(n=Count("pk")).values_list("status", "n"))
    sub = getattr(owner, "subscription", None)
    state = subscription_state(sub) if sub is not None else None
    convs = (
        Conversation.objects.filter(Q(business_owner=owner) | Q(about_business=owner))
        .select_related("assignee", "about_business__profile").distinct()
    )
    calls_qs = visible_calls(viewer).filter(counterpart_type="business_owner", counterpart_id=owner.pk)
    reviews = Review.objects.filter(business_owner=owner, status=Review.PUBLISHED)
    flag = FraudFlag.objects.filter(status=FraudFlag.OPEN, business_owner=owner).exists()
    return {
        "kind": "business",
        "profile": {
            "id": owner.pk, "name": owner.display_name, "owner_name": owner.full_name,
            "phone": _person_phone(owner.login_phone), "email": mask_email(owner.email) or None,
            "since": owner.created_at, "area": profile.zone.name if profile is not None and profile.zone_id else None,
            "is_suspended": owner.is_suspended, "verified": owner.identity_verified,
            "status": business_status(owner, flag),
            "account_manager": owner.account_manager.full_name if owner.account_manager_id else None,
        },
        "kpis": {
            "listings_live": by_status.get(Listing.PUBLISHED, 0), "listings_total": sum(by_status.values()),
            "conversations": convs.count(), "open_conversations": convs.filter(status=Conversation.OPEN).count(),
            "calls": calls_qs.count(), "last_call_at": calls_qs.aggregate(m=Max("started_at"))["m"],
            "reviews": reviews.count(),
        },
        "subscription": None if state is None else {
            "plan": state.get("plan_name"), "state": state["state"], "overdue_day": state.get("overdue_day"),
            "current_period_end": state.get("current_period_end"),
        },
        "conversations": [_conversation_row(c, now) for c in convs.order_by("-updated_at")[:20]],
        "calls": [_call_row(c) for c in calls_qs.order_by("-started_at")[:20]],
        # The weekly opening hours as entered ([] until someone enters them; never invented). Support may set them
        # (businesses.set_hours, Director ruling 7) through PUT /api/portfolio/businesses/<id>/hours/.
        "hours": hours_payload(owner),
    }
