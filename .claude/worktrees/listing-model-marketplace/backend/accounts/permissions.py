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
