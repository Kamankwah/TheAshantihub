"""Staff reads of holders' money (wallets.view: Accountant, Super Admin). Never an account or MoMo number. Answers
409 ledger_off while the ledger is off. Plan 3b adds withdrawals and the reconciliation runs here."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission
from ledger import escrow
from ledger.models import Account

from .services import money
from .views import Pagination, ledger_off

VIEW, MANAGE = "wallets.view", "wallets.manage"


class StaffWalletsView(APIView):
    """GET staff/wallets/?kind=customer|vendor — customers' wallets, or vendors' Pending and Available (every vendor
    with a sale has a Pending account), largest first, 20 a page."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        kind = request.query_params.get("kind") or "customer"
        if kind not in ("customer", "vendor"):
            return Response({"kind": "Choose customer or vendor."}, status=status.HTTP_400_BAD_REQUEST)
        if kind == "customer":
            accounts = Account.objects.filter(kind=Account.CUSTOMER_WALLET, owner_type=Customer._meta.label_lower)
        else:
            accounts = Account.objects.filter(kind=Account.VENDOR_PENDING, owner_type=BusinessOwner._meta.label_lower)
        paginator = Pagination()
        page = paginator.paginate_queryset(accounts.order_by("-net_credit", "pk"), request, view=self)
        ids = [int(account.owner_id) for account in page]
        if kind == "customer":
            names = dict(Customer.objects.filter(pk__in=ids).values_list("pk", "full_name"))
            rows = [{"holder_id": int(a.owner_id), "name": names.get(int(a.owner_id), ""), "balance": money(a.balance)} for a in page]
        else:
            owners = {owner.pk: owner for owner in BusinessOwner.objects.filter(pk__in=ids).select_related("profile")}
            available = {
                a.owner_id: a.balance
                for a in Account.objects.filter(kind=Account.VENDOR_AVAILABLE, owner_type=BusinessOwner._meta.label_lower, owner_id__in=[a.owner_id for a in page])
            }
            rows = [
                {
                    "holder_id": int(a.owner_id), "name": owners[int(a.owner_id)].display_name if int(a.owner_id) in owners else "",
                    "pending": money(a.balance), "available": money(available.get(a.owner_id, 0)),
                }
                for a in page
            ]
        return paginator.get_paginated_response(rows)
