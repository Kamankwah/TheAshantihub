from rest_framework.permissions import BasePermission

from accounts.models import BusinessOwner


class IsListingOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return isinstance(request.user, BusinessOwner) and obj.business_owner_id == request.user.id
