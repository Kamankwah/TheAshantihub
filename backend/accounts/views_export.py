from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import export
from .models import BusinessOwner, Customer


class AccountExportView(APIView):
    """GET accounts/me/export/: everything held about the signed-in customer or business owner, as JSON (review DB-04)."""

    permission_classes = [IsAuthenticated]
    throttle_scope = "login"

    def get(self, request):
        account = request.user
        if isinstance(account, Customer):
            account_type = "customer"
        elif isinstance(account, BusinessOwner):
            account_type = "business_owner"
        else:
            return Response({"detail": "Staff accounts have no export here."}, status=403)
        response = Response(export.build(account, account_type))
        response["Content-Disposition"] = 'attachment; filename="ashantihub-my-data.json"'
        response["Cache-Control"] = "no-store"
        return response
