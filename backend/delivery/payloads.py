"""JSON shapes for the delivery API, built by hand so each audience gets exactly its fields.

Privacy rules held here:
* A rider never gets the pickup or drop code (the business and the customer hold them).
* A rider sees the customer's first name and last initial, the delivery address and (through the
  logged ``call`` action only) the delivery phone.
* A manager's job detail shows the customer's phone masked; no one sees a code but its owner.
* A paper's number leaves the server only as ``mask_number`` (last four characters)."""
from django.utils import timezone

from . import services
from .models import DeliveryEvent, RiderDocument

STEP_ORDER = (
    DeliveryEvent.ACCEPTED, DeliveryEvent.ARRIVED_PICKUP, DeliveryEvent.PICKED_UP,
    DeliveryEvent.ARRIVED_DROP, DeliveryEvent.DELIVERED,
)
STEP_LABELS = dict(DeliveryEvent.STEP_CHOICES)


def mask_number(value, keep=4):
    """"•••• 1234". A value no longer than ``keep`` is masked entirely."""
    if not value:
        return None
    value = str(value).strip()
    return "•" * 4 if len(value) <= keep else f"•••• {value[-keep:]}"


def mask_phone(value):
    return mask_number(value)


def first_name_and_initial(full_name):
    parts = (full_name or "").split()
    if not parts:
        return ""
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."


def person(staff):
    if staff is None:
        return None
    return {"id": staff.pk, "full_name": staff.full_name}


def payment_label(order):
    """The only payment fact there is: an order is paid or not, and payments are simulated until a
    payment provider is connected. There is no cash-on-delivery option at checkout yet."""
    return {"method": "prepaid" if order.status == order.PAID else order.status, "label": "Paid online (simulated)" if order.status == order.PAID else order.get_status_display(), "cash_due": None}


def event_row(event):
    return {
        "id": event.pk, "step": event.step, "label": STEP_LABELS.get(event.step, event.step), "at": event.at,
        "lat": event.lat, "lng": event.lng, "accuracy_m": event.accuracy_m, "distance_m": event.distance_m,
        "flagged": event.flagged, "by": person(event.by), "note": event.note,
    }


def steps_for(assignment, events=None):
    """The five checkpoints with the stamp each got (None when it has not happened or was not stamped)."""
    events = list(events if events is not None else assignment.events.all())
    latest = {}
    for event in events:
        latest[event.step] = event
    rows = []
    for step in STEP_ORDER:
        event = latest.get(step)
        rows.append({"step": step, "label": STEP_LABELS[step], "done": event is not None, "event": event_row(event) if event else None})
    return rows


def wait_info(assignment, now=None):
    """The 10-minute wait at the customer's door, from the arrival stamp. Seconds left is never negative."""
    now = now or timezone.now()
    if assignment.status != assignment.AT_CUSTOMER or assignment.arrived_drop_at is None:
        return None
    elapsed = int((now - assignment.arrived_drop_at).total_seconds())
    limit = int(services.WAIT_LIMIT.total_seconds())
    return {"started_at": assignment.arrived_drop_at, "elapsed_seconds": elapsed, "limit_seconds": limit, "left_seconds": max(0, limit - elapsed)}


def pickup_block(order):
    """Pickup point(s): one entry per business (the first is the one the rider drives to in v1)."""
    seen = {}
    for item in sorted(order.items.all(), key=lambda i: i.pk):
        owner = item.listing.business_owner
        entry = seen.get(owner.pk)
        if entry is None:
            pin = services.pickup_stop(order) if not seen else (None, None, None)
            entry = seen[owner.pk] = {
                "business_name": getattr(owner, "display_name", None) or owner.full_name, "phone": item.listing.contact_phone,
                "lat": pin[0], "lng": pin[1], "items": [],
            }
        entry["items"].append(f"{item.listing.name} × {item.quantity}")
    rows = list(seen.values())
    return {"primary": rows[0] if rows else None, "all": rows, "multi_pickup": len(rows) > 1}


def rider_job(assignment, now=None):
    """What the rider app shows for one of the rider's own jobs."""
    order = assignment.order
    drop = services.drop_stop(order)
    pickups = pickup_block(order)
    return {
        "id": assignment.pk, "order_id": order.pk, "status": assignment.status, "status_label": assignment.get_status_display(),
        "assignment_mode": assignment.assignment_mode, "assigned_at": assignment.assigned_at,
        "accepted_at": assignment.accepted_at, "arrived_pickup_at": assignment.arrived_pickup_at, "picked_up_at": assignment.picked_up_at,
        "arrived_drop_at": assignment.arrived_drop_at, "delivered_at": assignment.delivered_at, "failed_at": assignment.failed_at,
        "failed_reason": assignment.failed_reason, "deadline_at": assignment.deadline_at,
        "customer_name": first_name_and_initial(order.customer.full_name), "delivery_address": order.delivery_address,
        "delivery_lat": drop[0], "delivery_lng": drop[1], "pickup": pickups["primary"], "pickups": pickups["all"],
        "multi_pickup": pickups["multi_pickup"], "payment": payment_label(order), "wait": wait_info(assignment, now),
        "steps": steps_for(assignment), "calls": assignment.calls.filter(kind="rider_to_customer").count(),
        "flagged": any(e.flagged for e in assignment.events.all()), "rider_note": assignment.rider_note,
        "pickup_attempts_left": max(0, services.CODE_ATTEMPT_LIMIT - assignment.pickup_code_attempts),
        "drop_attempts_left": max(0, services.CODE_ATTEMPT_LIMIT - assignment.drop_code_attempts),
        "photos": assignment.photos.count(),
    }


def shift_block(shift, now=None):
    if shift is None:
        return None
    return {
        "id": shift.pk, "started_at": shift.started_at, "on_break": shift.on_break, "zone": shift.zone.name if shift.zone_id else None,
        "last_lat": shift.last_lat, "last_lng": shift.last_lng, "last_fix_at": shift.last_fix_at,
        "fix_age_seconds": services.fix_age_seconds(shift, now), "stale": services.is_stale(shift, now),
    }


def document_row(doc, *, full=False):
    today = timezone.localdate()
    days = (doc.expires_on - today).days if doc.expires_on else None
    return {
        "id": doc.pk, "kind": doc.kind, "kind_label": doc.get_kind_display(), "status": doc.status, "status_label": doc.get_status_display(),
        "number_masked": mask_number(doc.number), "expires_on": doc.expires_on, "days_left": days, "uploaded_at": doc.uploaded_at,
        "reviewed_by": person(doc.reviewed_by), "reviewed_at": doc.reviewed_at, "reject_reason": doc.reject_reason,
        "required": doc.kind in services.REQUIRED_DOCUMENTS,
    }
