"""Free-delivery promos: the business's own endpoints and the staff review queue.

Owner endpoints only ever query `DeliveryWaiver.objects.filter(business_owner=request.user)`, so another
business's promo is a 404, and item ids are checked against the caller's own listings in waivers.clean()."""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner

from . import waivers
from .models_waivers import DeliveryWaiver

WAIVER_STATUS_MAP = {
    "pending": DeliveryWaiver.PENDING,
    "approved": DeliveryWaiver.ACTIVE,
    "rejected": DeliveryWaiver.REJECTED,
    "paused": DeliveryWaiver.PAUSED,
    "ended": DeliveryWaiver.ENDED,
}


def _err(exc):
    return Response({"detail": exc.message}, status=exc.status_code)


def _qs():
    return DeliveryWaiver.objects.select_related("business_owner", "business_owner__profile").prefetch_related("listings")


def _one(pk):
    return waivers.serialize(_qs().get(pk=pk))


class OwnerDeliveryPromosView(APIView):
    """GET the caller's own free-delivery promos; POST a new one (it waits for review)."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        rows = _qs().filter(business_owner=request.user)
        return Response({"results": [waivers.serialize(w) for w in rows]})

    def post(self, request):
        try:
            w = waivers.create_for_owner(request.user, request.data)
        except waivers.WaiverError as exc:
            return _err(exc)
        return Response(_one(w.pk), status=201)


class OwnerDeliveryPromoActionView(APIView):
    """POST <pk>/<pause|resume|end>/ on one of the caller's own promos."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk, action):
        try:
            if action == "pause":
                w = waivers.owner_pause(request.user, pk)
            elif action == "resume":
                w = waivers.owner_resume(request.user, pk)
            elif action == "end":
                w = waivers.end(pk, owner=request.user)
            else:
                return Response({"detail": "Not found."}, status=404)
        except DeliveryWaiver.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        except waivers.WaiverError as exc:
            return _err(exc)
        return Response(_one(w.pk))


class StaffDeliveryPromosView(APIView):
    """GET ?status= (default pending, unknown falls back to pending); POST creates one on a business's behalf, live at once."""

    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(waivers.PERM)]

    def get(self, request):
        wanted = WAIVER_STATUS_MAP.get(request.query_params.get("status"), DeliveryWaiver.PENDING)
        rows = _qs().filter(status=wanted)
        rows = rows.order_by("created_at", "id") if wanted == DeliveryWaiver.PENDING else rows.order_by("-reviewed_at", "-created_at", "-id")
        return Response({"results": [waivers.serialize(w) for w in rows[:200]]})

    def post(self, request):
        owner = BusinessOwner.objects.filter(pk=request.data.get("business_owner")).first() if isinstance(request.data.get("business_owner"), int) else None
        if owner is None:
            return Response({"detail": "Choose a business."}, status=400)
        try:
            w = waivers.create_for_staff(request.user, owner, request.data)
        except waivers.WaiverError as exc:
            return _err(exc)
        return Response(_one(w.pk), status=201)


class StaffPlatformDeliveryPromoView(APIView):
    """POST creates an AshantiHub-funded promo for one business. It always waits for Operations or a Super Admin
    (approvals engine); a Super Admin's own applies at once."""

    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission("delivery_promo.fund")]

    def post(self, request):
        raw = request.data.get("business_owner")
        owner = BusinessOwner.objects.filter(pk=raw).first() if isinstance(raw, int) and not isinstance(raw, bool) else None
        if owner is None:
            return Response({"detail": "Choose a business."}, status=400)
        try:
            w, approval = waivers.create_platform_funded(request.user, owner, request.data, request=request)
        except waivers.WaiverError as exc:
            return _err(exc)
        body = _one(w.pk)
        return Response({**body, "approval": {"id": approval.pk, "status": approval.status}}, status=201)


class StaffDeliveryPromoActionView(APIView):
    """POST <pk>/<approve|reject|re-review|end>/."""

    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(waivers.PERM)]

    def post(self, request, pk, action):
        try:
            if action == "approve":
                w = waivers.approve(pk, request.user)
            elif action == "reject":
                w = waivers.reject(pk, request.user, request.data.get("reason"))
            elif action == "re-review":
                w = waivers.re_review(pk)
            elif action == "end":
                w = waivers.end(pk)
            else:
                return Response({"detail": "Not found."}, status=404)
        except DeliveryWaiver.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        except waivers.WaiverError as exc:
            return _err(exc)
        return Response(_one(w.pk))
