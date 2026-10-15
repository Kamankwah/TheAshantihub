"""Shared pieces of the Super Admin People screens (SA-4): who is on the staff,
what state each person is in, and the permission set of a person read from
prefetched rows (so a list does not run three queries per row)."""
from django.db.models import Case, Exists, IntegerField, Max, OuterRef, Value, When
from django.utils import timezone
from rest_framework.pagination import PageNumberPagination

from accounts.models import Role, StaffTwoFactor

# The order the canvases list roles in.
ROLE_ORDER = [
    Role.SUPER_ADMIN, Role.OPERATIONS, Role.DELIVERY_MANAGER, Role.ACCOUNTANT, Role.MARKETING,
    Role.SUPPORT, Role.SCOUT, Role.DISPATCH, Role.PICKUP_DESK, Role.COSIGNER,
]
ROLE_LABELS = dict(Role.NAME_CHOICES)

# Roles that hold an approval or money decision: without 2-step sign-in they are
# the people the directory points out.
DECIDING_PERMISSIONS = ("kyc.approve", "escrow.release", "escrow.refund", "disputes.resolve_financial", "staff.manage")

ACTIVE, INVITED, INVITE_EXPIRED, SUSPENDED, DEACTIVATED = "active", "invited", "invite_expired", "suspended", "deactivated"
STATUSES = (ACTIVE, INVITED, INVITE_EXPIRED, SUSPENDED, DEACTIVATED)


class PeoplePagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


def role_rank():
    return Case(*[When(role__name=name, then=Value(i)) for i, name in enumerate(ROLE_ORDER)], default=Value(len(ROLE_ORDER)), output_field=IntegerField())


def with_directory_columns(queryset):
    """last_sign_in_at (newest session start) and has_two_step (a confirmed authenticator)."""
    return queryset.annotate(
        last_sign_in_at=Max("sessions__created_at"),
        has_two_step=Exists(StaffTwoFactor.objects.filter(staff=OuterRef("pk"), confirmed_at__isnull=False)),
    )


def status_of(staff, now=None):
    """Same order as StaffListSerializer.get_status: deactivated, suspended, then invite state."""
    now = now or timezone.now()
    if not staff.is_active:
        return DEACTIVATED
    if staff.is_suspended:
        return SUSPENDED
    if staff.invite_token is None:
        return ACTIVE
    if staff.invite_expires_at and staff.invite_expires_at < now:
        return INVITE_EXPIRED
    return INVITED


def effective(staff):
    """The staff member's effective permission codenames read from prefetched
    role__permissions, extra_permissions and revoked_permissions."""
    held = {p.codename for p in staff.role.permissions.all()} | {p.codename for p in staff.extra_permissions.all()}
    return held - {p.codename for p in staff.revoked_permissions.all()}


def two_step_label(staff):
    """on | off | required (Super Admin: 2-step is forced) | None for a pending invite."""
    if staff.invite_token is not None:
        return None
    if staff.has_two_step:
        return "on"
    return "off"
