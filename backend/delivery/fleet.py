"""Roster, profile and paper queries for the Delivery Manager's fleet screens. Everything is counted
from stored rows; a figure with no source is ``None`` (and the screen says so), never zero or a guess."""
from datetime import timedelta

from django.db.models import Count, F, Max, Q
from django.utils import timezone

from accounts.models import StaffSession, StaffUser
from accounts.phones import mask_phone
from orders.models import DeliveryAssignment

from . import employment, payloads, services
from . import cash
from .models import DeliveryZone, Offer, Rider, RiderDocument, ShiftSession, Vehicle

ROLLING_DAYS = 30
EXPIRING_DAYS = 30


def rider_status(rider, shift, on_job):
    staff = rider.staff
    if staff.invite_token is not None:
        return "invited"
    if staff.is_suspended or not staff.is_active:
        return "suspended"
    if shift is None:
        return "off_shift"
    if on_job:
        return "on_job"
    return "break" if shift.on_break else "on_shift"


STATUS_LABELS = {
    "invited": "Invited", "suspended": "Suspended", "off_shift": "Off shift", "on_job": "On a job", "break": "On a break", "on_shift": "Free",
}


def doc_summary(rider_docs, today):
    """Per-rider paper facts from already-loaded documents: required kinds missing, expiring in 30 days, expired, waiting."""
    ok, expiring, expired, waiting = set(), 0, 0, 0
    soonest = None
    for doc in rider_docs:
        if doc.status == RiderDocument.UPLOADED:
            waiting += 1
        if doc.status == RiderDocument.EXPIRED or (doc.status == RiderDocument.APPROVED and doc.expires_on and doc.expires_on < today):
            expired += 1
        elif doc.status == RiderDocument.APPROVED:
            ok.add(doc.kind)
            if doc.expires_on and (doc.expires_on - today).days <= EXPIRING_DAYS:
                expiring += 1
                soonest = min(soonest, doc.expires_on) if soonest else doc.expires_on
    missing = [k for k in services.REQUIRED_DOCUMENTS if k not in ok]
    return {"missing": missing, "expiring": expiring, "expired": expired, "waiting": waiting, "soonest_expiry": soonest}


def roster(now=None):
    """Every rider (activated or invited) with today's facts. A handful of queries, whatever the roster size."""
    now = now or timezone.now()
    today = timezone.localdate(now)
    since = now - timedelta(days=ROLLING_DAYS)
    riders = list(Rider.objects.select_related("staff", "staff__manager", "vehicle", "home_zone").prefetch_related("documents"))
    staff_ids = [r.staff_id for r in riders]
    shifts = {s.rider_id: s for s in ShiftSession.objects.filter(ended_at__isnull=True, rider__in=riders).select_related("zone")}
    on_job = set(DeliveryAssignment.objects.filter(dispatch__in=staff_ids, status__in=DeliveryAssignment.ACTIVE_STATUSES).values_list("dispatch_id", flat=True))
    per_staff = {}
    for row in DeliveryAssignment.objects.filter(dispatch__in=staff_ids).values("dispatch_id").annotate(
        today=Count("id", filter=Q(assigned_at__date=today)),
        delivered_today=Count("id", filter=Q(delivered_at__date=today)),
        failed_30=Count("id", filter=Q(failed_at__gte=since)),
        delivered_30=Count("id", filter=Q(delivered_at__gte=since)),
        deadline_30=Count("id", filter=Q(delivered_at__gte=since, deadline_at__isnull=False)),
        on_time_30=Count("id", filter=Q(delivered_at__gte=since, deadline_at__isnull=False, delivered_at__lte=F("deadline_at"))),
        last_job=Max("assigned_at"),
    ):
        per_staff[row["dispatch_id"]] = row
    offers = {}
    for row in Offer.objects.filter(rider__in=riders, offered_at__gte=since).exclude(status__in=(Offer.OFFERED, Offer.WITHDRAWN)).values("rider_id").annotate(
        answered=Count("id"), accepted=Count("id", filter=Q(status=Offer.ACCEPTED)),
    ):
        offers[row["rider_id"]] = row
    last_seen = {row["staff_id"]: row["at"] for row in StaffSession.objects.filter(staff__in=staff_ids).values("staff_id").annotate(at=Max("last_seen_at"))}
    rows = []
    for rider in riders:
        staff = rider.staff
        shift = shifts.get(rider.pk)
        stats = per_staff.get(staff.pk, {})
        docs = doc_summary(rider.documents.all(), today)
        status = rider_status(rider, shift, staff.pk in on_job)
        rows.append({
            "id": rider.pk, "staff_id": staff.pk, "full_name": staff.full_name, "email": staff.email, "status": status,
            "status_label": STATUS_LABELS[status], "vehicle_type": rider.vehicle_type,
            "vehicle": {"id": rider.vehicle_id, "plate": rider.vehicle.plate} if rider.vehicle_id else None,
            "home_zone": {"id": rider.home_zone_id, "name": rider.home_zone.name} if rider.home_zone_id else None,
            "jobs_today": stats.get("today", 0), "delivered_today": stats.get("delivered_today", 0),
            # On time = delivered by the stored deadline; only jobs that had a deadline count, so with no
            # time limits set yet this is "of 0" and the screen shows "no data yet".
            "on_time_30d": {"on_time": stats.get("on_time_30", 0), "of": stats.get("deadline_30", 0)},
            "could_not_deliver_30d": stats.get("failed_30", 0), "delivered_30d": stats.get("delivered_30", 0),
            "acceptance_30d": {"accepted": offers.get(rider.pk, {}).get("accepted", 0), "of": offers.get(rider.pk, {}).get("answered", 0)},
            "cash_held": str(cash.held(staff.pk, rider.pk)) if cash.cod_offered() else None,
            "location": {"last_fix_at": shift.last_fix_at, "age_seconds": services.fix_age_seconds(shift, now), "stale": services.is_stale(shift, now)} if shift else None,
            "papers": docs, "job_hold": rider.job_hold, "suspended": staff.is_suspended, "suspension_reason": staff.suspension_reason if staff.is_suspended else None,
            "suspension_source": rider.suspension_source, "last_seen_at": last_seen.get(staff.pk),
            "invited": staff.invite_token is not None,
        })
    return rows


