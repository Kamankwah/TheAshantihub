"""Staff reads of holders' money (wallets.view: Accountant, Super Admin). Never an account or MoMo number. Answers
409 ledger_off while the ledger is off. Plan 3b adds withdrawals and the reconciliation runs here; Plan 5 adds
third-party riders (their accounts are held by their staff account, holder_type "staff")."""
import logging

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer, StaffUser
from delivery.models import Rider
from accounts.permissions import HasRolePermission, RequiresSudo
from activity.services import record
from approvals import services as approvals
from approvals.models import ApprovalRequest
from ledger import escrow
from ledger.models import Account

from . import approval_kinds as resolution
from . import payouts, withdrawals
from .approval_kinds import STAFF_FAILED_REASON, amount_case_open, mask_numbers, own_withdrawal  # noqa: F401 (kept importable here)
from .models import Withdrawal
from .services import money
from .views import Pagination, ledger_off

logger = logging.getLogger(__name__)
VIEW, MANAGE = "wallets.view", "wallets.manage"


def rider_rows(page, ids):
    """Third-party riders' balance and reserve (accounts held by their staff account), with the rider company."""
    found = {rider.staff_id: rider for rider in Rider.objects.filter(staff_id__in=ids).select_related("staff")}
    reserve = {
        account.owner_id: account.balance
        for account in Account.objects.filter(
            kind=Account.RIDER_RESERVE, owner_type=StaffUser._meta.label_lower, owner_id__in=[a.owner_id for a in page],
        )
    }
    rows = []
    for account in page:
        rider = found.get(int(account.owner_id))
        rows.append({
            "holder_id": int(account.owner_id), "rider_id": rider.pk if rider else None,
            "name": rider.staff.full_name if rider else "", "company_name": rider.company_name if rider else "",
            "employment": rider.employment if rider else "", "balance": money(account.balance),
            "reserve": money(reserve.get(account.owner_id, 0)),
        })
    return rows


