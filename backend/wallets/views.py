"""The holder's own money (spec §5, §6), at /api/wallet/: balances, the statement, the payment-processing quote and
top-ups. Customers and business owners only (top-ups and quotes: customers). Every endpoint answers
409 {"code": "ledger_off"} while LEDGER_ENABLED is off, so nothing changes until it is turned on. Staff reads are in
views_staff.py."""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer
from ledger import escrow
from ledger.money import from_pesewas, to_pesewas
from otp.views_authenticator import IsCustomerOrOwner
from payments.models import CheckoutSession
from payments.providers import get_provider
from payments.services import process_payment

from . import services

OFF = "Wallets aren't switched on yet."
MAX_PESEWAS = 9_999_999_999  # a DecimalField(10, 2) holds at most GH₵ 99,999,999.99


def ledger_off():
    return Response({"detail": OFF, "code": "ledger_off"}, status=status.HTTP_409_CONFLICT)


class AmountError(Exception):
    pass


def parse_amount(raw):
    """Pesewas from a GH₵ amount a person typed ("50", "50.5", 50.25). Raises AmountError with the message to show."""
    if raw is None or isinstance(raw, bool) or (isinstance(raw, str) and not raw.strip()):
        raise AmountError("Enter an amount in GH₵.")
    try:
        value = Decimal(str(raw).strip())
    except InvalidOperation:
        raise AmountError("Enter an amount in GH₵, like 50.00.") from None
    if not value.is_finite():
        raise AmountError("Enter an amount in GH₵, like 50.00.")
    if value.copy_abs() > Decimal(MAX_PESEWAS) / 100:
        raise AmountError("That amount is too large.")  # before to_pesewas, which raises InvalidOperation on 1e30
    try:
        pesewas = to_pesewas(value)
    except (ValueError, InvalidOperation):
        raise AmountError("Use at most two decimal places.") from None
    if pesewas <= 0:
        raise AmountError("The amount must be more than GH₵ 0.00.")
    if pesewas > MAX_PESEWAS:
        raise AmountError("That amount is too large.")
    return pesewas


class Pagination(PageNumberPagination):
    page_size = 20


class WalletView(APIView):
    """GET / — the holder's balances: a customer's wallet, or a vendor's Pending and Available."""

    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        return Response(services.summary(request.user))


class TransactionsView(APIView):
    """GET transactions/ — every ledger line on the holder's own accounts, newest first, 20 a page."""

    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        paginator = Pagination()
        page = paginator.paginate_queryset(services.statement_lines(request.user), request, view=self)
        return paginator.get_paginated_response([services.line_row(line) for line in page])


class ProcessingView(APIView):
    """GET processing/?amount= — the payment-processing charge a MoMo payment or top-up of that amount adds on top."""

    permission_classes = [IsCustomer]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            amount = parse_amount(request.query_params.get("amount"))
        except AmountError as exc:
            return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        provider = get_provider()
        charge = provider.collection_charge(amount)
        return Response({
            "amount": services.money(amount), "payment_processing": services.money(charge),
            "you_pay": services.money(amount + charge), "provider": provider.name,
        })


class TopUpView(APIView):
    """POST top-up/ {amount} — add money to the wallet by mobile money. The customer pays the amount plus the provider's
    collection charge; the wallet receives the amount. Simulated: credited at once (201). Hubtel: a checkout to redirect
    to (200); the wallet is credited when HubtelWebhookView confirms the payment (once, however often it is told)."""

    permission_classes = [IsCustomer]

    def post(self, request):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        try:
            amount = parse_amount(data.get("amount"))
        except AmountError as exc:
            return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        charge = get_provider().collection_charge(amount)
        if amount + charge > MAX_PESEWAS:
            return Response({"amount": "That amount is too large."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            result = process_payment(
                kind=CheckoutSession.WALLET_TOPUP, amount=from_pesewas(amount + charge), processing_fee=from_pesewas(charge),
                purpose="AshantiHub wallet top-up", customer=request.user,
                metadata={"credit_pesewas": amount, "ledger": True},
            )
        body = {
            "reference": result["session"].reference, "amount": services.money(amount),
            "payment_processing": services.money(charge), "you_pay": services.money(amount + charge),
        }
        if result["mode"] == "redirect":
            return Response({**body, "mode": "redirect", "checkout_url": result["checkout_url"]}, status=status.HTTP_200_OK)
        return Response({**body, "mode": "immediate", **services.summary(request.user)}, status=status.HTTP_201_CREATED)
