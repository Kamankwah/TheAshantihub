from rest_framework.permissions import BasePermission

from accounts.models import BusinessOwner, Customer, StaffUser


class IsCustomerOrBusinessOwner(BasePermission):
    """Gate for POST /api/events/submit/ — an event may be submitted by
    either account type (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6), unlike
    most of this codebase's endpoints which are scoped to a single account
    type (IsBusinessOwner / IsCustomer).
    """

    def has_permission(self, request, view):
        return isinstance(request.user, (Customer, BusinessOwner))


class IsEventOwner(BasePermission):
    """Object-level check: the requesting Customer or BusinessOwner is the
    event's submitter. Used by EventPayView and EventMediaCreateView.
    """

    def has_object_permission(self, request, view, obj):
        user = request.user
        if isinstance(user, BusinessOwner):
            return obj.submitted_by_business_id == user.id
        if isinstance(user, Customer):
            return obj.submitted_by_customer_id == user.id
        return False


class IsEventOwnerOrCanApproveEvents(BasePermission):
    """Object-level check for GET /api/events/{id}/rsvps/ (Phase 7 —
    docs/BUSINESS_EVENTS_ROADMAP.md: "organizer/staff-only, paginated
    attendee list"). Reuses IsEventOwner's organizer check; a staff member
    is admitted if they hold the same `event.approve` permission that
    already gates the event-approval queue — no new permission codename is
    seeded just for viewing attendees, since anyone trusted to approve an
    event's full detail (address/lat/lng/going_count) is trusted to see its
    attendee list too.
    """

    def has_object_permission(self, request, view, obj):
        user = request.user
        if isinstance(user, StaffUser):
            return user.role.permissions.filter(codename="event.approve").exists()
        if isinstance(user, BusinessOwner):
            return obj.submitted_by_business_id == user.id
        if isinstance(user, Customer):
            return obj.submitted_by_customer_id == user.id
        return False
