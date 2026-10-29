"""Who acts in an owner view: the signed-in business ("mine"), or Operations for Ashanti Direct ("direct").

The owner views are mounted twice (listings/urls.py and listings/urls_direct.py with `as_view(scope="direct")`). On the
direct mount the owner is always the company, never a client-supplied id, and every staff write that succeeds on a
listing is remembered as a contribution to it (and to its open edit), so maker-checker can refuse anyone who drafted,
edited or sent it (`listings.revisions.cannot_decide`)."""
from django.http import Http404
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS

from accounts import direct


DIRECT_FROM_STAFF = "Ashanti Direct is run from the staff dashboard. Sign in there to change its listings."


def _owner(request, scope=None):
    """The business whose listings these views act on: the signed-in business, or, on Ashanti Direct's mount
    (`scope == "direct"`), always the company itself, never anything the client sends."""
    if scope == "direct":
        try:
            return direct.ashanti_direct()
        except LookupError:
            raise Http404 from None
    return request.user


def _staff(request, scope=None):
    """The staff member acting for Ashanti Direct (stamped on what they create), None for a business's own request."""
    return request.user if scope == "direct" else None


def record_contribution(listing, staff):
    """Remember `staff` as a contributor to the listing and to its open edit, if any."""
    from . import revisions

    listing.staff_contributors.add(staff)
    revision = revisions.open_revision(listing)
    if revision is not None:
        revision.staff_contributors.add(staff)


class ScopedOwner:
    """Mixin for an owner view that Ashanti Direct's mount reuses: `scope` is "mine" or "direct" (`as_view(scope=...)`)."""

    scope = "mine"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Ashanti Direct's own login can read and withdraw, but listings change through the staff dashboard, so that
        # every write names the staff member who made it (maker-checker needs to know).
        if self.scope == "mine" and request.method not in SAFE_METHODS and direct.is_direct(request.user):
            raise PermissionDenied(DIRECT_FROM_STAFF)

    def acting_owner(self, request=None):
        return _owner(request or self.request, self.scope)

    def acting_staff(self, request=None):
        return _staff(request or self.request, self.scope)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        staff = self.acting_staff(request)
        pk = self.kwargs.get("pk")
        # Only a write that succeeded (a refused one answers 4xx and records nothing), on one listing.
        if staff is not None and pk is not None and request.method not in SAFE_METHODS and response.status_code < 400:
            from .models import Listing

            listing = Listing.objects.filter(pk=pk).first()
            if listing is not None:
                record_contribution(listing, staff)
        return response
