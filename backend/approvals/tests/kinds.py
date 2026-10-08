"""Test-only approval kinds. Phase 1 ships the engine with no user-facing
kinds; phase 2 registers the first real ones (business.kyc, listing.create…)."""
from dataclasses import replace

from accounts.models import StaffUser
from approvals.registry import ApprovalKind


def _current(request):
    return {"full_name": StaffUser.objects.get(pk=request.target_id).full_name}


def _apply(request):
    StaffUser.objects.filter(pk=request.target_id).update(full_name=request.payload["full_name"])


RENAME_STAFF = ApprovalKind(
    key="test.rename_staff",
    label="Rename a staff member (test only)",
    pool_permission="kyc.approve",
    current_state=_current,
    apply=_apply,
    response_hours=24,
)


def _boom(request):
    raise RuntimeError("apply failed")


BROKEN_APPLY = replace(RENAME_STAFF, key="test.broken_apply", apply=_boom)
