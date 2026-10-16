"""Staff reads of holders' money (wallets.view: Accountant, Super Admin). Never an account or MoMo number. Answers
409 ledger_off while the ledger is off. Plan 3b adds withdrawals and the reconciliation runs here."""
import logging
import re

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission, RequiresSudo
from activity.services import record
from fraud.models import FraudFlag
from ledger import escrow
from ledger.models import Account
from payments import providers

from . import payouts, withdrawals
from .models import Withdrawal
from .services import money
from .views import Pagination, ledger_off

logger = logging.getLogger(__name__)
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


STATUS_FILTERS = {
    "open": Withdrawal.OPEN, "succeeded": (Withdrawal.SUCCEEDED,), "failed": (Withdrawal.FAILED,),
    "cancelled": (Withdrawal.CANCELLED,), "all": None,
}
STAFF_FAILED_REASON = "AshantiHub stopped it after checking with the provider."  # what the holder sees, never staff text


def holders_of(rows):
    """{(holder_type, holder_id): name} for these withdrawals, in two queries."""
    customer_ids = {w.holder_id for w in rows if w.holder_type == "customer"}
    owner_ids = {w.holder_id for w in rows if w.holder_type == "business_owner"}
    names = {("customer", pk): name for pk, name in Customer.objects.filter(pk__in=customer_ids).values_list("pk", "full_name")}
    for owner in BusinessOwner.objects.filter(pk__in=owner_ids).select_related("profile"):
        names[("business_owner", owner.pk)] = owner.display_name
    return names


def staff_row(withdrawal, holders):
    return {
        **withdrawals.row(withdrawal), "holder_type": withdrawal.holder_type, "holder_id": withdrawal.holder_id,
        "holder_name": holders.get((withdrawal.holder_type, withdrawal.holder_id), ""), "provider": withdrawal.provider,
        "provider_reference": withdrawal.provider_reference, "submitted_at": withdrawal.submitted_at,
        "stuck": payouts.stuck(withdrawal),
    }


