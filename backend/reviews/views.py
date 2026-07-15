from django.db.models import Avg, Count
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission
from accounts.views import IsCustomer
from events.models import Event, EventRSVP
from listings.models import Listing
from orders.models import Order, OrderItem

from .models import Review
from .serializers import ReviewModerationSerializer, ReviewSerializer, ReviewSubmitSerializer


def check_review_eligibility(customer, target_type, target_id, organizer_kind=None):
    """Shared verification helper — the plan is explicit that
    ReviewSubmitView and ReviewEligibilityView must call this exact same
    helper so the two paths can't drift.
    """
    if target_type == Review.LISTING:
        return OrderItem.objects.filter(
            listing_id=target_id, order__customer=customer, order__status=Order.PAID,
        ).exists()
    if target_type == Review.EVENT:
        return EventRSVP.objects.filter(
            event_id=target_id, customer=customer, status=EventRSVP.GOING,
        ).exists()
    if target_type == Review.SELLER:
        return OrderItem.objects.filter(
            listing__business_owner_id=target_id, order__customer=customer, order__status=Order.PAID,
        ).exists()
    if target_type == Review.ORGANIZER:
        if organizer_kind == "business":
            return EventRSVP.objects.filter(
                event__submitted_by_business_id=target_id, customer=customer, status=EventRSVP.GOING,
            ).exists()
        if organizer_kind == "customer":
            return EventRSVP.objects.filter(
                event__submitted_by_customer_id=target_id, customer=customer, status=EventRSVP.GOING,
            ).exists()
        return False
    return False


def _existing_review_filter(target_type, target_id, organizer_kind=None):
    """Builds the `Review.objects.filter(author=..., **this)` kwargs that
    match the corresponding UniqueConstraint on the Review model for a given
    target — used both to pre-check for a duplicate before insert
    (ReviewSubmitView) and to answer "already_reviewed"
    (ReviewEligibilityView). Returns None for an invalid
    target_type/organizer_kind combination.
    """
    if target_type == Review.LISTING:
        return {"listing_id": target_id}
    if target_type == Review.EVENT:
        return {"event_id": target_id}
    if target_type == Review.SELLER:
        return {"business_owner_id": target_id, "target_type": Review.SELLER}
    if target_type == Review.ORGANIZER:
        if organizer_kind == "business":
            return {"business_owner_id": target_id, "target_type": Review.ORGANIZER}
        if organizer_kind == "customer":
            return {"organizer_customer_id": target_id, "target_type": Review.ORGANIZER}
        return None
    return None


