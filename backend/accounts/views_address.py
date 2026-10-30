"""Address verification endpoints (Task 2): the staff queue and the decision. The rules live in
`accounts.address_verification`; see it for the evidence ladder and the maker-checker."""
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from . import address_verification as av
from .claims import ClaimError
from .permissions import HasRolePermission
from .views import AccountsPagination


class AddressVerificationQueueView(generics.ListAPIView):
    """GET address-verification/?status=pending|verified|wrong (unknown: pending), paginated."""

    pagination_class = AccountsPagination

    def get_permissions(self):
        return [HasRolePermission(av.PERMISSION)]

    def get_queryset(self):
        return av.queue_queryset(av.tab_of(self.request.query_params.get("status")))

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response(av.rows(page, request.user, request))


class AddressVerificationDecideView(APIView):
    """POST address-verification/<id>/decide/ {result, method, note}: answers the business's queue row."""

    def get_permissions(self):
        return [HasRolePermission(av.PERMISSION)]

    def post(self, request, pk):
        try:
            av.decide(pk, request.user, request.data, http_request=request)
        except ClaimError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.status_code)
        return Response(av.row_for(pk, request.user, request))
