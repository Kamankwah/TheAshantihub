"""Ashanti Direct: the company's own shop, an ordinary BusinessOwner flagged `is_company` and run by Operations.

Every read of that flag goes through this module, so ledger, fee, wallet and payout code never branches on it: Direct's
money behaves exactly like any other business's. Plan 3 reads `is_direct(owner)` too.
"""
from django.db.models import Q

from .models import BusinessOwner, StaffUser

PERMISSION = "direct.operate"


def ashanti_direct():
    """The one company owner, or LookupError when `ensure_ashanti_direct` has not run."""
    try:
        return BusinessOwner.objects.select_related("profile").get(is_company=True)
    except BusinessOwner.DoesNotExist:
        raise LookupError("Ashanti Direct has not been created yet.") from None


def is_direct(owner):
    """True for the company's own business."""
    return isinstance(owner, BusinessOwner) and bool(owner.is_company)


def is_operator(staff):
    """True for a staff member who may run Ashanti Direct (permission `direct.operate`, effective: role + grants - revokes)."""
    return isinstance(staff, StaffUser) and PERMISSION in staff.effective_permission_codenames()


def direct_q(prefix=""):
    """A Q matching rows of the company business, for a field path such as "business_owner__"."""
    return Q(**{f"{prefix}is_company": True})
