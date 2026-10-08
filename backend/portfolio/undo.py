"""Owner undo — "This wasn't me" (staff phase 2A, spec S4).

For 7 days after a scout's change applied, the business owner can revert it.
The revert uses the approval request's `before` snapshot and restores only
what still holds the applied value; anything changed again since is left for
Operations (`undo_failed`). Every undo opens an "Owner said “This wasn't me”"
fraud case about the scout and tells the scout and the scout's manager.
"""
import logging
from datetime import timedelta

from django.core.files.storage import default_storage
from django.db import transaction
from django.http import Http404
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.phones import filter_by_phone
from activity.services import record
from approvals.services import _lock_target_key
from fraud.models import FraudFlag
from fraud.services import raise_flag
from listings.models import Listing, ListingPhoto, Zone
from notifications.services import notify_staff

from . import proposals
from .models import AppliedChange

logger = logging.getLogger(__name__)

OWNER_CHANGES_WINDOW = timedelta(days=30)
WINDOW_PASSED = "The 7 days to undo this have passed — contact AshantiHub Support."
ALREADY_UNDONE = "You've already undone this."
PARTLY_REVERTED = "Some details changed again since — Operations will sort them out."
UNDO_LISTING_REASON = "Removed by the owner within 7 days (“This wasn't me”)."
CANNOT_UNDO = "This change can't be undone here — contact AshantiHub Support."


class UndoError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def owner_changes(owner, now=None):
    """The changes a business owner sees: applied in the last 30 days, newest first."""
    now = now or timezone.now()
    return (
        AppliedChange.objects.filter(business_owner=owner, applied_at__gte=now - OWNER_CHANGES_WINDOW)
        .select_related("approval__maker")
        .order_by("-applied_at", "-id")
    )


def _can_restore(business, field, value):
    """A before-value that now clashes with another business stays unrestored."""
    if field == "login_phone":
        return bool(value) and not filter_by_phone(
            BusinessOwner.objects.exclude(pk=business.pk), "login_phone", value
        ).exists()
    if field == "email" and value:
        return not BusinessOwner.objects.filter(email__iexact=value).exclude(pk=business.pk).exists()
    if field == "zone_id" and value is not None:
        return Zone.objects.filter(pk=value).exists()
    return True


def _revert_update(change, approval, owner):
    business = BusinessOwner.objects.select_for_update().get(pk=owner.pk)
    profile = BusinessOwnerProfile.objects.select_for_update().get(business_owner_id=owner.pk)
    applied = approval.payload.get("fields") or {}
    before = approval.before if isinstance(approval.before, dict) else {}

    def unchanged(field):
        current = proposals.current_value(business, profile, field)
        return proposals.jsonable(current) == proposals.jsonable(applied[field])

    pin = [field for field in proposals.PIN_FIELDS if field in applied]
    pin_unchanged = all(unchanged(field) for field in pin)  # the pin goes back whole or not at all
    skipped, owner_fields, profile_fields = [], [], []
    for field in proposals.ordered_fields(applied):
        still_applied = pin_unchanged if field in proposals.PIN_FIELDS else unchanged(field)
        if not still_applied or not _can_restore(business, field, before.get(field)):
            skipped.append(field)
            continue
        value = proposals.model_value(field, before.get(field))
        if field in proposals.OWNER_FIELDS:
            setattr(business, field, value)
            owner_fields.append(field)
        else:
            setattr(profile, field, value)
            profile_fields.append(field)
    if pin and pin_unchanged and "location_set_by_before" in change.result:
        profile.location_set_by = change.result["location_set_by_before"] or ""
        set_at = change.result.get("location_set_at_before")
        profile.location_set_at = parse_datetime(set_at) if set_at else None
        profile_fields += ["location_set_by", "location_set_at"]
    if owner_fields:
        business.save(update_fields=owner_fields)
    if profile_fields:
        profile.save(update_fields=profile_fields)
    return [proposals.FIELD_LABELS[field] for field in skipped]


def _revert_listing(change, approval, owner):
    listing = (
        Listing.objects.select_for_update()
        .filter(pk=change.result.get("listing_id"), business_owner_id=owner.pk)
        .first()
    )
    if listing is not None:
        listing.status = Listing.REJECTED
        listing.rejection_reason = UNDO_LISTING_REASON
        listing.save(update_fields=["status", "rejection_reason"])
    return []


def _delete_files(names):
    for name in names:
        try:
            default_storage.delete(name)
        except Exception:
            logger.exception("Couldn't delete undone photo %s", name)


