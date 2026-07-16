from rest_framework.permissions import BasePermission

from .models import StaffUser


class HasRolePermission(BasePermission):
    def __init__(self, codename):
        self.codename = codename

    def has_permission(self, request, view):
        user = request.user
        if not isinstance(user, StaffUser):
            return False
        return user.role.permissions.filter(codename=self.codename).exists()


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
        return user.role.permissions.filter(codename__in=self.codenames).exists()
