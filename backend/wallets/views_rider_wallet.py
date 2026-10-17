"""A third-party rider's own wallet at /api/delivery/rider/wallet/ (permission delivery.dispatch; always the caller's own
rows; wallets Plan 5, spec §7). Every endpoint answers 409 ledger_off while the ledger is off, then 409 wallet_disabled
for AshantiHub's own riders (their pay stays with payroll). Destinations and withdrawals are the Stage 3b holder views
(wallets.views_payouts) with the rider's permission: the same step-up codes (X-Step-Up-Token), name check (the rider's
staff name, once an approved Ghana Card is on file), cooling period and limits.

Riders are staff accounts, so their writes would pass through the staff activity middleware, which runs the view inside a
transaction and stores the request body: these views are activity_exempt (the body holds an account number, and the
account-name lookup and the payout must run outside any transaction) and record their own event, without the number,
through the `saved()` hook inside the transaction that saves."""
from datetime import date, timedelta

from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from activity.services import record
from delivery import employment
from delivery.models import Rider, RiderCommissionPosting, RiderEarning
from ledger import escrow

from . import rider_wallet, views_payouts
from .models import PayoutDestination
from .services import money
from .views import OFF, Pagination, ledger_off

RIDER_PERMISSION = "delivery.dispatch"
BAD_DAY = "Use a date like 2026-10-16."


class LedgerOff(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self):
        super().__init__({"detail": OFF, "code": "ledger_off"})


class WalletDisabled(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self):
        super().__init__({"detail": employment.WALLET_DISABLED, "code": "wallet_disabled"})


def parse_day(raw):
    """A YYYY-MM-DD query value as a date; None when absent. Raises ValueError when it is not a date."""
    if raw in (None, ""):
        return None
    return date.fromisoformat(str(raw))


class RiderWalletMixin:
    """delivery.dispatch, then the ledger on (409 ledger_off), then a third-party rider (409 wallet_disabled), in that
    order; `self.wallet_rider` is the caller's Rider."""

    activity_exempt = True

    def get_permissions(self):
        return [HasRolePermission(RIDER_PERMISSION)]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not escrow.enabled():
            raise LedgerOff()
        self.wallet_rider = employment.wallet_rider(request.user)
        if self.wallet_rider is None:
            raise WalletDisabled()

    def saved(self, request, event, obj):
        if isinstance(obj, PayoutDestination):
            done = "added" if event == "destination_added" else "removed"
            summary = f"{obj.get_rail_display()} ({obj.institution}) payout destination {done}"
            after = {"rail": obj.rail, "institution": obj.institution}
        else:
            done = "asked for" if event == "withdrawal_requested" else "cancelled"
            summary = f"Withdrawal {obj.reference} of GH₵ {money(obj.amount_pesewas)} {done}"
            after = {"reference": obj.reference, "amount": money(obj.amount_pesewas), "status": obj.status}
        # Last in the transaction that saved it: record() holds the activity chain lock until commit. Never the number.
        record(request.user, f"wallets.rider_{event}", target=obj, summary=summary, after=after, request=request)


class RiderWalletView(RiderWalletMixin, APIView):
    """GET rider/wallet/ — the balance (withdrawable; below zero after a refund took a delivery back), the reserve
    (AshantiHub's commission, held until it is taken after midnight; read-only), the commission rate for orders paid now, the rider
    company, and how many delivered orders still wait for Support's call."""

    def get(self, request):
        return Response(rider_wallet.summary(self.wallet_rider))


class RiderEarningsView(RiderWalletMixin, APIView):
    """GET rider/wallet/earnings/?day=YYYY-MM-DD — what each delivery earned, newest first, 20 a page."""

    def get(self, request):
        try:
            day = parse_day(request.query_params.get("day"))
        except ValueError:
            return Response({"day": BAD_DAY}, status=status.HTTP_400_BAD_REQUEST)
        paginator = Pagination()
        page = paginator.paginate_queryset(rider_wallet.earnings(self.wallet_rider, day), request, view=self)
        return paginator.get_paginated_response([rider_wallet.earning_row(earning) for earning in page])


