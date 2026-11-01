from django.contrib.auth.hashers import check_password
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import deletion
from .models import BusinessOwner, Customer


class AccountDeleteView(APIView):
    """POST accounts/me/delete/ {password}: a customer or business owner erases their own account."""

    permission_classes = [IsAuthenticated]
    throttle_scope = "login"

    def post(self, request):
        account = request.user
        if isinstance(account, Customer):
            account_type = "customer"
        elif isinstance(account, BusinessOwner):
            account_type = "business_owner"
        else:
            return Response({"detail": "Staff accounts cannot be deleted here."}, status=status.HTTP_403_FORBIDDEN)
        if not check_password(str(request.data.get("password", "")), account.password_hash):
            return Response(
                {"code": "wrong_password", "detail": "That password is not right."}, status=status.HTTP_400_BAD_REQUEST
            )
        reasons = deletion.blockers(account, account_type)
        if reasons:
            return Response({"code": "deletion_blocked", "reasons": reasons}, status=status.HTTP_409_CONFLICT)
        deletion.delete_account(account, account_type)
        return Response(status=status.HTTP_204_NO_CONTENT)
