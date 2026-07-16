"""payments.hubtel_client — the actual HTTP boundary with Hubtel's Checkout
API, plus inbound webhook signature verification.

**UNVERIFIED.** Real Hubtel merchant credentials were not available when
this was written (same-day launch, Hubtel merchant approval pending). Every
request/response field name and the webhook signature scheme below are
structured against docs/HUBTEL_INTEGRATION.md's spec and Hubtel's publicly
documented Checkout API conventions as of this writing, but have **never
been exercised against a real Hubtel sandbox or production account.**

Confirm every field name here — the checkout-creation request/response
shape, the exact webhook signature header name and algorithm, and the
webhook payload's own field names (see views.HubtelWebhookView) — against
Hubtel's real developer docs (or a live sandbox account) before
HUBTEL_CLIENT_ID/HUBTEL_CLIENT_SECRET/HUBTEL_WEBHOOK_SECRET are ever set in
a production environment. Until those env vars are set,
`settings.PAYMENTS_PROVIDER` stays "simulated" and this module is never
called at all — it ships dark and unexercised, per the launch plan's
explicit "never block launch on Hubtel" decision. Sandbox-test all three
MoMo networks (MTN, Vodafone Cash, AirtelTigo) per
docs/HUBTEL_INTEGRATION.md §8 before any production cutover.
"""
import hashlib
import hmac

import requests
from django.conf import settings

# UNVERIFIED endpoint — Hubtel's Checkout/Payment Proxy API base URL as
# publicly documented at the time of writing. Confirm against real docs.
HUBTEL_CHECKOUT_URL = "https://payproxyapi.hubtel.com/items/initiate"

REQUEST_TIMEOUT_SECONDS = 15


def create_checkout(session):
    """POST to Hubtel's Checkout API to create a hosted-checkout session for
    the given payments.models.CheckoutSession. Returns
    {"checkout_url": str, "checkout_id": str|None}.

    UNVERIFIED request/response shape — see module docstring. Deliberately
    does not swallow a transport/HTTP error here (`raise_for_status()`) —
    process_payment()'s caller (the view) is expected to let that propagate
    as a 5xx rather than silently falling back to "success", since a failed
    checkout-session creation must never be mistaken for a confirmed
    payment.
    """
    payload = {
        "totalAmount": float(session.amount),
        "description": session.purpose,
        "clientReference": session.reference,
        "callbackUrl": settings.HUBTEL_CALLBACK_URL,
        "returnUrl": f"{settings.FRONTEND_BASE_URL}/payment/return?reference={session.reference}",
        "cancellationUrl": f"{settings.FRONTEND_BASE_URL}/payment/return?reference={session.reference}",
        "merchantAccountNumber": settings.HUBTEL_MERCHANT_ACCOUNT,
    }
    response = requests.post(
        HUBTEL_CHECKOUT_URL,
        json=payload,
        auth=(settings.HUBTEL_CLIENT_ID, settings.HUBTEL_CLIENT_SECRET),
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    body = response.json()
    # UNVERIFIED response shape — adjust these key names once real docs/a
    # sandbox account exist to confirm them.
    data = body.get("data") or {}
    return {
        "checkout_url": data.get("checkoutUrl") or data.get("checkoutDirectUrl"),
        "checkout_id": data.get("checkoutId"),
    }


def verify_webhook_signature(raw_body: bytes, headers) -> bool:
    """UNVERIFIED — Hubtel's actual signature header name and hashing
    algorithm are not documented anywhere in this repo or confirmed against
    real Hubtel docs. Implemented as a best-guess HMAC-SHA256-over-the-raw-
    request-body scheme (a common pattern for this class of webhook),
    gated behind HUBTEL_WEBHOOK_SECRET, purely so the rest of the webhook
    pipeline (idempotency, amount re-verification, 401-on-invalid,
    always-log-raw-payload-first) has a real interface to call. **Must be
    confirmed/rewritten against Hubtel's actual scheme before HUBTEL_* env
    vars are ever set in production** — do not treat this as verified.

    Returns False (never raises) on any missing secret/header/malformed
    input, so callers can treat "not verified" uniformly as "reject with
    401" regardless of *why* verification failed.
    """
    secret = settings.HUBTEL_WEBHOOK_SECRET
    if not secret:
        return False
    signature = headers.get("X-Hubtel-Signature") or headers.get("Hubtel-Signature")
    if not signature:
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    try:
        return hmac.compare_digest(expected, signature)
    except TypeError:
        return False
