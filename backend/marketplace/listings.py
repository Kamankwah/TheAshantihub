"""Listings & services (SA-5 screen 19): every listing in every state, with
the reason a published one is not on the site. There is no "hide" state: taking
a listing down is a rejection with a reason (the owner is told; it can be
sent back for review), which the screen says."""
from django.db.models import BooleanField, ExpressionWrapper, Q
from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission
from activity.models import ActivityEvent
from billing.clock import pause_enabled
from listings.models import Listing
from listings.visibility import hidden_business_q

from . import sales_counts
from .common import OversightPagination, choice_param, csv_export

STATUSES = ("live", "waiting", "hidden", "rejected", "draft", "dropped", "discontinued")
TYPES = ("product", "service", "booking")
ADDED_BY = ("owner", "scout")


def listing_type(listing):
    category = listing.category
    if category.kind == "service" and category.is_accommodation:
        return "booking"
    return "service" if category.kind == "service" else "product"


def state_of(listing, hidden):
    """(state, note): what the listing is to a shopper right now."""
    if listing.status == Listing.PUBLISHED:
        if hidden:
            owner = listing.business_owner
            return "hidden", "Business suspended" if owner.is_suspended else "Subscription unpaid"
        return "live", ""
    if listing.status == Listing.PENDING_REVIEW:
        return "waiting", "Waiting for a decision"
    if listing.status == Listing.REJECTED:
        return "rejected", listing.rejection_reason or ""
    if listing.status == Listing.DROPPED:
        return "dropped", "Hidden by the business"
    if listing.status == Listing.DISCONTINUED:
        return "discontinued", "No longer sold"
    return "draft", "Not sent for review"


def base_queryset():
    return Listing.objects.select_related(
        "category", "zone", "business_owner__profile", "business_owner__subscription", "reviewed_by", "created_by_staff__role",
    ).annotate(
        is_hidden=ExpressionWrapper(hidden_business_q(), output_field=BooleanField()),
    )


def filtered(request):
    params = request.query_params
    listings = base_queryset()
    status = choice_param(params, "status", STATUSES)
    if status == "live":
        listings = listings.filter(status=Listing.PUBLISHED, is_hidden=False)
    elif status == "hidden":
        listings = listings.filter(status=Listing.PUBLISHED, is_hidden=True)
    elif status == "waiting":
        listings = listings.filter(status=Listing.PENDING_REVIEW)
    elif status == "rejected":
        listings = listings.filter(status=Listing.REJECTED)
    elif status == "draft":
        listings = listings.filter(status=Listing.DRAFT)
    elif status in ("dropped", "discontinued"):
        listings = listings.filter(status=status)
    kind = choice_param(params, "type", TYPES)
    if kind == "booking":
        listings = listings.filter(category__kind="service", category__is_accommodation=True)
    elif kind == "service":
        listings = listings.filter(category__kind="service", category__is_accommodation=False)
    elif kind == "product":
        listings = listings.exclude(category__kind="service")
    added = choice_param(params, "added_by", ADDED_BY)
    if added == "scout":
        listings = listings.filter(created_by_staff__isnull=False)
    elif added == "owner":
        listings = listings.filter(created_by_staff__isnull=True)
    category = params.get("category") or ""
    if category.isdecimal():
        listings = listings.filter(category_id=int(category))
    text = (params.get("q") or "").strip()
    if text:
        listings = listings.filter(
            Q(name__icontains=text) | Q(business_owner__profile__business_name__icontains=text)
            | Q(business_owner__full_name__icontains=text)
        )
    return listings.order_by("-created_at", "-id")


def item(listing, counts):
    state, note = state_of(listing, listing.is_hidden)
    owner = listing.business_owner
    return {
        "id": listing.pk,
        "name": listing.name,
        "business_id": owner.pk,
        "business_name": owner.display_name,
        "type": listing_type(listing),
        "category": listing.category.label,
        "price_amount": str(listing.price_amount) if listing.price_amount is not None else None,
        "price_unit": listing.price_unit,
        "status": listing.status,
        "state": state,
        "state_note": note,
        "added_by": listing.created_by_staff.full_name if listing.created_by_staff else None,
        "added_by_role": listing.created_by_staff.role.get_name_display() if listing.created_by_staff else None,
        "created_at": listing.created_at,
        "reviewed_by": listing.reviewed_by.full_name if listing.reviewed_by else None,
        "reviewed_at": listing.reviewed_at,
        "rejection_reason": listing.rejection_reason,
        "sponsored": listing.sponsored,
        "paid_count": counts[0],
        "refunded_count": counts[1],
    }