class ReviewSubmitView(APIView):
    """POST /api/reviews/ — a verified customer reviews a listing/event/
    seller/organizer. 403 if the customer has no qualifying paid order/going
    RSVP (never trusted from the request body), 400 on a duplicate (pre-
    checked, not caught as an IntegrityError from an uncaught race — an
    acceptable narrow TOCTOU window for this app's traffic level, matching
    HeroSubmitView's "check then create" convention elsewhere in this
    codebase).
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request):
        serializer = ReviewSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        target_type = data["target_type"]
        target_id = data["target_id"]
        organizer_kind = data.get("organizer_kind")

        target_kwargs = {}
        if target_type == Review.LISTING:
            generics.get_object_or_404(Listing, pk=target_id)
            target_kwargs["listing_id"] = target_id
        elif target_type == Review.EVENT:
            generics.get_object_or_404(Event, pk=target_id)
            target_kwargs["event_id"] = target_id
        elif target_type == Review.SELLER:
            generics.get_object_or_404(BusinessOwner, pk=target_id)
            target_kwargs["business_owner_id"] = target_id
        elif target_type == Review.ORGANIZER:
            if organizer_kind == "business":
                generics.get_object_or_404(BusinessOwner, pk=target_id)
                target_kwargs["business_owner_id"] = target_id
            else:
                generics.get_object_or_404(Customer, pk=target_id)
                target_kwargs["organizer_customer_id"] = target_id

        if not check_review_eligibility(request.user, target_type, target_id, organizer_kind):
            return Response(
                {"detail": "You can only review after a verified purchase or attendance."},
                status=403,
            )

        existing_filter = _existing_review_filter(target_type, target_id, organizer_kind)
        if Review.objects.filter(author=request.user, **existing_filter).exists():
            return Response({"detail": "You have already reviewed this."}, status=400)

        review = Review.objects.create(
            target_type=target_type,
            author=request.user,
            rating=data["rating"],
            comment=data["comment"],
            verified=True,
            status=Review.PUBLISHED,
            **target_kwargs,
        )
        return Response(ReviewSerializer(review).data, status=201)


class ReviewPagination(PageNumberPagination):
    page_size = 20


class TargetReviewListView(generics.ListAPIView):
    """Base for GET /api/reviews/listing/<pk>/, /event/<pk>/, /seller/<pk>/,
    /organizer/business/<pk>/, /organizer/customer/<pk>/ — AllowAny,
    paginated, and injects `avg_rating`/`review_count` as extra top-level
    keys in the paginated envelope, computed via one `.aggregate()` call on
    the unpaginated filtered queryset (not the page).
    """

    serializer_class = ReviewSerializer
    permission_classes = [AllowAny]
    pagination_class = ReviewPagination

    def get_target_filter(self):
        raise NotImplementedError

    def get_queryset(self):
        return Review.objects.filter(
            status=Review.PUBLISHED, **self.get_target_filter()
        ).order_by("-created_at")

    def get_paginated_response(self, data):
        aggregates = self.filter_queryset(self.get_queryset()).aggregate(
            avg_rating=Avg("rating"), review_count=Count("id")
        )
        response = self.paginator.get_paginated_response(data)
        response.data["avg_rating"] = aggregates["avg_rating"]
        response.data["review_count"] = aggregates["review_count"] or 0
        return response


class ListingReviewListView(TargetReviewListView):
    def get_target_filter(self):
        return {"target_type": Review.LISTING, "listing_id": self.kwargs["pk"]}


class EventReviewListView(TargetReviewListView):
    def get_target_filter(self):
        return {"target_type": Review.EVENT, "event_id": self.kwargs["pk"]}


class SellerReviewListView(TargetReviewListView):
    def get_target_filter(self):
        return {"target_type": Review.SELLER, "business_owner_id": self.kwargs["pk"]}


class OrganizerBusinessReviewListView(TargetReviewListView):
    def get_target_filter(self):
        return {"target_type": Review.ORGANIZER, "business_owner_id": self.kwargs["pk"]}


class OrganizerCustomerReviewListView(TargetReviewListView):
    def get_target_filter(self):
        return {"target_type": Review.ORGANIZER, "organizer_customer_id": self.kwargs["pk"]}


class ReviewEligibilityView(APIView):
    """GET /api/reviews/eligibility/?target_type=&target_id=&organizer_kind=
    Returns {"eligible": bool, "already_reviewed": bool} — `eligible` is
    forced False if `already_reviewed` is True, so a caller showing "write a
    review" UI has a single boolean it can trust. Calls the exact same
    check_review_eligibility helper ReviewSubmitView uses.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request):
        target_type = request.query_params.get("target_type")
        target_id_raw = request.query_params.get("target_id")
        organizer_kind = request.query_params.get("organizer_kind")

        if target_type not in dict(Review.TARGET_TYPE_CHOICES) or not target_id_raw:
            return Response(
                {"detail": "target_type and target_id query params are required."}, status=400
            )
        try:
            target_id = int(target_id_raw)
        except ValueError:
            return Response({"detail": "target_id must be an integer."}, status=400)

        existing_filter = _existing_review_filter(target_type, target_id, organizer_kind)
        if existing_filter is None:
            return Response(
                {"detail": "Invalid target_type/organizer_kind combination."}, status=400
            )

        already_reviewed = Review.objects.filter(author=request.user, **existing_filter).exists()
        eligible = (not already_reviewed) and check_review_eligibility(
            request.user, target_type, target_id, organizer_kind
        )
        return Response({"eligible": eligible, "already_reviewed": already_reviewed})


class ReviewModerationPagination(PageNumberPagination):
    page_size = 20


class ReviewModerationListView(generics.ListAPIView):
    """GET /api/reviews/moderation/ — all reviews regardless of status,
    staff-only (reviews.moderate).
    """

    serializer_class = ReviewModerationSerializer
    queryset = Review.objects.all().order_by("-created_at")
    pagination_class = ReviewModerationPagination

    def get_permissions(self):
        return [HasRolePermission("reviews.moderate")]


class ReviewHideView(APIView):
    """POST /api/reviews/moderation/{id}/hide/ — body {"reason": "..."}
    required non-empty, mirrors ModerationRejectView's reason requirement.
    """

    def get_permissions(self):
        return [HasRolePermission("reviews.moderate")]

    def post(self, request, pk):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "A reason is required."}, status=400)
        review = generics.get_object_or_404(Review, pk=pk)
        review.status = Review.HIDDEN
        review.hidden_reason = reason
        review.hidden_by = request.user
        review.save(update_fields=["status", "hidden_reason", "hidden_by"])
        return Response({"id": review.id, "status": review.status})


class ReviewUnhideView(APIView):
    def get_permissions(self):
        return [HasRolePermission("reviews.moderate")]

    def post(self, request, pk):
        review = generics.get_object_or_404(Review, pk=pk)
        review.status = Review.PUBLISHED
        review.hidden_reason = None
        review.hidden_by = None
        review.save(update_fields=["status", "hidden_reason", "hidden_by"])
        return Response({"id": review.id, "status": review.status})
