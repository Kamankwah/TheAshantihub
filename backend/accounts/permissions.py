from django.db.models import Q
from rest_framework.permissions import BasePermission

from .models import StaffUser


class HasRolePermission(BasePermission):
    """Both this and HasAnyRolePermission read
    StaffUser.effective_permission_codenames() — role permissions plus
    per-staffer grants, minus per-staffer revocations (punch-list item 9).
    They must stay on that same helper as GET /api/accounts/me/'s
    `permissions` list, or the UI would gate on a different set than the
    server enforces and render buttons that 403.
    """

    def __init__(self, codename):
        self.codename = codename

    def has_permission(self, request, view):
        user = request.user
        if not isinstance(user, StaffUser):
            return False
        return self.codename in user.effective_permission_codenames()


class HasAnyRolePermission(BasePermission):
    """Grants access if the staffer holds ANY of the given codenames — e.g.
    a "manage" view viewable by either the role that proposes changes or the
    role that approves them. No existing view composed permissions this way
    before the event-pricing-tier propose/approve workflow.
    """

    def __init__(self, *codenames):
        self.codenames = codenames

    def has_permission(self, request, view):
        user = request.user
        if not isinstance(user, StaffUser):
            return False
        return bool(set(self.codenames) & user.effective_permission_codenames())


def can_manage_staff(user):
    """Full staff management (Super Admin's staff.manage), as opposed to a
    team manager's staff.invite_team, which is limited to direct reports."""
    return isinstance(user, StaffUser) and "staff.manage" in user.effective_permission_codenames()


class IsStaff(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, StaffUser)


def staff_holding(codename):
    """Active, unsuspended staff whose *effective* permissions include
    `codename` — the same set HasRolePermission enforces."""
    return (
        StaffUser.objects.filter(is_active=True, is_suspended=False)
        .filter(Q(role__permissions__codename=codename) | Q(extra_permissions__codename=codename))
        .exclude(revoked_permissions__codename=codename)
        .distinct()
    )
