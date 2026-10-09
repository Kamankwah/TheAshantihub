"""Portfolio domain services. Nothing here calls activity.services.record():
callers record (last, in their own transaction)."""
from django.db import transaction
from django.utils import timezone

from accounts.models import BusinessOwner

from .models import AccountManagerAssignment


def assign_account_manager(business_owner, scout, *, by, reason):
    """Make `scout` the business's account manager and keep the history: the
    open assignment (if any) ends now and the new one starts at the same
    moment. `scout=None` only ends the open assignment and clears
    `account_manager`. Returns the new assignment, or None for `scout=None`.
    Callers validate `reason` (at most 300 characters)."""
    with transaction.atomic():
        # One reassignment of a business at a time: ending the open row and
        # inserting the new one must not interleave with another caller's.
        BusinessOwner.objects.select_for_update().only("pk").get(pk=business_owner.pk)
        now = timezone.now()
        AccountManagerAssignment.objects.filter(
            business_owner=business_owner, ended_at__isnull=True,
        ).update(ended_at=now)
        assignment = None
        if scout is not None:
            assignment = AccountManagerAssignment.objects.create(
                business_owner=business_owner, scout=scout, assigned_by=by,
                reason=(reason or "").strip()[:300], started_at=now,
            )
        business_owner.account_manager = scout
        business_owner.save(update_fields=["account_manager"])
    return assignment


def approver_name(approval):
    """Who a just-submitted request waits for, for "Sent to …": the maker's
    manager by name, otherwise the Operations pool or a Super Admin. None when
    there is no request (a Super Admin's own registration)."""
    from approvals.models import ApprovalRequest

    if approval is None:
        return None
    if approval.stage == ApprovalRequest.MANAGER and approval.assigned_to is not None:
        return approval.assigned_to.full_name
    if approval.stage == ApprovalRequest.POOL:
        return "Operations"
    return "Super Admin"