class ListingListView(generics.ListAPIView):
    """GET /api/marketplace/listings/?q=&status=live|waiting|hidden|rejected|draft
    &type=product|service|booking&added_by=owner|scout&category=<id>&page="""

    pagination_class = OversightPagination

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def get_queryset(self):
        return filtered(self.request)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        counts = sales_counts.for_listings([listing.pk for listing in page])
        return self.get_paginated_response([item(listing, counts[listing.pk]) for listing in page])


class ListingCountsView(APIView):
    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def get(self, request):
        now = timezone.localtime()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        listings = Listing.objects.annotate(is_hidden=ExpressionWrapper(hidden_business_q(), output_field=BooleanField()))
        published = listings.filter(status=Listing.PUBLISHED)
        waiting = listings.filter(status=Listing.PENDING_REVIEW).order_by("created_at")
        oldest = waiting.values_list("created_at", flat=True).first()
        hidden = published.filter(is_hidden=True)
        suspended_hidden = hidden.filter(business_owner__is_suspended=True)
        unpaid_hidden = hidden.filter(business_owner__is_suspended=False)
        return Response({
            "live": published.filter(is_hidden=False).count(),
            "waiting": waiting.count(),
            "oldest_waiting_at": oldest,
            "hidden_unpaid": unpaid_hidden.count() if pause_enabled() else None,
            "hidden_unpaid_businesses": unpaid_hidden.values("business_owner").distinct().count() if pause_enabled() else None,
            "hidden_suspended": suspended_hidden.count(),
            "hidden_suspended_businesses": suspended_hidden.values("business_owner").distinct().count(),
            "rejected_this_month": listings.filter(status=Listing.REJECTED, reviewed_at__gte=month_start).count(),
            "pause_enabled": pause_enabled(),
        })


HISTORY_VERBS = {
    "moderation-approve": "Approved",
    "moderation-reject": "Rejected",
    "moderation-re-review": "Sent back for review",
}


class ListingHistoryView(APIView):
    """GET /api/marketplace/listings/<pk>/history/ — what happened to a listing:
    when it was added and by whom, then every recorded moderation decision."""

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def get(self, request, pk):
        listing = generics.get_object_or_404(base_queryset(), pk=pk)
        events = ActivityEvent.objects.filter(
            Q(target_type="listings.listing", target_id=str(pk)) | Q(verb__in=list(HISTORY_VERBS), target_id=str(pk)),
        ).order_by("-occurred_at", "-id")[:50]
        rows = []
        for event in events:
            reason = ((event.after or {}).get("request") or {}).get("reason") if isinstance(event.after, dict) else None
            text = HISTORY_VERBS.get(event.verb) or event.summary or event.verb
            rows.append({
                "at": event.occurred_at, "text": f"{text}: {reason}" if reason else text, "who": event.actor_label,
            })
        rows.append({
            "at": listing.created_at,
            "text": "Added" + (f" by {listing.created_by_staff.full_name} for the owner" if listing.created_by_staff else " by the owner"),
            "who": listing.created_by_staff.full_name if listing.created_by_staff else listing.business_owner.display_name,
        })
        return Response({"id": listing.pk, "name": listing.name, "business_name": listing.business_owner.display_name, "events": rows})


class ListingExportView(APIView):
    """GET /api/marketplace/listings/export/?<the list's filters> — a CSV of
    the filtered list. Listing facts only, no personal data."""

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def get(self, request):
        rows = []
        listings = list(filtered(request))
        counts = sales_counts.for_listings([listing.pk for listing in listings])
        for listing in listings:
            row = item(listing, counts[listing.pk])
            rows.append([
                row["name"], row["business_name"], row["type"], row["category"], row["price_amount"] or "",
                row["state"], row["state_note"], row["added_by"] or "Owner",
                row["reviewed_by"] or "", row["reviewed_at"].strftime("%Y-%m-%d") if row["reviewed_at"] else "",
                row["paid_count"], row["refunded_count"],
            ])
        return csv_export(
            request, stem="listings", kind="listings", personal_data=False,
            filters={k: v for k, v in request.query_params.items() if v},
            header=["Listing", "Business", "Type", "Category", "Price (GH₵)", "Status", "Note", "Added by", "Last decided by", "Decided on", "Paid", "Refunded"],
            rows=rows,
        )
