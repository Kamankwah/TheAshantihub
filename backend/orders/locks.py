"""The one place a DeliveryAssignment row is locked, and the canonical lock order every write path follows.

Canonical order (Plan 7F-E; spec W7, extended). A transaction that locks several of these takes them in this order,
skipping any it does not need, and never goes back for an earlier one:
    1. the approval or dispute row the action works from (approvals, disputes),
    2. the Order row (lock_order),
    3. its OrderFeeSnapshot rows (by pk),
    4. its DeliveryAssignment row (lock_assignment / lock_job),
    5. the assignment's PickupStop rows,
    6. the Rider row (of=("self",), never the staff row),
    7. every ledger Account row, in one sorted pass (ledger.posting.lock),
    8. last, the activity-chain lock (activity.services.record; the staff-write middleware records after the view).

Why the Order row comes before the assignment: a delivery step saves the Order's delivery_status
(DeliveryAssignment.sync_order, orders.views._sync_order_delivery_status) while a refund locks the Order row first and
then reads the assignment (ledger.refunds.refund_order, ledger.riders.rider_for_settle). With the assignment locked first
the two cycle and Postgres aborts one with `deadlock detected`.

Write paths that use it: the rider's steps (delivery.views_rider._StepView via RiderView.job(lock=True)), the older
panel's pickup and deliver (orders.views.DeliveryPickupView, DeliveryDeliverView), the manager's flag decision, code
unlock and stop skip (delivery.views_live), every assignment (delivery.services.assign: orders.views.AssignDispatchView,
delivery.dispatching.accept_offer and force_assign) and the refund (ledger.refunds.refund_order, ledger.riders
.rider_for_settle). A path that never writes the Order row cannot deadlock with a refund, but still locks through here
so the rule stays single (ledger.tests.test_lock_order checks no other module locks the assignment row)."""
from django.http import Http404

from .models import DeliveryAssignment, Order


class LockOrderError(RuntimeError):
    """A delivery assignment row was asked for before its order row was locked."""


def lock_order(order_id):
    """Lock and return the Order row (only that row). Raises Order.DoesNotExist."""
    order = Order.objects.select_for_update(of=("self",)).get(pk=order_id)
    order._row_locked = True
    return order


def lock_assignment(order, *, dispatch_id=None, select_related=()):
    """Lock and return `order`'s delivery assignment (filtered to `dispatch_id` when given), or None. `order` must come
    from lock_order. The returned row's `order` is that same instance, so sync_order saves the row already locked."""
    if not getattr(order, "_row_locked", False):
        raise LockOrderError("Lock the order row before its delivery assignment")
    rows = DeliveryAssignment.objects.select_for_update(of=("self",)).filter(order_id=order.pk)
    if dispatch_id is not None:
        rows = rows.filter(dispatch_id=dispatch_id)
    if select_related:
        rows = rows.select_related(*select_related)
    assignment = rows.first()
    if assignment is not None:
        assignment.order = order
    return assignment


def lock_job(pk, *, dispatch_id=None, select_related=()):
    """Lock assignment `pk` (and first its order row). `dispatch_id` limits it to that rider's job. Raises
    DeliveryAssignment.DoesNotExist when it is gone or not that rider's. Never prefetches the stops (a step may create
    them during the request)."""
    order_id = DeliveryAssignment.objects.filter(pk=pk).values_list("order_id", flat=True).first()  # never changes
    if order_id is None:
        raise DeliveryAssignment.DoesNotExist
    try:
        order = lock_order(order_id)
    except Order.DoesNotExist:
        raise DeliveryAssignment.DoesNotExist from None
    assignment = lock_assignment(order, dispatch_id=dispatch_id, select_related=select_related)
    if assignment is None or assignment.pk != pk:
        raise DeliveryAssignment.DoesNotExist
    return assignment


def lock_job_or_404(pk, *, dispatch_id=None, select_related=()):
    try:
        return lock_job(pk, dispatch_id=dispatch_id, select_related=select_related)
    except DeliveryAssignment.DoesNotExist:
        raise Http404 from None