def _revert_photos(change, approval, owner):
    listing = (
        Listing.objects.select_for_update()
        .filter(pk=approval.payload.get("listing_id"), business_owner_id=owner.pk)
        .first()
    )
    if listing is None:
        return []
    photos = list(ListingPhoto.objects.filter(pk__in=change.result.get("photo_ids") or [], listing=listing))
    files = [photo.image.name for photo in photos]
    ListingPhoto.objects.filter(pk__in=[photo.pk for photo in photos]).delete()
    main = change.result.get("main_photo")
    if change.result.get("set_main_photo") and main and listing.main_photo.name == main:
        files.append(main)
        listing.main_photo = None
        listing.save(update_fields=["main_photo"])
    transaction.on_commit(lambda: _delete_files(files))
    return []


_REVERTERS = {
    proposals.BUSINESS_UPDATE_KEY: _revert_update,
    proposals.LISTING_CREATE_KEY: _revert_listing,
    proposals.LISTING_PHOTOS_KEY: _revert_photos,
}


def _when(moment):
    return timezone.localtime(moment).strftime("%d %b %Y, %H:%M")


def _raise_case(change, approval, business, maker, not_reverted, now):
    name = business.display_name
    decider = approval.decided_by.full_name if approval.decided_by_id else "nobody recorded"
    detail = (
        f"The owner of {name} pressed “This wasn't me” on a change {maker.full_name} made "
        f"(approved by {decider}, applied {_when(change.applied_at)})."
    )
    if not_reverted:
        detail += " Some details had changed again since and were left as they are — sort them out by hand."
    else:
        detail += " The change was fully reverted."
    evidence = [
        f"Change: {change.summary}",
        f"Made by: {maker.full_name}",
        f"Approved by: {decider}",
        f"Applied: {_when(change.applied_at)}",
        f"Undone: {_when(now)}",
    ]
    if not_reverted:
        evidence.append(f"Not reverted: {', '.join(not_reverted)}")
    return raise_flag(
        FraudFlag.OWNER_OBJECTED, title=f"{name}: owner undid “{change.summary}”"[:200], detail=detail,
        evidence=evidence, business_owner=business, staff_subject=maker, source=FraudFlag.OWNER,
        dedupe_key=f"undo:{change.pk}",
    )


def _tell_staff(change, business, maker):
    name = business.display_name
    notify_staff(
        maker, "account_manager_change_undone", f"{name} undid your change"[:200],
        body=f"{change.summary}. The owner pressed “This wasn't me”, so Operations will look into it.",
        link=f"portfolio/{business.pk}", icon="↩️",
    )
    manager = maker.manager
    if manager is not None and manager.pk != maker.pk:
        notify_staff(
            manager, "account_manager_change_undone", f"{name} undid {maker.full_name}'s change"[:200],
            body=f"{change.summary}. A fraud case is open in Fraud cases.", link="fraud-cases", icon="↩️",
        )


def undo_change(change_id, owner, *, http_request=None):
    """Revert one of this owner's applied changes. Http404 for another owner's
    change; UndoError after the 7 days or a second time."""
    with transaction.atomic():
        change = AppliedChange.objects.select_for_update().filter(pk=change_id, business_owner_id=owner.pk).first()
        if change is None:
            raise Http404("No such change.")
        if change.undone_at is not None:
            raise UndoError(ALREADY_UNDONE)
        now = timezone.now()
        if now > change.undo_until:
            raise UndoError(WINDOW_PASSED)
        revert = _REVERTERS.get(change.kind)
        if revert is None:
            raise UndoError(CANNOT_UNDO)
        approval = change.approval
        _lock_target_key(approval.target_type, approval.target_id)
        not_reverted = revert(change, approval, owner)
        business = BusinessOwner.objects.select_related("profile").get(pk=owner.pk)
        maker = approval.maker
        flag = _raise_case(change, approval, business, maker, not_reverted, now)
        change.undone_at = now
        change.undo_failed = PARTLY_REVERTED if not_reverted else ""
        change.fraud_flag_id = flag.pk
        change.save(update_fields=["undone_at", "undo_failed", "fraud_flag_id"])
        _tell_staff(change, business, maker)
        record(
            business, "business.change_undone", target=business,
            after={
                "change_id": change.pk, "kind": change.kind, "summary": change.summary,
                "reverted": "partly" if not_reverted else "fully", "not_reverted": not_reverted,
                "fraud_flag_id": flag.pk,
            },
            request=http_request,
        )
    return change