def profile(rider, now=None):
    """One rider's page: performance, papers, vehicle, recent jobs, devices."""
    now = now or timezone.now()
    today = timezone.localdate(now)
    staff = rider.staff
    row = next((r for r in roster(now) if r["id"] == rider.pk), None)
    jobs = DeliveryAssignment.objects.filter(dispatch=staff).select_related("order", "order__customer").order_by("-assigned_at")[:15]
    sessions = StaffSession.objects.filter(staff=staff, revoked_at__isnull=True).order_by("-last_seen_at")
    return {
        "rider": row,
        "staff": {
            "id": staff.pk, "full_name": staff.full_name, "email": staff.email, "phone": staff.phone,
            "manager": payloads.person(staff.manager), "activated_at": staff.activated_at, "start_date": staff.start_date,
            "invite_note": rider.invite_note, "first_shift_date": rider.first_shift_date,
        },
        "documents": [payloads.document_row(d) for d in rider.documents.select_related("reviewed_by")],
        "required": list(services.REQUIRED_DOCUMENTS),
        "vehicle": vehicle_row(rider.vehicle) if rider.vehicle_id else None,
        "recent_jobs": [
            {
                "id": a.pk, "order_id": a.order_id, "status": a.status, "status_label": a.get_status_display(), "assigned_at": a.assigned_at,
                "delivered_at": a.delivered_at, "address": a.order.delivery_address, "flagged": a.events.filter(flagged=True).exists(),
            } for a in jobs
        ],
        "devices": [
            {"id": s.pk, "device_label": s.device_label, "last_seen_at": s.last_seen_at, "signed_in_at": s.created_at}
            for s in sessions
        ],
        "employment": employment.row(rider),
        "pay": None,  # no rate card or pay record yet: the screen says rider pay arrives with Accounting
        "today": today,
    }


def vehicle_row(vehicle):
    today = timezone.localdate()

    def paper(label, day):
        return {"label": label, "expires_on": day, "days_left": (day - today).days if day else None}

    holders = [r for r in vehicle.current_riders.all()]
    return {
        "id": vehicle.pk, "plate": vehicle.plate, "vehicle_type": vehicle.vehicle_type, "vehicle_type_label": vehicle.get_vehicle_type_display(),
        "description": vehicle.description, "owner_kind": vehicle.owner_kind, "owner_label": vehicle.get_owner_kind_display(),
        "status": vehicle.status, "rider": {"id": holders[0].pk, "full_name": holders[0].staff.full_name} if holders else None,
        "papers": [paper("Registration", vehicle.registration_expires), paper("Roadworthy", vehicle.roadworthy_expires), paper("Insurance", vehicle.insurance_expires)],
    }


def zone_row(zone, riders_by_zone=None):
    return {
        "id": zone.pk, "name": zone.name, "boundary": zone.boundary, "centre_lat": zone.centre_lat, "centre_lng": zone.centre_lng,
        "express_offered": zone.express_offered, "active": zone.active, "updated_at": zone.updated_at,
        "riders": (riders_by_zone or {}).get(zone.pk, []), "area_km2": ring_area_km2(zone.boundary),
    }


def ring_area_km2(ring):
    """Approximate area of a drawn boundary (equirectangular), or None when it is not drawn."""
    if not isinstance(ring, list) or len(ring) < 3:
        return None
    import math

    lat0 = sum(p[1] for p in ring) / len(ring)
    kx = 111.320 * math.cos(math.radians(lat0))
    ky = 110.574
    pts = [(p[0] * kx, p[1] * ky) for p in ring]
    area = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        area += x1 * y2 - x2 * y1
    return round(abs(area) / 2, 2)
