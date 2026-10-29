"""The right-hand pane of the inbox: what Support needs to know about the person,
the order and the business a conversation is about. Read-only (GET), assembled
only from real records, and it never carries payout, TIN, Ghana Card or full
phone numbers. A guest has no data to show and says so."""

from django.conf import settings as django_settings
from django.utils import timezone

from accounts.models import Role
from accounts.phones import mask_phone
from billing import clock
from calls.models import CallLog
from listings.models import Listing
from orders.models import DeliveryAssignment
from payments.models import CheckoutSession
from staff_tasks.models import Task

from .models import Conversation, Message

EARLIER = 5
SOURCE = "messaging.conversation"


def _earlier(conversation):
    qs = Conversation.objects.exclude(pk=conversation.pk)
    if conversation.customer_id:
        qs = qs.filter(customer_id=conversation.customer_id)
    elif conversation.business_owner_id:
        qs = qs.filter(business_owner_id=conversation.business_owner_id)
    else:
        qs = qs.filter(guest_token=conversation.guest_token)
    return [
        {"id": c.pk, "subject": c.subject, "status": c.status, "created_at": c.created_at}
        for c in qs.order_by("-created_at")[:EARLIER]
    ]


def _order(order):
    if order is None:
        return None
    # Only stamps that exist on DeliveryAssignment: assigned, picked up, delivered, confirmed.
    # There is no rider location, ETA or handover code, so none is shown.
    delivery = DeliveryAssignment.objects.filter(order=order).select_related("dispatch").first()
    return {
        "id": order.pk, "total_amount": str(order.total_amount), "status": order.status,
        "status_label": order.get_status_display(), "delivery_status": order.delivery_status,
        "delivery_status_label": order.get_delivery_status_display(),
        "placed_at": getattr(order, "created_at", None),
        "delivery": {
            "rider": delivery.dispatch.full_name if delivery and delivery.dispatch_id else None,
            "assigned_at": delivery.assigned_at, "picked_up_at": delivery.picked_up_at,
            "delivered_at": delivery.delivered_at, "confirmed_at": delivery.confirmed_at,
        } if delivery else None,
    }


def _manager(owner):
    manager = owner.account_manager if owner is not None else None
    if manager is None:
        return None
    working = manager.is_active and not manager.is_suspended
    return {"id": manager.pk, "name": manager.full_name, "role": manager.role.name, "available": working}


def _business(owner):
    if owner is None:
        return None
    return {
        "id": owner.pk, "name": owner.display_name, "owner_name": owner.full_name,
        "verified": owner.identity_verified,
        "listings_live": Listing.objects.filter(business_owner=owner, status=Listing.PUBLISHED).count(),
        "account_manager": _manager(owner),
    }


def _subscription(owner, now):
    from billing.models import Subscription

    subscription = Subscription.objects.filter(business_owner=owner).select_related("plan").first()
    if subscription is None:
        return {"state": "none", "payments_simulated": django_settings.PAYMENTS_PROVIDER == "simulated"}
    state = clock.subscription_state(subscription, now)
    attempt = (
        CheckoutSession.objects.filter(business_owner=owner, kind=CheckoutSession.SUBSCRIPTION).order_by("-created_at").first()
    )
    return {
        "state": state["state"], "plan_name": state["plan_name"], "monthly_price": state["monthly_price"],
        "due_on": state["current_period_end"], "overdue_day": state["overdue_day"] if state["state"] == clock.OVERDUE else None,
        "overdue_since": state["overdue_since"],
        "last_attempt": {"at": attempt.created_at, "status": attempt.status, "status_label": attempt.get_status_display()} if attempt else None,
        "payments_simulated": django_settings.PAYMENTS_PROVIDER == "simulated",
    }


def _manager_follow_up(owner, manager):
    if manager is None:
        return None
    task = Task.objects.filter(
        owner_id=manager["id"], business_owner=owner, kind=Task.SUBSCRIPTION_OVERDUE, status=Task.OPEN,
    ).order_by("due_at").first()
    return {"title": task.title, "created_at": task.created_at, "due_at": task.due_at} if task else None


def _calls(conversation):
    calls = CallLog.objects.filter(related_type=SOURCE, related_id=str(conversation.pk)).select_related("staff")[:5]
    return [
        {"id": c.pk, "direction": c.direction, "outcome": c.outcome, "started_at": c.started_at,
         "by": c.staff.full_name, "duration_seconds": c.duration_seconds}
        for c in calls
    ]


def _looped(conversation):
    return Task.objects.filter(
        kind=Task.HANDOVER, source_type=SOURCE, source_id=str(conversation.pk), status=Task.OPEN,
    ).exists()


def build(conversation, now=None):
    now = now or timezone.now()
    payload = {"conversation": conversation.pk, "earlier": _earlier(conversation), "calls": _calls(conversation)}
    if conversation.customer_id:
        customer = conversation.customer
        payload["party"] = {
            "kind": "customer", "id": customer.pk, "name": customer.full_name, "phone_masked": mask_phone(customer.phone) if customer.phone else None,
            "orders": customer.orders.count(),
        }
    elif conversation.business_owner_id:
        owner = conversation.business_owner
        payload["party"] = {"kind": "business_owner", "id": owner.pk, "name": owner.full_name, "phone_masked": mask_phone(owner.login_phone) if owner.login_phone else None}
    else:
        payload["party"] = {
            "kind": "guest", "id": None, "name": f"Guest · thread {conversation.pk}", "phone_masked": None,
            "note": "No account and no contact details. Replies show in the chat panel while their page is open. SMS is not connected.",
        }
    payload["order"] = _order(conversation.about_order)
    about_owner = conversation.about_business or conversation.business_owner
    payload["business"] = _business(about_owner)
    listing = conversation.about_listing
    payload["listing"] = {"id": listing.pk, "name": listing.name, "price_amount": str(listing.price_amount) if listing.price_amount is not None else None} if listing else None
    payload["tags"] = [{"id": t.pk, "name": t.name} for t in conversation.tags.all()]
    if conversation.business_owner_id:
        owner = conversation.business_owner
        payload["owner"] = {
            "subscription": _subscription(owner, now),
            "account_manager": _manager(owner),
            "manager_follow_up": _manager_follow_up(owner, _manager(owner)),
            "looped_in": _looped(conversation),
            "since": owner.created_at,
        }
    return payload


def last_owner_question(conversation):
    """The owner's own latest public message: the only thread text that ever goes to
    the account manager or Accounting. Internal notes are never read here."""
    message = (
        Message.objects.filter(conversation=conversation, kind=Message.MESSAGE, is_internal=False)
        .exclude(sender_type=Message.STAFF).order_by("-created_at").first()
    )
    return message.body if message else ""
