import logging
from decimal import Decimal

from django.db import transaction as db_transaction
from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from billing.models import Transaction

from . import hubtel_client
from .models import CheckoutSession, WebhookEvent
from .serializers import CheckoutSessionStatusSerializer
from .services import finalize_failure, finalize_success

logger = logging.getLogger(__name__)


# Best-guess field names for a Hubtel Checkout webhook payload — UNVERIFIED,
# see hubtel_client.py's module docstring. Tried in order; the first
# matching key wins. Confirm the real shape against Hubtel's docs/sandbox
# before HUBTEL_* env vars are ever set in production.
_REFERENCE_KEYS = ["ClientReference", "clientReference", "reference", "Reference"]
_STATUS_KEYS = ["Status", "status", "PaymentStatus", "paymentStatus"]
_AMOUNT_KEYS = ["Amount", "amount", "AmountPaid", "amountPaid", "TotalAmountCharged"]

# Loose substring classification — Hubtel's exact status vocabulary is
# unconfirmed, so this matches case-insensitively on common substrings
# rather than an exact enum comparison.
_SUCCESS_MARKERS = ("success", "paid", "approved")
_FAILED_MARKERS = ("fail", "cancel", "declin", "reject")
_EXPIRED_MARKERS = ("expire", "timeout")


def _dig(payload, keys):
    """Looks for the first of `keys` present anywhere at the payload's top
    level or inside a nested "Data"/"data" object (Hubtel's own docs show
    both shapes in different API responses) — UNVERIFIED, see module note
    above.
    """
    candidates = [payload]
    for nested_key in ("Data", "data"):
        nested = payload.get(nested_key) if isinstance(payload, dict) else None
        if isinstance(nested, dict):
            candidates.append(nested)
    for candidate in candidates:
        for key in keys:
            if key in candidate:
                return candidate[key]
    return None


def _classify_status(raw_status):
    if not raw_status:
        return None
    lowered = str(raw_status).lower()
    if any(marker in lowered for marker in _SUCCESS_MARKERS):
        return CheckoutSession.SUCCESS
    if any(marker in lowered for marker in _FAILED_MARKERS):
        return CheckoutSession.FAILED
    if any(marker in lowered for marker in _EXPIRED_MARKERS):
        return CheckoutSession.EXPIRED
    return None


