"""Editing an approved listing through revisions: the owner's views and the staff queue (contract in backend/CLAUDE.md).

Owner:  GET/PUT/DELETE /api/listings/mine/<pk>/revision/   POST /api/listings/mine/<pk>/revision/submit/
Staff:  GET /api/listings/revisions/pending/?status=pending|approved|rejected   GET /api/listings/revisions/<pk>/
        POST .../approve/   POST .../reject/ {reason}   POST .../re-review/        (listings.moderate)
"""
import json

from django.db import transaction
from django.http import Http404
from rest_framework import generics
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import direct
from accounts.permissions import HasRolePermission
from activity.services import record as activity_record

from . import revisions
from .models import Listing, ListingRevision
from .permissions import IsListingOwnerOrDirectOperator
from .serializers_revisions import OwnerRevisionSerializer, RevisionDetailSerializer, RevisionQueueSerializer

REVISION_STATUS_MAP = {
    "pending": ListingRevision.PENDING,
    "approved": ListingRevision.APPROVED,
    "rejected": ListingRevision.REJECTED,
}
JSON_KEYS = ("changes", "variants", "remove_photo_ids", "remove_video_ids")


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


class ScopedOwner:
    """Mixin for an owner view that Ashanti Direct's mount reuses: `scope` is "mine" or "direct" (`as_view(scope=...)`)."""

    scope = "mine"

    def acting_owner(self, request=None):
        return _owner(request or self.request, self.scope)

    def acting_staff(self, request=None):
        return _staff(request or self.request, self.scope)


class _OwnerRevisionView(ScopedOwner, APIView):
    permission_classes = [IsAuthenticated, IsListingOwnerOrDirectOperator]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def owner(self, request):
        return _owner(request, self.scope)

    def listing(self, request, pk):
        # Another business's listing is a 404, so nobody learns it exists.
        return generics.get_object_or_404(Listing, pk=pk, business_owner=self.owner(request))

    def answer(self, request, revision, status=200):
        return Response(OwnerRevisionSerializer(revision, context={"request": request}).data, status=status)


def _fields_sent(request):
    """The JSON fields of a PUT, whether it came as JSON or as multipart form fields holding JSON text."""
    data = {}
    for key in JSON_KEYS:
        if key not in request.data:
            continue
        value = request.data[key]
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                raise revisions.RevisionError("Send this as JSON.", key) from None
        data[key] = value
    return data


class ListingRevisionView(_OwnerRevisionView):
    def get(self, request, pk):
        revision = revisions.open_revision(self.listing(request, pk))
        if revision is None:
            return Response({"detail": "This listing has no edit in progress."}, status=404)
        return self.answer(request, revision)

    def put(self, request, pk):
        listing = self.listing(request, pk)
        try:
            data = _fields_sent(request)
            photo = request.FILES.get("new_main_photo")
            clear = "new_main_photo" in request.data and photo is None and not request.data.get("new_main_photo")
            revision = revisions.save_draft(
                listing, self.owner(request), data, new_main_photo=photo, clear_main_photo=clear,
                staff=self.acting_staff(request),
            )
        except revisions.RevisionError as exc:
            return Response(exc.payload, status=400)
        return self.answer(request, revision)

    def delete(self, request, pk):
        revision = revisions.open_revision(self.listing(request, pk))
        if revision is None:
            return Response({"detail": "This listing has no edit in progress."}, status=404)
        try:
            revisions.discard(revision)
        except revisions.RevisionError as exc:
            return Response(exc.payload, status=400)
        return Response(status=204)


class ListingRevisionSubmitView(_OwnerRevisionView):
    def post(self, request, pk):
        revision = revisions.open_revision(self.listing(request, pk))
        if revision is None:
            return Response({"detail": "This listing has no edit in progress."}, status=404)
        staff = self.acting_staff(request)
        if staff is not None and revision.created_by_staff_id != staff.pk:
            # Maker-checker: whoever sends a Direct edit for approval counts as its maker and cannot approve it.
            revision.created_by_staff = staff
            revision.save(update_fields=["created_by_staff", "updated_at"])
        try:
            revision = revisions.submit(revision)
        except revisions.RevisionError as exc:
            return Response(exc.payload, status=400)
        activity_record(
            request.user, "listing-revision-submit", target=revision, method="POST", request=request,
            summary=f"Sent changes to {revision.listing.name} for approval",
        )
        return self.answer(request, revision)


# ── staff ───────────────────────────────────────────────────────────────────────────────────────────────────────────


class _StaffRevisionView:
    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]


class RevisionPendingQueueView(_StaffRevisionView, generics.ListAPIView):
    serializer_class = RevisionQueueSerializer

    def get_queryset(self):
        tab = self.request.query_params.get("status", "pending")
        status = REVISION_STATUS_MAP.get(tab, ListingRevision.PENDING)
        queryset = ListingRevision.objects.filter(status=status).select_related(
            "listing__business_owner", "reviewed_by",
        )
        if status == ListingRevision.PENDING:
            return queryset.order_by("submitted_at", "id")
        return queryset.order_by("-reviewed_at", "-created_at")


class RevisionDetailView(_StaffRevisionView, generics.RetrieveAPIView):
    queryset = ListingRevision.objects.select_related("listing__business_owner", "reviewed_by")
    serializer_class = RevisionDetailSerializer


class _RevisionDecisionView(_StaffRevisionView, APIView):
    def revision(self, pk):
        return generics.get_object_or_404(ListingRevision.objects.select_related("listing__business_owner"), pk=pk)

    def done(self, revision):
        return Response({"id": revision.pk, "listing": revision.listing_id, "status": revision.status})


class RevisionApproveView(_RevisionDecisionView):
    def post(self, request, pk):
        revision = self.revision(pk)
        if revisions.cannot_decide(request.user, revision):
            return Response({"detail": revisions.OWN_APPROVAL_MESSAGE}, status=403)
        try:
            revision = revisions.apply_revision(revision, request.user)
        except revisions.RevisionError as exc:
            return Response(exc.payload, status=400)
        return self.done(revision)


class RevisionRejectView(_RevisionDecisionView):
    def post(self, request, pk):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "A rejection reason is required."}, status=400)
        try:
            revision = revisions.reject_revision(self.revision(pk), request.user, reason)
        except revisions.RevisionError as exc:
            return Response(exc.payload, status=400)
        return self.done(revision)


class RevisionReReviewView(_RevisionDecisionView):
    def post(self, request, pk):
        try:
            revision = revisions.re_review(self.revision(pk))
        except revisions.RevisionError as exc:
            return Response(exc.payload, status=400)
        return self.done(revision)
