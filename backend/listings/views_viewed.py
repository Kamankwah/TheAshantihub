"""Listing views and "Customers also viewed" (marketplace Plan 4).

POST /api/listings/<id>/view/ records that someone opened a listing: at most one row per (viewer, listing, day in
Accra). A signed-in customer is `c:<customer id>`; an anonymous browser sends a random id of its own, stored only as a
keyed hash. GET /api/listings/<id>/also-viewed/ answers with what the same viewers opened in the last 30 days (a row
needs MIN_CO_VIEWERS distinct co-viewers, and MIN_ROWS rows must qualify) and otherwise says plainly it is falling back
to the same category (`basis`), newest first, the order the public list uses when nothing else is asked for.
"""
import hashlib
import hmac
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Customer

from .models import Listing, ListingView
from .serializers import PublicListingSerializer
from .views import _with_rating_annotations
from .visibility import hidden_business_q, sold_out_q

WINDOW_DAYS = 30
MIN_CO_VIEWERS = 3
MIN_ROWS = 4
DEFAULT_LIMIT, MAX_LIMIT = 12, 24
CANDIDATE_CAP = 200


def anonymous_key(viewer):
    """The stored key for an anonymous viewer id: a keyed hash, so the browser's own id never sits in the database."""
    digest = hmac.new(settings.SECRET_KEY.encode(), viewer.encode(), hashlib.sha256).hexdigest()
    return ("a:" + digest)[:64]


def visible_listings():
    """Published listings a shopper may see in a list (the same filters as the public list and the related rail)."""
    return Listing.objects.filter(status=Listing.PUBLISHED).exclude(hidden_business_q()).exclude(sold_out_q())


class ListingViewRecordView(APIView):
    """POST /api/listings/<id>/view/ - 204 always on success; never echoes the stored key. 404 for a listing the detail
    page would not show. Staff and business sessions are accepted and record nothing."""

    permission_classes = [AllowAny]
    throttle_scope = "listing_view"

    def post(self, request, pk):
        listing = generics.get_object_or_404(
            Listing.objects.filter(status=Listing.PUBLISHED).exclude(hidden_business_q()), pk=pk,
        )
        user = request.user
        if isinstance(user, Customer):
            key = f"c:{user.pk}"
        elif getattr(user, "is_authenticated", False):
            return Response(status=204)
        else:
            raw = request.data.get("viewer") if hasattr(request.data, "get") else None
            try:
                raw = str(uuid.UUID(str(raw)))
            except (ValueError, AttributeError, TypeError):
                return Response({"viewer": "Send the anonymous viewer id as a UUID."}, status=400)
            key = anonymous_key(raw)
        try:
            with transaction.atomic():
                ListingView.objects.get_or_create(viewer_key=key, listing=listing, day=timezone.localdate())
        except IntegrityError:  # the same view arrived twice at once
            pass
        return Response(status=204)


class AlsoViewedView(APIView):
    """GET /api/listings/<id>/also-viewed/?limit=12 -> {"basis": "co_viewed" | "same_category", "results": [card rows]}."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        anchor = generics.get_object_or_404(
            Listing.objects.filter(status=Listing.PUBLISHED).exclude(hidden_business_q()), pk=pk,
        )
        try:
            limit = max(1, min(MAX_LIMIT, int(request.query_params.get("limit", DEFAULT_LIMIT))))
        except ValueError:
            limit = DEFAULT_LIMIT
        base = visible_listings().exclude(pk=anchor.pk)

        ranked = self._co_viewed(anchor, base)
        if len(ranked) >= MIN_ROWS:
            basis, ids = "co_viewed", ranked[:limit]
        else:
            basis = "same_category"
            ids = list(base.filter(category_id=anchor.category_id).order_by("-created_at").values_list("pk", flat=True)[:limit])
        return Response({"basis": basis, "results": self._cards(request, ids)})

    @staticmethod
    def _co_viewed(anchor, base):
        """Visible listing ids viewed by at least MIN_CO_VIEWERS of the anchor's viewers in the window, most first."""
        since = timezone.now() - timedelta(days=WINDOW_DAYS)
        viewers = ListingView.objects.filter(listing=anchor, viewed_at__gte=since).values("viewer_key")
        counted = (
            ListingView.objects.filter(viewer_key__in=viewers, viewed_at__gte=since).exclude(listing=anchor)
            .filter(listing__in=base.values("pk"))
            .values("listing_id").annotate(viewers=Count("viewer_key", distinct=True))
            .filter(viewers__gte=MIN_CO_VIEWERS).order_by("-viewers", "-listing_id")
        )
        return [row["listing_id"] for row in counted[:CANDIDATE_CAP]]

    @staticmethod
    def _cards(request, ids):
        rows = _with_rating_annotations(
            Listing.objects.filter(pk__in=ids).select_related("category", "zone", "business_owner__profile").prefetch_related("photos")
        )
        by_id = {row.pk: row for row in rows}
        ordered = [by_id[i] for i in ids if i in by_id]
        return PublicListingSerializer(ordered, many=True, context={"request": request}).data
