from rest_framework.permissions import BasePermission

from accounts.models import BusinessOwner


class IsListingOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return isinstance(request.user, BusinessOwner) and obj.business_owner_id == request.user.id


class IsHeroMediaOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return isinstance(request.user, BusinessOwner) and obj.business_owner_id == request.user.id


class IsListingPhotoOwner(BasePermission):
    """Object-level check for HeroSubmitView: the ListingPhoto's parent
    Listing must belong to the requesting BusinessOwner.
    """

    def has_object_permission(self, request, view, obj):
        return isinstance(request.user, BusinessOwner) and obj.listing.business_owner_id == request.user.id
