"""Prospects (spec S5): businesses a scout has met but not registered. The
follow-up date keeps one open Task in step; registering a prospect links it,
so its visits and calls stay on the business's record.

record() is always the LAST thing in a transaction."""
from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from accounts.phones import normalize_gh_phone, phone_key
from activity.services import record
from calls.models import CallLog
from portfolio import checks
from staff_tasks.models import Task
from staff_tasks.services import create_task

from .models import Prospect, VisitCheckIn
from .services import VisitError

PHONE_TAKEN = "This phone number already belongs to another business."
OWN_PHONE = "You already have a prospect with this phone number."
FOLLOW_UP_PAST = "Pick a follow-up time in the future."
REGISTERED = "This prospect is registered, so it can't be changed here."
OPEN_STATUSES = (Prospect.NEW, Prospect.INTERESTED, Prospect.FOLLOW_UP)


def masked_phone(raw):
    """"024 *** 118": the first digits and the last three, never the whole number."""
    key = phone_key(raw)
    return f"0{key[:2]} *** {key[-3:]}" if key else ""


def with_last_visit(queryset):
    return queryset.select_related("zone").annotate(
        last_visit_at=Max("visits__checked_in_at", filter=Q(visits__status=VisitCheckIn.DONE)),
    )


def _clean_phone(raw, *, exclude_pk=None, scout=None):
    try:
        phone = normalize_gh_phone(raw)
    except ValueError as exc:
        raise VisitError(str(exc)) from exc
    if checks.exact_duplicates(phone=phone):
        raise VisitError(PHONE_TAKEN, 400, "phone_taken")
    mine = Prospect.objects.filter(scout=scout).exclude(status=Prospect.REGISTERED)
    if exclude_pk is not None:
        mine = mine.exclude(pk=exclude_pk)
    if mine.filter(phone=phone).exists():
        raise VisitError(OWN_PHONE, 400, "own_phone")
    return phone


def _check_follow_up(value, current):
    if value is not None and value != current and value <= timezone.now():
        raise VisitError(FOLLOW_UP_PAST)


def sync_follow_up(prospect):
    """Keep the prospect's one open follow-up Task matching next_follow_up_at:
    created, moved, or cancelled (a closed or registered prospect has none)."""
    task = prospect.follow_up_task
    if task is not None and task.status != Task.OPEN:
        task = None
    wanted = prospect.next_follow_up_at is not None and prospect.status in OPEN_STATUSES
    if wanted:
        title = f"Follow up: {prospect.name}"[:200]
        if task is None:
            task = create_task(prospect.scout, title, prospect.next_follow_up_at, source=prospect, created_by=prospect.scout)
            prospect.follow_up_task = task
            prospect.save(update_fields=["follow_up_task"])
        elif task.due_at != prospect.next_follow_up_at or task.title != title:
            task.due_at, task.title = prospect.next_follow_up_at, title
            task.save(update_fields=["due_at", "title"])
    elif task is not None:
        task.status = Task.CANCELLED
        task.save(update_fields=["status"])


def create_prospect(scout, data, *, request=None):
    phone = _clean_phone(data["phone"], scout=scout)
    _check_follow_up(data.get("next_follow_up_at"), None)
    status = data.get("status") or Prospect.NEW
    with transaction.atomic():
        prospect = Prospect.objects.create(
            scout=scout, name=data["name"], phone=phone, zone=data.get("zone"), note=data.get("note", ""),
            status=status, next_follow_up_at=None if status == Prospect.NOT_INTERESTED else data.get("next_follow_up_at"),
        )
        sync_follow_up(prospect)
        record(scout, "prospect.create", target=prospect,
               after={"name": prospect.name, "status": prospect.status}, request=request)
    return prospect


def update_prospect(prospect, data, *, request=None):
    scout = prospect.scout
    changed = []
    with transaction.atomic():
        locked = Prospect.objects.select_for_update().get(pk=prospect.pk)
        if locked.status == Prospect.REGISTERED:
            raise VisitError(REGISTERED, 409, "registered")
        before = {"status": locked.status}
        if "phone" in data:
            if phone_key(data["phone"]) != phone_key(locked.phone):
                locked.phone = _clean_phone(data["phone"], exclude_pk=locked.pk, scout=scout)
                changed.append("phone")
        for field in ("name", "note", "zone", "status"):
            if field in data and getattr(locked, field if field != "zone" else "zone") != data[field]:
                setattr(locked, field, data[field])
                changed.append(field)
        if "next_follow_up_at" in data:
            _check_follow_up(data["next_follow_up_at"], locked.next_follow_up_at)
            locked.next_follow_up_at = data["next_follow_up_at"]
            changed.append("next_follow_up_at")
        if locked.status == Prospect.NOT_INTERESTED:
            locked.next_follow_up_at = None
        if data.get("lat") is not None and data.get("lng") is not None:
            locked.lat, locked.lng = data["lat"], data["lng"]
            locked.accuracy_m = None  # a pin placed by hand has no accuracy
            changed.append("pin")
        locked.save()
        sync_follow_up(locked)
        record(scout, "prospect.update", target=locked, before=before,
               after={"status": locked.status, "changed": changed}, request=request)
    return locked


def registrable(scout, prospect_id):
    """The scout's own, not yet registered prospect (locked), else None."""
    return Prospect.objects.select_for_update().filter(pk=prospect_id, scout=scout).exclude(
        status=Prospect.REGISTERED,
    ).first()


def link_registration(prospect, owner, business_name):
    """Registering a prospect: it becomes registered, its visits move onto the
    business and its calls are filed under the business. The caller records
    the activity event (business.registered), last."""
    prospect.status = Prospect.REGISTERED
    prospect.registered_business = owner
    prospect.registered_at = timezone.now()
    prospect.next_follow_up_at = None
    prospect.save(update_fields=["status", "registered_business", "registered_at", "next_follow_up_at"])
    sync_follow_up(prospect)
    VisitCheckIn.objects.filter(prospect=prospect, business_owner__isnull=True).update(business_owner=owner)
    CallLog.objects.filter(related_type="prospect", related_id=str(prospect.pk), staff=prospect.scout).update(
        related_type="business_owner", related_id=str(owner.pk), related_label=business_name[:200],
    )
