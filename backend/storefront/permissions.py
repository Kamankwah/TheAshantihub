"""MarketplaceOpen: appended after IsCustomer on every shopper buy endpoint. Before opening a Customer is refused
(403 code not_open); businesses, staff and allowlisted test customers pass. An unauthenticated caller still gets 401
first because IsAuthenticated precedes this in permission_classes."""
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from . import opening


class MarketplaceNotOpen(PermissionDenied):
    default_code = "not_open"

    def __init__(self, when):
        super().__init__(
            detail={"detail": opening.opening_message(when), "code": "not_open", "opens_at": when.isoformat()},
        )


class MarketplaceOpen(BasePermission):
    def has_permission(self, request, view):
        if opening.can_buy(request.user):
            return True
        raise MarketplaceNotOpen(opening.opens_at())
