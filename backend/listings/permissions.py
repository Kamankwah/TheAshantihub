from django.http import Http404
from rest_framework.permissions import BasePermission

from accounts import direct
from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission


class IsListingOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return isinstance(request.user, BusinessOwner) and obj.business_owner_id == request.user.id


class IsListingOwnerOrDirectOperator(BasePermission):
    """The owner views' gate. A view's `scope` says who is acting: "mine" is the signed-in business owner on their own
    listing; "direct" is a staff member holding `direct.operate` on Ashanti Direct's listing. A business on a direct
    URL, or staff on an owner URL, is refused (403); a listing of anyone but Direct on a direct URL is a 404, so a
    partner's listing is never confirmed to exist."""

    def has_permission(self, request, view):
        if getattr(view, "scope", "mine") == "direct":
            return HasRolePermission(direct.PERMISSION).has_permission(request, view)
        return isinstance(request.user, BusinessOwner)

    def has_object_permission(self, request, view, obj):
        if getattr(view, "scope", "mine") == "direct":
            try:
                company = direct.ashanti_direct()
            except LookupError:
                raise Http404 from None
            if obj.business_owner_id != company.pk:
                raise Http404
            return True
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
