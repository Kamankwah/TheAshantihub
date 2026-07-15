from rest_framework.permissions import BasePermission

from accounts.models import BusinessOwner, Customer


class IsQuestionOwner(BasePermission):
    """Object-level check for POST /api/qa/questions/{id}/answer/ — true if
    the requesting user is the target's existing owner: a BusinessOwner
    whose listing/event this is, or a Customer who organized this event
    (mirrors listings.permissions's exact idiom). No separate `Answer`
    model — `answered_by` is always exactly this derived owner.
    """

    def has_object_permission(self, request, view, obj):
        user = request.user
        if isinstance(user, BusinessOwner):
            return (
                (obj.listing_id is not None and obj.listing.business_owner_id == user.id)
                or (obj.event_id is not None and obj.event.submitted_by_business_id == user.id)
            )
        if isinstance(user, Customer):
            return obj.event_id is not None and obj.event.submitted_by_customer_id == user.id
        return False