class StaffWalletsView(APIView):
    """GET staff/wallets/?kind=customer|vendor|rider — customers' wallets, vendors' Pending and Available (every vendor
    with a sale has a Pending account), or third-party riders' balance and reserve, largest first, 20 a page."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        kind = request.query_params.get("kind") or "customer"
        if kind not in ("customer", "vendor", "rider"):
            return Response({"kind": "Choose customer, vendor or rider."}, status=status.HTTP_400_BAD_REQUEST)
        if kind == "customer":
            accounts = Account.objects.filter(kind=Account.CUSTOMER_WALLET, owner_type=Customer._meta.label_lower)
        elif kind == "rider":
            accounts = Account.objects.filter(kind=Account.RIDER_BALANCE, owner_type=StaffUser._meta.label_lower)
        else:
            accounts = Account.objects.filter(kind=Account.VENDOR_PENDING, owner_type=BusinessOwner._meta.label_lower)
        paginator = Pagination()
        page = paginator.paginate_queryset(accounts.order_by("-net_credit", "pk"), request, view=self)
        ids = [int(account.owner_id) for account in page]
        if kind == "customer":
            names = dict(Customer.objects.filter(pk__in=ids).values_list("pk", "full_name"))
            rows = [{"holder_id": int(a.owner_id), "name": names.get(int(a.owner_id), ""), "balance": money(a.balance)} for a in page]
        elif kind == "rider":
            rows = rider_rows(page, ids)
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


def holders_of(rows):
    """{(holder_type, holder_id): name} for these withdrawals, in two queries."""
    customer_ids = {w.holder_id for w in rows if w.holder_type == "customer"}
    owner_ids = {w.holder_id for w in rows if w.holder_type == "business_owner"}
    staff_ids = {w.holder_id for w in rows if w.holder_type == "staff"}  # third-party riders
    names = {("customer", pk): name for pk, name in Customer.objects.filter(pk__in=customer_ids).values_list("pk", "full_name")}
    names.update({("staff", pk): name for pk, name in StaffUser.objects.filter(pk__in=staff_ids).values_list("pk", "full_name")})
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


def own_withdrawal_response():
    return Response(
        {"detail": "You cannot resolve your own withdrawal. Ask another member of staff.", "code": "own_withdrawal"},
        status=status.HTTP_403_FORBIDDEN,
    )


def refused(exc):
    body = {"detail": exc.message}
    if exc.code:
        body["code"] = exc.code
    return Response(body, status=exc.status_code)


class StaffWithdrawalResolveView(APIView):
    """POST staff/withdrawals/<id>/resolve/ {outcome: "failed" | "paid", evidence} — ask for a stuck withdrawal (sent 30+
    minutes ago with no answer, or held and never sent for 10+ minutes) to be ended by hand. wallets.manage and the
    password again. It never ends it: it submits a wallets.withdrawal_resolution request (wallets/approval_kinds.py)
    that another holder of wallets.manage (or a Super Admin) approves with the password again; a Super Admin's own
    request waits for someone else too. Answers 201 {approval_id, status, withdrawal}.

    Evidence (a provider reference, what the provider's statement shows) is mandatory, 10+ characters (400
    evidence_required), and is kept with any 6+ digit run masked. Never your own withdrawal (a third-party rider holding
    wallets.manage: 403 own_withdrawal, before the provider is asked; the approval refuses it too). Not stuck: 409
    not_stuck, before any provider call. An OPEN amount case (the provider said it paid a different amount, so money did
    leave): 409 amount_case_open. One request at a time per withdrawal: 409 resolution_pending.

    The provider is asked first, outside any transaction, as the old fail door did: if it has answered (paid or failed),
    that answer settles it instead (409 provider_answered) and no request is made, so money it did pay never comes back to
    be withdrawn twice. While it answers PROCESSING (or anything unmapped) "failed" is refused (409 provider_processing)
    and "paid" may be asked for on evidence. A provider that cannot be reached answers 503 provider_unreachable and
    changes nothing; NotConnected means "not wired to report", so staff's evidence stands. A held one never sent is not
    asked about, and can only be failed. The provider is asked again at approval (see the kind). No provider text is kept."""

    activity_exempt = True  # approvals.submit records the request; keeps the provider call outside the middleware's transaction
    outcome = None  # the fail/ door fixes it

    def get_permissions(self):
        return [HasRolePermission(MANAGE), RequiresSudo()]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        outcome = self.outcome or data.get("outcome")
        if outcome not in resolution.OUTCOMES:
            return Response({"outcome": resolution.OUTCOME_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        try:
            evidence = resolution.clean_evidence(data.get("evidence") or data.get("reason"))
        except resolution.Refused as exc:
            return Response({"evidence": exc.message, "code": exc.code}, status=exc.status_code)
        found = get_object_or_404(Withdrawal, pk=pk)
        if own_withdrawal(request.user, found):  # before any provider call
            return own_withdrawal_response()
        try:
            resolution.gate(found)  # first, so a not-stuck one costs no provider call and changes nothing
            answer = resolution.ask_provider(found)  # outside any transaction
        except resolution.Refused as exc:
            return refused(exc)
        if resolution.final(answer):
            settled = payouts.apply_result(
                found.reference, answer.status, provider_reference=answer.provider_reference, amount_pesewas=answer.amount_pesewas,
            )
            if settled is not None and settled.status in Withdrawal.FINAL:
                # Last: record() holds the activity chain lock until commit. The reference only, no number or staff text.
                with transaction.atomic():
                    record(
                        request.user, "wallets.withdrawal_checked", target=settled,
                        summary=f"Withdrawal {settled.reference} checked with the provider by staff; its answer settled it as {settled.status}",
                        before={"status": found.status}, after={"status": settled.status, **withdrawals.event_amount(settled)},
                        request=request,
                    )
                return Response(
                    {"detail": "The provider has answered for this withdrawal, so its answer settled it.",
                     "code": "provider_answered", "status": settled.status},
                    status=status.HTTP_409_CONFLICT,
                )
            found.refresh_from_db()
            try:
                resolution.gate(found)  # its report opened an amount case: staff review that first
            except resolution.Refused as exc:
                return refused(exc)
        try:
            resolution.check(found, outcome, answer)
        except resolution.Refused as exc:
            return refused(exc)
        if ApprovalRequest.objects.filter(
            kind=resolution.KEY, target_type=Withdrawal._meta.label_lower, target_id=str(found.pk), status=ApprovalRequest.PENDING,
        ).exists():
            return Response(
                {"detail": "A request to resolve this withdrawal is already waiting for approval.", "code": "resolution_pending"},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            approval = approvals.submit(
                request.user, resolution.KEY,
                title=f"Withdrawal {found.reference}: settle as {outcome} (GH₵ {money(found.amount_pesewas)})",
                payload={"withdrawal_id": found.pk, "outcome": outcome, "evidence": evidence},
                target=found, maker_note=evidence, request=request,
            )
        except approvals.ApprovalError as exc:
            return refused(exc)
        found.refresh_from_db()
        return Response(
            {"approval_id": approval.pk, "status": approval.status, "withdrawal": staff_row(found, holders_of([found]))},
            status=status.HTTP_201_CREATED,
        )


class StaffWithdrawalFailView(StaffWithdrawalResolveView):
    """POST staff/withdrawals/<id>/fail/ {reason | evidence} — the older door, kept for its callers: it no longer fails
    anything itself. It submits the same two-person request with outcome "failed", for every amount (see
    StaffWithdrawalResolveView); the reason is the evidence, 10+ characters."""

    outcome = resolution.FAILED


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