class StaffWithdrawalsView(APIView):
    """GET staff/withdrawals/?status=open|succeeded|failed|cancelled|all — newest first, 20 a page; `open` (held or sent,
    not settled) by default and for an unknown value. Destinations are masked."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        wanted = STATUS_FILTERS.get(request.query_params.get("status") or "open", Withdrawal.OPEN)
        rows = Withdrawal.objects.select_related("destination")
        if wanted is not None:
            rows = rows.filter(status__in=wanted)
        paginator = Pagination()
        page = paginator.paginate_queryset(rows.order_by("-created_at", "-id"), request, view=self)
        holders = holders_of(page)
        return paginator.get_paginated_response([staff_row(withdrawal, holders) for withdrawal in page])


def not_stuck_response():
    return Response(
        {"detail": "Only a withdrawal stuck (sent 30+ minutes ago with no answer, or held and never sent for 10+ minutes) "
                   "can be failed by hand.", "code": "not_stuck"},
        status=status.HTTP_409_CONFLICT,
    )


_NUMBER = re.compile(r"\d(?:[\s-]?\d){5,}")


def mask_numbers(text):
    """A staff note lives in the append-only activity log for good: any run of 6+ digits (spaces or dashes between them
    allowed, as a phone or MoMo number is written) keeps only its last 3 digits."""
    def hide(match):
        digits = re.sub(r"\D", "", match.group())
        return "*" * (len(digits) - 3) + digits[-3:]
    return _NUMBER.sub(hide, text)


def amount_case_open(withdrawal):
    """The provider reported a different amount for it (so money may have left) and fraud staff have not resolved the case."""
    return FraudFlag.objects.filter(dedupe_key=payouts.amount_case_key(withdrawal), status=FraudFlag.OPEN).exists()


class StaffWithdrawalFailView(APIView):
    """POST staff/withdrawals/<id>/fail/ {reason} — fail a withdrawal stuck with the provider (sent 30+ minutes ago with
    no answer, or held and never sent for 10+ minutes) and return the money. wallets.manage and the password again.
    The provider is asked first, outside any transaction: if it has answered (paid or failed), that answer settles it
    instead (409 provider_answered), so money it did pay never comes back to be withdrawn twice. A withdrawal with an
    OPEN amount case (the provider said it paid a different amount, so money did leave) is never failed by hand (409
    amount_case_open); that is checked again under the row lock, and payouts.close refuses it too. The 5-minute poll
    skips any withdrawal that ever had an amount case, so once fraud staff have RESOLVED the case (confirmed or
    dismissed) this is staff's way out: it can be failed here if it is still stuck and the provider does not say it
    paid. A provider that cannot be reached (any error but NotConnected) answers 503 provider_unreachable and changes
    nothing; NotConnected means "not wired to report", so staff's own check stands. A held one never sent is failed
    without asking any provider. The staff note is stored with any 6+ digit run masked. The holder sees STAFF_FAILED_REASON; the staff member's reason stays in the activity event. If the provider
    pays after a hand fail, its late report opens a fraud case and is never posted. No provider text is kept."""

    activity_exempt = True  # records its own event below, and keeps the provider call outside the middleware's transaction

    def get_permissions(self):
        return [HasRolePermission(MANAGE), RequiresSudo()]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        reason = str(data.get("reason") or "").strip()
        if not reason:
            return Response({"reason": "Say why you are failing it."}, status=status.HTTP_400_BAD_REQUEST)
        found = get_object_or_404(Withdrawal, pk=pk)
        if not payouts.stuck(found):  # first, so a not-stuck one costs no provider call and changes nothing
            return not_stuck_response()
        if found.status == Withdrawal.PROCESSING:
            try:
                answer = providers.get_provider(found.provider).status(found.reference)  # outside any transaction
            except providers.NotConnected:
                answer = None  # a provider not wired to report (Hubtel until Plan 7): staff checked with it themselves
            except Exception as exc:
                # A timeout or a 5xx says nothing about the payout: change nothing, staff retry. Only the type is logged.
                logger.warning("Provider status for %s unreachable (%s)", found.reference, type(exc).__name__)
                return Response(
                    {"detail": "The provider could not be reached to check this withdrawal. Nothing was changed; try again shortly.",
                     "code": "provider_unreachable"},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            if answer is not None and answer.status in (providers.SUCCEEDED, providers.FAILED):
                settled = payouts.apply_result(
                    found.reference, answer.status, provider_reference=answer.provider_reference,
                    amount_pesewas=answer.amount_pesewas,
                )
                if settled is not None and settled.status in Withdrawal.FINAL:
                    return Response(
                        {"detail": "The provider has answered for this withdrawal, so its answer settled it.",
                         "code": "provider_answered", "status": settled.status},
                        status=status.HTTP_409_CONFLICT,
                    )
        case_open = Response(
            {"detail": "A payout report for this withdrawal needs a person to review it first. Resolve that case, then try again.",
             "code": "amount_case_open"},
            status=status.HTTP_409_CONFLICT,
        )
        with transaction.atomic():
            withdrawal = get_object_or_404(Withdrawal.objects.select_for_update(), pk=pk)
            if not payouts.stuck(withdrawal):
                return not_stuck_response()
            if amount_case_open(withdrawal):  # inside the lock: a case the poll opened a moment ago is not missed
                return case_open
            before = withdrawal.status
            payouts.close(withdrawal, Withdrawal.FAILED, STAFF_FAILED_REASON, timezone.now())
            if withdrawal.status == Withdrawal.PROCESSING:  # close refused (a case opened); never claim it failed
                return case_open
            # Last: record() holds the activity chain lock until commit. No account number, ever; the staff reason is
            # kept here and never shown to the holder.
            record(
                request.user, "wallets.withdrawal_failed", target=withdrawal,
                summary=f"Withdrawal {withdrawal.reference} failed by staff; GH₵ {money(withdrawal.amount_pesewas)} returned",
                before={"status": before}, after={"status": withdrawal.status, "reason": mask_numbers(reason)[:300]}, request=request,
            )
        return Response(staff_row(withdrawal, holders_of([withdrawal])))


class StaffReconciliationView(APIView):
    """GET staff/reconciliation/ — the last 30 nightly runs, newest day first (wallets.view). With the simulated provider the
    "statement" is built from AshantiHub's own records, not a real provider's; statement_source says so."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        from .models import ReconciliationRun

        return Response({"results": [
            {
                "day": run.day, "provider": run.provider, "status": run.status, "status_label": run.get_status_display(),
                "ledger_in": money(run.ledger_in_pesewas), "statement_in": money(run.statement_in_pesewas),
                "ledger_out": money(run.ledger_out_pesewas), "statement_out": money(run.statement_out_pesewas),
                "in_transit": money(run.in_transit_pesewas), "in_transit_note": "snapshot at run time, not as of the day",
                "unavailable_checks": run.unavailable,
                "statement_source": "simulated (AshantiHub's own records)" if run.provider == "simulated" else run.provider,
                "differences": run.differences, "fraud_case_id": run.flag_id,
                "ran_at": run.ran_at,
            }
            for run in ReconciliationRun.objects.order_by("-day")[:30]
        ]})
