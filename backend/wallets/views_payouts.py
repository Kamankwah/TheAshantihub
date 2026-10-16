"""Payout destinations and withdrawals for customers and business owners (spec §8, §2.2 step 5), at /api/wallet/.
Adding or removing a destination and asking for a withdrawal need a step-up code (X-Step-Up-Token) whenever the ledger
is on, whatever OTP_STEP_UP_ENFORCED says (force=True; spec §8 and §11: OTP must precede any wallet going live). The
code is spent inside the transaction that saves, so a refused request keeps it for the retry. No provider call runs
inside a transaction: the account-name lookup comes before it, the payout after it. The holder gets an in-app notice
of every destination added or removed (no number in it). Every endpoint answers 409 ledger_off while the ledger is off."""
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Customer
from ledger import escrow, settings_store
from notifications.services import notify_business_owner, notify_customer
from otp import step_up
from otp.views_authenticator import IsCustomerOrOwner

from . import destinations, payouts, withdrawals
from .views import AmountError, Pagination, ledger_off, parse_amount

IF_NOT_YOU = "If this wasn't you, contact AshantiHub Support now."


def _tell_holder(holder, title, body):
    """An in-app notice about where the holder's money can go. Never a number: rail and institution only."""
    if isinstance(holder, Customer):
        notify_customer(holder, "payout_destination", title, body=body, link="/my-account", icon="🏦")
    else:
        notify_business_owner(holder, "payout_destination", title, body=body, link="/business", icon="🏦")


def _described(destination):
    return f"A {destination.get_rail_display().lower()} ({destination.institution}) payout destination"


class DestinationsView(APIView):
    """GET destinations/ — the holder's live payout destinations (numbers masked) and the cooling period in force.
    POST destinations/ {rail, institution, account_number} or {from_profile: true} + X-Step-Up-Token — add one. A
    request without a code is refused before the provider is asked for the account's name, and adds are throttled
    (each is a provider lookup: a cost, and an answer to "is this account in my name?")."""

    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "wallet_destination"

    def get_throttles(self):
        return super().get_throttles() if self.request.method == "POST" else []

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        now = timezone.now()
        return Response({
            "results": [destinations.row(destination, now) for destination in destinations.live_for(request.user)],
            "cooling_hours": settings_store.current("payout_cooling_hours", now),
        })

    def post(self, request):
        if not escrow.enabled():
            return ledger_off()
        if not step_up.valid(request, step_up.PAYOUT_DESTINATION, force=True):
            raise step_up.StepUpRequired(step_up.PAYOUT_DESTINATION)  # no name lookup without a good code (it spends nothing)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            checked = destinations.check(request.user, data)  # outside any transaction: a provider call
            with transaction.atomic():
                step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)
                destination = destinations.save(request.user, checked)
        except destinations.DestinationError as exc:
            return Response(exc.body(), status=exc.status_code)
        _tell_holder(
            request.user, "A payout destination was added",
            f"{_described(destination)} was added. It can receive money from "
            f"{timezone.localtime(destination.usable_from):%d %b %Y %H:%M}. {IF_NOT_YOU}",
        )
        return Response(destinations.row(destination), status=status.HTTP_201_CREATED)


class DestinationRemoveView(APIView):
    """POST destinations/<id>/remove/ + X-Step-Up-Token — stop paying to it."""

    permission_classes = [IsCustomerOrOwner]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        try:
            with transaction.atomic():
                step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)
                destination = destinations.remove(request.user, pk)
        except destinations.DestinationError as exc:
            return Response(exc.body(), status=exc.status_code)
        _tell_holder(request.user, "A payout destination was removed", f"{_described(destination)} was removed. {IF_NOT_YOU}")
        return Response(status=status.HTTP_204_NO_CONTENT)


class WithdrawalsView(APIView):
    """GET withdrawals/ — the holder's withdrawals, newest first (20 a page).
    POST withdrawals/ {destination, amount, request_id} + X-Step-Up-Token — withdraw to one of the holder's payout
    destinations. A retry with the same request_id, destination and amount answers the withdrawal already made (200)
    and needs no new code; the same request_id with a different destination or amount is refused (409
    request_id_reused). A new one is held, sent at once and answered 201 with what the provider said (succeeded,
    processing or failed)."""

    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        paginator = Pagination()
        page = paginator.paginate_queryset(withdrawals.mine(request.user).select_related("destination"), request, view=self)
        return paginator.get_paginated_response([withdrawals.row(withdrawal) for withdrawal in page])

    def post(self, request):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        try:
            request_id = withdrawals.clean_request_id(data.get("request_id"))
        except withdrawals.WithdrawalError as exc:
            return Response(exc.body(), status=exc.status_code)
        try:
            amount = parse_amount(data.get("amount"))
        except AmountError as exc:
            return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        found = withdrawals.existing(request.user, request_id)
        if found is not None:
            if found.destination_id != data.get("destination") or found.amount_pesewas != amount:
                return Response(
                    {"detail": "That request_id was already used for a different withdrawal.", "code": "request_id_reused"},
                    status=status.HTTP_409_CONFLICT,
                )
            return Response(withdrawals.row(found), status=status.HTTP_200_OK)
        try:
            with transaction.atomic():
                step_up.require(request, step_up.WITHDRAWAL, force=True)
                withdrawal = withdrawals.request(
                    request.user, destination_id=data.get("destination"), amount_pesewas=amount, request_id=request_id,
                )
        except withdrawals.WithdrawalError as exc:
            return Response(exc.body(), status=exc.status_code)
        # Sent outside the transaction: the hold is committed before the provider is asked (wallets.payouts).
        return Response(withdrawals.row(payouts.submit(withdrawal.pk)), status=status.HTTP_201_CREATED)


class WithdrawalCancelView(APIView):
    """POST withdrawals/<id>/cancel/ — take back a withdrawal not sent yet; the money returns to the holder's balance."""

    permission_classes = [IsCustomerOrOwner]

    def post(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        try:
            withdrawal = withdrawals.cancel(request.user, pk)
        except withdrawals.WithdrawalError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(withdrawals.row(withdrawal))
