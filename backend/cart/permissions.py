from rest_framework.permissions import BasePermission

from accounts.models import Customer


class IsCartItemOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return isinstance(request.user, Customer) and obj.cart.customer_id == request.user.id
