"""POST recovery/ {account_type, account_id, send_to: "sms" | "email", reason} (otp plan Task 11): Support asks for
a customer's or business owner's sign-in to be recovered; a Super Admin decides it in the approvals inbox
(otp.recovery). A Super Admin's own request applies at once, so it needs the password re-entered.
Answers 201 {"approval_id", "status"}. Recorded by approvals.submit() (approval.requested / applied_directly)."""
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.models import Role
from accounts.permissions import HasRolePermission
from approvals import services as approvals

from . import approval_kinds
from .views import _body, _text

NO_REASON = "Say how you confirmed it is really them."


class RecoveryRequestView(APIView):
    def get_permissions(self):
        return [HasRolePermission("otp.recovery")]

    def post(self, request):
        body = _body(request)
        reason = (_text(body.get("reason")) or "").strip()
        if not reason:
            return Response({"reason": [NO_REASON]}, status=400)
        payload = {"account_type": body.get("account_type"), "account_id": body.get("account_id"), "send_to": body.get("send_to")}
        try:
            account = approval_kinds.check_payload(payload)
            if request.user.role.name == Role.SUPER_ADMIN:
                sessions.require_sudo(request)
            approval = approvals.submit(
                request.user, approval_kinds.KEY, title=f"Recover the sign-in of {account.full_name}"[:200],
                payload=payload, target=account, maker_note=reason[:500], request=request,
            )
        except approvals.ApprovalError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({"approval_id": approval.pk, "status": approval.status}, status=201)
