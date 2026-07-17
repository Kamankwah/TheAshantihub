"""payments.services — the one shared entrypoint every payment call site in
this codebase goes through (docs/HUBTEL_INTEGRATION.md, plan Workstream E).

Every call site that used to do a direct
`billing.Transaction.objects.create(status=Transaction.SUCCESS, ...)` now
calls `process_payment(...)` instead. Behavior is entirely env-driven via
`settings.PAYMENTS_PROVIDER`:

- "simulated" (the default whenever HUBTEL_CLIENT_ID etc. are unset):
  behaves **exactly like today** — immediately creates a SUCCESS Transaction
  and runs the kind's finalizer synchronously. Zero behavior change for
  launch; this is the only path actually exercised until real Hubtel
  merchant credentials exist.
- "hubtel": creates a Hubtel Checkout session via `hubtel_client.py` and
  returns a redirect URL instead. The Transaction is only created once
  `views.HubtelWebhookView` confirms payment — see that view's docstring for
  the full security checklist (signature verification, amount
  re-verification, idempotency, monotonic status).

A per-`kind` finalizer registry (FINALIZERS/FAILURE_HANDLERS below) does the
kind-specific "what actually happens on confirmed payment" step (e.g.
`order.status = PAID`) — called from both the immediate path (here) and the
webhook path (views.HubtelWebhookView), so simulated and real payments
produce identical downstream state.
"""
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from billing.models import Transaction

from . import hubtel_client
from .models import CheckoutSession


def _finalize_order_checkout(session):
    from orders.models import Order

    order_id = session.metadata.get("order_id")
    order = Order.objects.select_for_update().get(id=order_id)
    if order.status == Order.PAID:
        return  # already finalized — idempotency belt-and-suspenders
    order.status = Order.PAID
    order.save(update_fields=["status"])


def _fail_order_checkout(session):
    """Rolls back the optimistic stock reservation made at checkout time when
    an order payment instead fails or expires (Hubtel mode only — the
    immediate/simulated path never fails). Mirrors _fail_ticket_purchase.
    Untestable without real Hubtel credentials today, but written now so the
    behavior exists once credentials are added.
    """
    from listings.models import Listing

    meta = session.metadata
    if meta.get("rolled_back"):
        return  # idempotency belt-and-suspenders
    for reservation in meta.get("stock_reservations", []):
        listing = Listing.objects.select_for_update().get(id=reservation["listing_id"])
        if listing.stock_quantity is not None:
            listing.stock_quantity += reservation["quantity"]
            listing.save(update_fields=["stock_quantity"])
    session.metadata = {**meta, "rolled_back": True}
    session.save(update_fields=["metadata", "updated_at"])


def _finalize_event_pay(session):
    from events.models import Event

    event_id = session.metadata.get("event_id")
    event = Event.objects.select_for_update().get(id=event_id)
    if event.paid_at is not None:
        return  # already finalized
    now = timezone.now()
    event.paid_at = now
    event.expires_at = now + timedelta(days=event.visibility_days)
    event.save(update_fields=["paid_at", "expires_at"])


def _finalize_ticket_purchase(session):
    """Creates the actual Ticket row(s) on confirmed payment. Inventory
    (`EventTicketType.quantity_sold`) is reserved optimistically at checkout
    -session-creation time (see events.views.TicketPurchaseView), before
    process_payment() is ever called — this finalizer only ever creates
    tickets, it never touches quantity_sold. See _fail_ticket_purchase below
    for the rollback path when a session instead fails/expires.
    """
    from events.models import Ticket

    meta = session.metadata
    if meta.get("ticket_ids"):
        return  # already finalized — idempotency belt-and-suspenders

    # session.transaction must already be set by the time this runs — see
    # process_payment()'s immediate branch and views.HubtelWebhookView's
    # success branch, both of which set it before calling finalize_success().
    ticket_type_id = meta["ticket_type_id"]
    quantity = meta["quantity"]
    customer_id = meta["customer_id"]

    tickets = [
        Ticket.objects.create(
            ticket_type_id=ticket_type_id,
            purchased_by_id=customer_id,
            transaction=session.transaction,
            delivery_method=meta["delivery_method"],
            price=meta["unit_price"],
        )
        for _ in range(quantity)
    ]
    session.metadata = {**meta, "ticket_ids": [t.id for t in tickets]}
    session.save(update_fields=["metadata", "updated_at"])


def _fail_ticket_purchase(session):
    """Rolls back the optimistic quantity_sold reservation made at checkout-
    session-creation time when the payment instead fails or expires (Hubtel
    mode only — the immediate/simulated path never fails). Untestable
    without real Hubtel credentials today, but written now per the launch
    plan so the behavior exists once credentials are added.
    """
    from events.models import EventTicketType

    meta = session.metadata
    if meta.get("rolled_back"):
        return  # idempotency belt-and-suspenders
    ticket_type = EventTicketType.objects.select_for_update().get(id=meta["ticket_type_id"])
    ticket_type.quantity_sold = max(0, ticket_type.quantity_sold - meta["quantity"])
    ticket_type.save(update_fields=["quantity_sold"])
    session.metadata = {**meta, "rolled_back": True}
    session.save(update_fields=["metadata", "updated_at"])


