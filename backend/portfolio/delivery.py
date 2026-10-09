"""Orders and delivery problems on a business page (spec S5).

A scout sees a managed business's paid orders read-only: order number, the
business's own lines (names and quantities), statuses and the open dispute's
reason. Never a customer's name, phone, address or dispute text. A delivery
problem reaches the Delivery Managers as a task and a notification."""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from accounts.permissions import staff_holding
from activity.services import record
from disputes.models import Dispute
from notifications.services import notify_staff_role
from orders.models import Order
from staff_tasks.models import Task
from staff_tasks.services import create_task

DELIVERY_MANAGE = "delivery.manage"
NOTE_MAX = 500
TASK_DUE_IN = timedelta(hours=4)
OPEN_DISPUTES = (Dispute.OPEN, Dispute.INVESTIGATING)
ORDER_TARGET_TYPE = "orders.order"


class DeliveryProblemError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def business_orders(owner):
    """Paid orders with at least one line from this business, newest first."""
    return (
        Order.objects.filter(status=Order.PAID, items__listing__business_owner=owner)
        .select_related("delivery_assignment")
        .prefetch_related("items__listing", "disputes")
        .distinct()
        .order_by("-placed_at", "-id")
    )


def order_item(order, owner, flagged_ids=()):
    lines = [i for i in order.items.all() if i.listing.business_owner_id == owner.pk]
    dispute = next((d for d in order.disputes.all() if d.status in OPEN_DISPUTES), None)
    assignment = getattr(order, "delivery_assignment", None)
    return {
        "id": order.pk,
        "number": f"#{order.pk}",
        "placed_at": order.placed_at,
        "items": [{"name": line.listing.name, "quantity": line.quantity} for line in lines],
        "status": order.status,
        "delivery_status": order.delivery_status,
        "delivered_at": assignment.delivered_at if assignment is not None else None,
        "dispute": (
            {"reason": dispute.reason, "reason_label": dispute.get_reason_display(), "status": dispute.status}
            if dispute is not None else None
        ),
        "problem_flagged": order.pk in flagged_ids,
    }


def flagged_order_ids(owner, order_ids):
    """Orders with a scout-raised flag task still open (clears once the Delivery Manager closes it)."""
    return set(
        int(source_id) for source_id in Task.objects.filter(
            kind=Task.DELIVERY_PROBLEM, business_owner=owner, source_type=ORDER_TARGET_TYPE,
            source_id__in=[str(pk) for pk in order_ids], created_by__isnull=False, status=Task.OPEN,
        ).values_list("source_id", flat=True)
    )


def _open_task_exists(staff, order, owner=None):
    tasks = Task.objects.filter(
        owner=staff, kind=Task.DELIVERY_PROBLEM, source_type=ORDER_TARGET_TYPE, source_id=str(order.pk),
        status=Task.OPEN,
    )
    return (tasks.filter(business_owner=owner) if owner is not None else tasks).exists()


def task_for_dispute(dispute):
    """A delivery dispute on an order with lines from a managed business tasks
    that business's account manager (once per order and business). The task
    names the order, never the customer or what they wrote."""
    if dispute.reason != Dispute.DELIVERY_ISSUE or dispute.order_id is None:
        return []
    created = []
    with transaction.atomic():
        # Lock the order so two concurrent disputes can't both pass the dedupe.
        Order.objects.select_for_update().get(pk=dispute.order_id)
        order = Order.objects.prefetch_related("items__listing__business_owner__account_manager").get(pk=dispute.order_id)
        owners = {i.listing.business_owner for i in order.items.all()}
        for owner in owners:
            created.extend(_task_for_owner(order, owner))
    return created


def _task_for_owner(order, owner):
    manager = owner.account_manager
    if manager is None or not manager.is_active or manager.is_suspended or _open_task_exists(manager, order, owner):
        return []
    return [create_task(
        manager, f"Delivery problem — Order #{order.pk} · {owner.display_name}"[:200],
        timezone.now() + TASK_DUE_IN,
        notes="A customer reported a problem with this delivery. The Delivery Manager is handling it; "
              "check with them before you tell the owner anything.",
        source=order, kind=Task.DELIVERY_PROBLEM, business=owner,
    )]


def flag_delivery_problem(scout, owner, order_id, note, *, request=None):
    """The account manager reports a delivery problem on one of the business's
    orders: every active Delivery Manager is notified and gets a task (once
    per order). Returns {"flagged": True, "already": bool, "told": n}."""
    note = (note or "").strip()
    if not note:
        raise DeliveryProblemError("Say what went wrong, in a sentence.")
    if len(note) > NOTE_MAX:
        raise DeliveryProblemError(f"Keep the note under {NOTE_MAX} characters.")
    order = business_orders(owner).filter(pk=order_id).first()
    if order is None:
        raise DeliveryProblemError("That order isn't one of this business's paid orders.", 404)
    managers = list(staff_holding(DELIVERY_MANAGE))
    if not managers:
        raise DeliveryProblemError("No Delivery Manager is on duty to take this. Tell Operations.", 409)
    name = owner.display_name
    title = f"Delivery problem — Order #{order.pk} · {name}"
    with transaction.atomic():
        Order.objects.select_for_update().get(pk=order.pk)  # serialise concurrent flags on this order
        fresh = [m for m in managers if not _open_task_exists(m, order)]
        for manager in fresh:
            create_task(
                manager, title[:200], timezone.now() + TASK_DUE_IN,
                notes=f"Flagged by {scout.full_name} for {name}: {note}",
                source=order, created_by=scout, kind=Task.DELIVERY_PROBLEM, business=owner,
            )
        if fresh:
            notify_staff_role(
                DELIVERY_MANAGE, "delivery_problem_flagged", f"Delivery problem: Order #{order.pk}",
                body=f"{name} · flagged by {scout.full_name}: {note}"[:300], link="tasks", icon="🚚",
            )
        record(
            scout, "delivery.problem_flagged", target_type=ORDER_TARGET_TYPE, target_id=order.pk,
            target_label=f"Order #{order.pk}",
            summary=f"Delivery problem flagged for {name}",
            after={"business_id": owner.pk, "note": note, "told": len(fresh)}, request=request,
        )
    return {"flagged": True, "already": not fresh, "told": len(fresh)}
