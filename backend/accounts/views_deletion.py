from django.contrib.auth.hashers import check_password
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from otp import step_up

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
        data = request.data if hasattr(request.data, "get") else {}
        password = data.get("password", "")
        if not isinstance(password, str) or not check_password(password, account.password_hash):
            return Response(
                {"code": "wrong_password", "detail": "That password is not right."}, status=status.HTTP_400_BAD_REQUEST
            )
        reasons = deletion.blockers(account, account_type)
        if reasons:
            body = {"code": "deletion_blocked", "reasons": reasons}
            if deletion.OPEN_ORDERS in reasons:
                body["order_ids"] = deletion.open_order_ids(account, account_type)
            return Response(body, status=status.HTTP_409_CONFLICT)
        with transaction.atomic():
            step_up.require(request, step_up.ACCOUNT_DELETE)  # a code first when the step-up switch is on
            deletion.delete_account(account, account_type)
        return Response(status=status.HTTP_204_NO_CONTENT)