class HubtelWebhookView(APIView):
    """POST /api/payments/webhook/hubtel/ — Hubtel's payment-status callback.
    This is the **only** source of truth for whether a payment succeeded;
    nothing about the frontend's /payment/return redirect is ever trusted on
    its own (docs/HUBTEL_INTEGRATION.md §8 / §4).

    Order of operations, every one of these load-bearing for the security
    checklist in docs/HUBTEL_INTEGRATION.md §8:
    1. Log the raw payload FIRST, before any branching/validation — even an
       invalid-signature request gets a WebhookEvent row, for reconciliation
       and dispute handling.
    2. Verify the signature; 401 (not 200/400) on failure, and do not
       process the payload any further.
    3. Idempotency: an already-`success` CheckoutSession is a no-op 200, not
       a duplicate ledger entry — keyed off our own `reference`
       (== Hubtel's `clientReference`), not a separate Hubtel-side id.
    4. Amount re-verification: the reported amount is compared against
       `CheckoutSession.amount` (the amount the session was created for
       server-side) — a mismatch is logged and the session is left
       unfinalized, never trusted and applied directly.
    5. Monotonic status: only a currently-`pending` session is ever moved to
       `success`/`failed`/`expired` — a stray/late webhook for an
       already-resolved session is a no-op, never reverted.

    AllowAny + a dedicated `hubtel_webhook` throttle scope (see
    settings.DEFAULT_THROTTLE_RATES) since Hubtel is an unauthenticated
    external caller, not a logged-in app user.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "hubtel_webhook"

    def post(self, request):
        raw_body = request.body
        try:
            payload = request.data if isinstance(request.data, dict) else {}
        except Exception:  # pragma: no cover — defensive, malformed body
            payload = {}

        reference = _dig(payload, _REFERENCE_KEYS)

        # 1. Log the raw payload before any branching — including
        # invalid-signature attempts, per docs/HUBTEL_INTEGRATION.md §8.
        webhook_event = WebhookEvent.objects.create(
            raw_payload=payload,
            signature_valid=False,
            hubtel_reference=reference or "",
        )

        # 2. Signature verification — reject unsigned/invalid requests with
        # 401 and do not process them any further.
        if not hubtel_client.verify_webhook_signature(raw_body, request.headers):
            webhook_event.processing_note = "Rejected: invalid or missing webhook signature."
            webhook_event.save(update_fields=["processing_note"])
            return Response({"detail": "Invalid signature."}, status=401)

        webhook_event.signature_valid = True
        webhook_event.save(update_fields=["signature_valid"])

        if not reference:
            webhook_event.processing_note = "Rejected: no client reference found in payload."
            webhook_event.save(update_fields=["processing_note"])
            return Response({"detail": "Missing reference."}, status=400)

        with db_transaction.atomic():
            try:
                session = CheckoutSession.objects.select_for_update().get(reference=reference)
            except CheckoutSession.DoesNotExist:
                webhook_event.processing_note = f"Unknown reference '{reference}' — no matching CheckoutSession."
                webhook_event.save(update_fields=["processing_note"])
                # 200, not 404/500: we've logged it for reconciliation, but
                # there's nothing actionable for Hubtel to retry differently.
                return Response({"detail": "Reference not recognized, logged."}, status=200)

            # 3. Idempotency — an already-resolved session is a no-op.
            if session.status != CheckoutSession.PENDING:
                webhook_event.processed = True
                webhook_event.processing_note = (
                    f"No-op: session {reference} already {session.status}."
                )
                webhook_event.save(update_fields=["processed", "processing_note"])
                return Response({"detail": "Already processed."}, status=200)

            reported_amount = _dig(payload, _AMOUNT_KEYS)
            if reported_amount is not None:
                try:
                    if Decimal(str(reported_amount)) != session.amount:
                        webhook_event.processing_note = (
                            f"Amount mismatch for {reference}: webhook reported "
                            f"{reported_amount}, session expects {session.amount}. "
                            "Not finalized — flagged for manual reconciliation."
                        )
                        webhook_event.save(update_fields=["processing_note"])
                        logger.warning(
                            "Hubtel webhook amount mismatch for %s: reported=%s expected=%s",
                            reference, reported_amount, session.amount,
                        )
                        return Response({"detail": "Amount mismatch, not processed."}, status=200)
                except Exception:  # pragma: no cover — malformed amount field
                    webhook_event.processing_note = f"Unparseable amount in payload for {reference}."
                    webhook_event.save(update_fields=["processing_note"])
                    return Response({"detail": "Unparseable amount."}, status=200)

            reported_status_raw = _dig(payload, _STATUS_KEYS)
            mapped_status = _classify_status(reported_status_raw)

            if mapped_status == CheckoutSession.SUCCESS:
                txn_kwargs = {
                    "amount": session.amount,
                    "purpose": session.purpose,
                    "status": Transaction.SUCCESS,
                    "reference": session.reference,
                }
                if session.business_owner_id:
                    txn_kwargs["business_owner"] = session.business_owner
                else:
                    txn_kwargs["customer"] = session.customer
                txn = Transaction.objects.create(**txn_kwargs)

                session.status = CheckoutSession.SUCCESS
                session.transaction = txn
                session.save(update_fields=["status", "transaction", "updated_at"])
                finalize_success(session)

                webhook_event.processed = True
                webhook_event.processing_note = f"Finalized success for {reference}."
                webhook_event.save(update_fields=["processed", "processing_note"])
                return Response({"detail": "Processed."}, status=200)

            if mapped_status in (CheckoutSession.FAILED, CheckoutSession.EXPIRED):
                session.status = mapped_status
                session.save(update_fields=["status", "updated_at"])
                finalize_failure(session)

                webhook_event.processed = True
                webhook_event.processing_note = f"Recorded {mapped_status} for {reference}."
                webhook_event.save(update_fields=["processed", "processing_note"])
                return Response({"detail": "Processed."}, status=200)

            # Unrecognized/still-pending status report — log and leave the
            # session pending; not an error, just nothing to do yet.
            webhook_event.processing_note = (
                f"No actionable status for {reference} (raw status: {reported_status_raw!r})."
            )
            webhook_event.save(update_fields=["processing_note"])
            return Response({"detail": "Acknowledged, no action taken."}, status=200)


class CheckoutSessionStatusView(generics.RetrieveAPIView):
    """GET /api/payments/checkout-sessions/{reference}/ — backs the
    frontend's /payment/return polling page. Read-only, scoped to the
    requesting user owning the session (a customer or business owner can
    only ever see their own — 404s otherwise, same "don't leak" convention
    used across this codebase, e.g. orders.OrderDetailView).
    """

    serializer_class = CheckoutSessionStatusSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "reference"
    lookup_url_kwarg = "reference"

    def get_queryset(self):
        user = self.request.user
        if isinstance(user, Customer):
            return CheckoutSession.objects.filter(customer=user)
        if isinstance(user, BusinessOwner):
            return CheckoutSession.objects.filter(business_owner=user)
        return CheckoutSession.objects.none()
