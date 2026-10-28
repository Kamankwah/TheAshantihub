"""The public seller page: who a business is and how much of it is live. No contact detail of any kind."""
from django.db.models import Q
from django.http import Http404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner

from .models import Category, Listing
from .visibility import hidden_business_q, sold_out_q


class SellerDetailView(APIView):
    """GET /api/listings/sellers/<id>/ — {"id", "name", "since", "counts": {products, services, stays, events}}.

    `name` is the business name the site shows elsewhere (the owner's own name only when none is set); `since` is
    when the business joined (BusinessOwner.created_at). Counts are the listings and events the public can see right
    now, using the same rules as browse. A suspended or paused business is a 404, like its listings."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        owner = (
            BusinessOwner.objects.filter(pk=pk).exclude(hidden_business_q("")).select_related("profile").first()
        )
        if owner is None:
            raise Http404
        live = Listing.objects.filter(business_owner=owner, status=Listing.PUBLISHED).exclude(sold_out_q())
        stays = Q(category__is_accommodation=True)
        counts = {
            "products": live.filter(category__kind=Category.PRODUCT).exclude(stays).count(),
            "services": live.filter(category__kind=Category.SERVICE).exclude(stays).count(),
            "stays": live.filter(stays).count(),
            "events": _live_event_count(owner),
        }
        return Response({"id": owner.pk, "name": owner.display_name, "since": owner.created_at, "counts": counts})


def _live_event_count(owner):
    from events.views import _live_events_queryset  # events imports listings at load time

    return _live_events_queryset().filter(submitted_by_business=owner).count()
