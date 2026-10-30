"""Shop location capture endpoints (Task 1): the staff send a link, the owner's public link page, and the owner's own
capture from the dashboard. The service is `accounts.location_capture`; see it for the rules.

The public views are POST-only with the token in the body, so it never lands in an access log or a browser history, and
every answer (errors and throttling too) says `no-referrer` and `no-store`. They and the staff send are
`activity_exempt`: the middleware would store the request body, which holds the token or the fix, and the service
records its own events (without the token) after the transaction it needs."""
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import location_capture
from .claims import ClaimError
from .models import BusinessOwner
from .permissions import HasRolePermission
from .views import IsBusinessOwner

STATUS_BY_CODE = {"invalid": 400, "used": 410, "revoked": 410, "expired": 410, "closed": 410}


def _body(request):
    return request.data if hasattr(request.data, "get") else {}


def _refusal(exc, status=None):
    return Response({"detail": exc.message, "code": exc.code}, status=status or exc.status_code)


class SendLocationLinkView(APIView):
    """POST {business_owner}: staff text the owner a link to share the shop's location. Staff with `address.verify`."""

    activity_exempt = True  # the service records the event; the text must go out after its transaction, not inside one

    def get_permissions(self):
        return [HasRolePermission("address.verify")]

    def post(self, request):
        raw_id = _body(request).get("business_owner")
        # ASCII digits only: "²" and Arabic-Indic digits pass str.isdigit() but int() refuses the first of them.
        if (
            isinstance(raw_id, bool) or not isinstance(raw_id, (int, str))
            or not str(raw_id).isascii() or not str(raw_id).isdigit()
        ):
            return Response({"business_owner": ["Choose a business."]}, status=400)
        owner = get_object_or_404(BusinessOwner, pk=int(raw_id))
        try:
            capture, raw = location_capture.create_link(owner, request.user, request=request)
        except ClaimError as exc:
            return _refusal(exc)
        state, masked = location_capture.send_link_text(owner, raw)  # after commit, outside any transaction
        return Response(
            {
                "id": capture.pk, "url": location_capture.link_url(raw), "expires_at": capture.expires_at,
                "sms_state": state, "phone_masked": masked,
            },
            status=201,
        )


class _PublicLinkView(APIView):
    authentication_classes = []  # a stale or foreign Authorization header must change nothing
    permission_classes = [AllowAny]
    throttle_scope = "location_link"
    activity_exempt = True

    def perform(self, request, body):
        raise NotImplementedError

    def post(self, request):
        try:
            response = Response(self.perform(request, _body(request)))
        except ClaimError as exc:
            response = _refusal(exc, STATUS_BY_CODE.get(exc.code))
        response["Referrer-Policy"] = "no-referrer"
        response["Cache-Control"] = "no-store"
        return response

    def handle_exception(self, exc):  # a throttled, malformed or out-of-range request gets the same headers
        response = super().handle_exception(exc)
        response["Referrer-Policy"] = "no-referrer"
        response["Cache-Control"] = "no-store"
        return response


class LocationLinkPreviewView(_PublicLinkView):
    """POST {token}: the business name and expiry. Does not use the link up."""

    def perform(self, request, body):
        return location_capture.preview(body.get("token"))


class LocationLinkCaptureView(_PublicLinkView):
    """POST {token, lat, lng, accuracy_m}: share the shop's location. Single use."""

    def perform(self, request, body):
        return location_capture.capture_with_link(body.get("token"), body, request=request)


class MyLocationView(APIView):
    """GET / POST the signed-in business owner's own shop location (dashboard capture)."""

    permission_classes = [IsBusinessOwner]
    throttle_scope = "owner_location"  # each POST writes a capture row, an activity event and a fan-out to every verifier

    def get_throttles(self):
        return super().get_throttles() if self.request.method == "POST" else []

    def get(self, request):
        return Response(location_capture.own_state(request.user))

    def post(self, request):
        try:
            return Response(location_capture.capture_for_owner(request.user, _body(request), request=request))
        except ClaimError as exc:
            return _refusal(exc)