def _finalize_subscription(session):
    """Applies the subscribe/change-plan/renew effect that
    billing.SubscribeSerializer.save() already implements, using the plan
    tier + cycle_months captured in metadata at checkout-session-creation
    time (see billing.views.TransactionMineListCreateView). Needed so a real
    Hubtel-confirmed subscription payment (webhook path, where there is no
    follow-up client call once the browser has redirected away to Hubtel and
    back) still actually activates the subscription — not just books the
    Transaction. Safe/idempotent to also run in simulated mode even though
    the frontend today additionally calls POST /api/billing/subscriptions/me/
    itself right after — update_or_create just re-applies the same plan/
    cycle, no material difference.
    """
    from billing.models import Subscription, SubscriptionPlan

    meta = session.metadata
    plan_tier = meta.get("plan")
    cycle_months = meta.get("cycle_months")
    if not plan_tier or not cycle_months or not session.business_owner_id:
        return
    try:
        plan = SubscriptionPlan.objects.get(tier=plan_tier, status=SubscriptionPlan.ACTIVE_STATUS)
    except SubscriptionPlan.DoesNotExist:
        return

    now = timezone.now()
    period_length = timedelta(days=30 * int(cycle_months))
    Subscription.objects.update_or_create(
        business_owner_id=session.business_owner_id,
        defaults={
            "plan": plan,
            "cycle_months": cycle_months,
            "is_trial": False,
            "status": Subscription.ACTIVE,
            "current_period_start": now,
            "current_period_end": now + period_length,
        },
    )


def _finalize_service_request(session):
    """Moves an accepted ServiceRequest to in_progress once the customer's
    payment is confirmed (business item 2 / Wave H2).
    """
    from services.models import ServiceRequest

    request_id = session.metadata.get("service_request_id")
    service_request = ServiceRequest.objects.select_for_update().get(id=request_id)
    if service_request.status != ServiceRequest.ACCEPTED:
        return  # already finalized / not in a payable state — idempotency
    service_request.status = ServiceRequest.IN_PROGRESS
    service_request.paid_at = timezone.now()
    service_request.save(update_fields=["status", "paid_at"])


FINALIZERS = {
    CheckoutSession.ORDER_CHECKOUT: _finalize_order_checkout,
    CheckoutSession.EVENT_PAY: _finalize_event_pay,
    CheckoutSession.TICKET_PURCHASE: _finalize_ticket_purchase,
    CheckoutSession.SUBSCRIPTION: _finalize_subscription,
    CheckoutSession.SERVICE_REQUEST: _finalize_service_request,
}

FAILURE_HANDLERS = {
    CheckoutSession.TICKET_PURCHASE: _fail_ticket_purchase,
    CheckoutSession.ORDER_CHECKOUT: _fail_order_checkout,
}


def finalize_success(session):
    """Runs the kind-specific "payment confirmed" effect. Called from both
    the immediate (simulated) path below and views.HubtelWebhookView's
    success branch, so both paths produce identical downstream state.
    Unknown/no-op kinds (hero_extend, listing_promotion — modeled in
    CheckoutSession.KIND_CHOICES for schema completeness but not yet wired
    to a real call site, see backend/listings/views.py's HeroExtendView/
    ListingPromoteView, which still book their own Transaction directly)
    are a deliberate no-op here, not an error.
    """
    handler = FINALIZERS.get(session.kind)
    if handler:
        handler(session)


def finalize_failure(session):
    """Runs the kind-specific rollback for a session that failed or expired
    instead of succeeding (Hubtel webhook path only)."""
    handler = FAILURE_HANDLERS.get(session.kind)
    if handler:
        handler(session)


def process_payment(*, kind, amount, purpose, business_owner=None, customer=None, metadata=None):
    """The shared entrypoint described in this module's docstring. Returns:
    - `{"mode": "immediate", "transaction": Transaction, "session": CheckoutSession}`
      when PAYMENTS_PROVIDER != "hubtel" — the Transaction already exists and
      the finalizer has already run, exactly as every pre-existing call site
      used to do inline.
    - `{"mode": "redirect", "checkout_url": str, "reference": str, "session": CheckoutSession}`
      when PAYMENTS_PROVIDER == "hubtel" — nothing is finalized yet; the
      caller must return this shape to the frontend so it can redirect.
    """
    if bool(business_owner) == bool(customer):
        raise ValueError("process_payment requires exactly one of business_owner or customer")

    session = CheckoutSession.objects.create(
        business_owner=business_owner,
        customer=customer,
        kind=kind,
        amount=amount,
        purpose=purpose,
        metadata=metadata or {},
    )

    if settings.PAYMENTS_PROVIDER != "hubtel":
        txn_kwargs = {
            "amount": amount,
            "purpose": purpose,
            "status": Transaction.SUCCESS,
            "reference": session.reference,
        }
        if business_owner is not None:
            txn_kwargs["business_owner"] = business_owner
        else:
            txn_kwargs["customer"] = customer
        txn = Transaction.objects.create(**txn_kwargs)

        session.status = CheckoutSession.SUCCESS
        session.transaction = txn
        session.save(update_fields=["status", "transaction", "updated_at"])

        finalize_success(session)

        return {"mode": "immediate", "transaction": txn, "session": session}

    # settings.PAYMENTS_PROVIDER == "hubtel" — UNVERIFIED path, see
    # hubtel_client.py's module docstring. Only ever reached once
    # HUBTEL_CLIENT_ID etc. are actually set, which they are not at launch.
    checkout = hubtel_client.create_checkout(session)
    session.provider = "hubtel"
    session.checkout_url = checkout.get("checkout_url")
    session.hubtel_checkout_id = checkout.get("checkout_id")
    session.save(update_fields=["provider", "checkout_url", "hubtel_checkout_id", "updated_at"])

    return {
        "mode": "redirect",
        "checkout_url": session.checkout_url,
        "reference": session.reference,
        "session": session,
    }