class RiderDaysView(RiderWalletMixin, APIView):
    """GET rider/wallet/days/ — each posted day's deliveries, gross, AshantiHub's commission and net (the last 30)."""

    def get(self, request):
        return Response({"results": rider_wallet.days(self.wallet_rider)})


class RiderStatementView(RiderWalletMixin, APIView):
    """GET rider/wallet/statement/ — every ledger line on the rider's balance and reserve, newest first, 20 a page."""

    def get(self, request):
        paginator = Pagination()
        page = paginator.paginate_queryset(rider_wallet.statement_lines(self.wallet_rider), request, view=self)
        return paginator.get_paginated_response([rider_wallet.line_row(line) for line in page])


class RiderDestinationsView(RiderWalletMixin, views_payouts.DestinationsView):
    """GET/POST rider/wallet/destinations/ — as /api/wallet/destinations/ (Stage 3b), for the rider."""


class RiderDestinationRemoveView(RiderWalletMixin, views_payouts.DestinationRemoveView):
    """POST rider/wallet/destinations/<id>/remove/ — as /api/wallet/destinations/<id>/remove/."""


class RiderWithdrawalsView(RiderWalletMixin, views_payouts.WithdrawalsView):
    """GET/POST rider/wallet/withdrawals/ — as /api/wallet/withdrawals/; a rider withdraws their balance only."""


class RiderWithdrawalCancelView(RiderWalletMixin, views_payouts.WithdrawalCancelView):
    """POST rider/wallet/withdrawals/<id>/cancel/ — as /api/wallet/withdrawals/<id>/cancel/."""


# --- staff reads (wallets.view: Accountant, Super Admin) ------------------------------------------------------------

STAFF_PERMISSION = "wallets.view"


class StaffRiderWalletView(APIView):
    """GET riders/<id>/wallet/ — one rider's balance, reserve, last 20 earnings and last 30 posted days (wallets.view)."""

    def get_permissions(self):
        return [HasRolePermission(STAFF_PERMISSION)]

    def get(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=pk)
        return Response({
            "rider": {
                "id": rider.pk, "staff_id": rider.staff_id, "name": rider.staff.full_name, "employment": rider.employment,
                "company_name": rider.company_name, "third_party_since": rider.third_party_since,
            },
            **rider_wallet.summary(rider),
            "earnings": [rider_wallet.earning_row(earning) for earning in rider_wallet.earnings(rider)[:20]],
            "days": rider_wallet.days(rider),
        })


class StaffRiderCommissionView(APIView):
    """GET rider-commission/?day=YYYY-MM-DD — every rider's commission posted for that day (default yesterday, Accra),
    with the day's totals (wallets.view)."""

    def get_permissions(self):
        return [HasRolePermission(STAFF_PERMISSION)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            day = parse_day(request.query_params.get("day")) or timezone.localdate() - timedelta(days=1)
        except ValueError:
            return Response({"day": BAD_DAY}, status=status.HTTP_400_BAD_REQUEST)
        rows = RiderCommissionPosting.objects.filter(day=day).select_related("rider__staff").order_by("rider__staff__full_name", "pk")
        totals = rows.aggregate(
            deliveries=Sum("deliveries"), gross=Sum("gross_pesewas"), commission=Sum("commission_pesewas"), net=Sum("net_pesewas"),
        )
        # A posting row is never edited: commission given back for a delivery refunded in full afterwards is shown beside it.
        back = dict(
            RiderEarning.objects.filter(reversed_at__isnull=False, commission_posting__day=day)
            .values("rider_id").annotate(total=Sum("reserve_pesewas")).values_list("rider_id", "total")
        )
        return Response({
            "day": day,
            "results": [
                {
                    "rider_id": row.rider_id, "name": row.rider.staff.full_name, "company_name": row.rider.company_name,
                    "deliveries": row.deliveries, "gross": money(row.gross_pesewas), "commission": money(row.commission_pesewas),
                    "net": money(row.net_pesewas), "given_back": money(back.get(row.rider_id, 0)), "posted_at": row.posted_at,
                }
                for row in rows
            ],
            "totals": {
                "deliveries": totals["deliveries"] or 0, "gross": money(totals["gross"] or 0),
                "commission": money(totals["commission"] or 0), "net": money(totals["net"] or 0),
                "given_back": money(sum(back.values())),
            },
        })
