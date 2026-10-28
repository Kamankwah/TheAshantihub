"""How many purchases were paid, and how many of those were refunded, for the Super Admin listings and events tables.

Two real numbers per row; a listing or event nobody bought from is 0 and 0 (shown, never hidden). One purchase is one
count, whatever its quantity. A refunded purchase still counts in "paid", and refunded is always a subset of paid.
Every function is bulk: a fixed number of grouped queries for the whole page, never one per row.

Definitions (shown in the column tooltip):

* Product - paid: distinct `orders.Order` containing a line for the listing whose `status` is `paid`, or `cancelled`
  after a successful payment. `Order` has no `paid_at`: `payments.services._finalize_order_checkout` sets
  `status=paid` and the order's `payments.CheckoutSession` (kind `order_checkout`, `metadata.order_id`) goes to
  `success`, so "cancelled after payment" is a cancelled order that has such a success session (an order cancelled
  before payment, or whose payment failed, has none and is not counted). Refunded: of those, the cancelled-after-paid
  ones, plus, when the ledger is on, any with an `ledger.OrderRefund` row (a partial refund counts only for the shops it paid back; see `_refunded_paid_orders`).
* Service - paid: `services.ServiceRequest` with `paid_at` set. Refunded: of those, status `cancelled`, plus, when the
  ledger is on, any whose `ledger.BookingSale` has a `ledger.BookingRefund`.
* Stay - paid: `bookings.Booking` with `paid_at` set. Refunded: of those, `cancelled_at` set, plus, when the ledger is
  on, any whose sale has a `BookingRefund`.
* Event - paid: every `events.Ticket` of the event's ticket types, each ticket once. Refunded: tickets with
  `refunded_at` set, plus, when the ledger is on, tickets named by a `BookingRefund` whose source is `ticket-<id>`
  (a ticket with both is one).

The ledger is on when `ledger.escrow.enabled()` (settings.LEDGER_ENABLED, default off). With it off no refund rows
exist to read, so the cancel markers above are the only evidence. A cancel marker is used with the ledger on too,
for purchases made before it was switched on.
"""
from django.db.models import Count, Exists, IntegerField, OuterRef, Q
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast

from bookings.models import Booking
from events.models import Ticket
from ledger import escrow
from ledger.models import BookingRefund, OrderRefund
from orders.models import Order, OrderItem
from payments.models import CheckoutSession
from services.models import ServiceRequest


def _add(totals, key, paid, refunded):
    old_paid, old_refunded = totals.get(key, (0, 0))
    totals[key] = (old_paid + paid, old_refunded + refunded)


def _refunded_paid_orders(ids):
    """{listing id: number of still-paid orders refunded for it}. An order can hold several shops' lines and a partial
    refund (a skipped stop) touches only the shops in its `allocation` (entries {business_owner, base, fee, ...}), so a
    partial refund counts for a line only when its shop was given money back; a whole refund counts for every line."""
    refunds = {}
    for order_id, whole, allocation in OrderRefund.objects.filter(
        order__status=Order.PAID, order__items__listing_id__in=ids,
    ).values_list("order_id", "whole", "allocation").distinct():
        entry = refunds.setdefault(order_id, [False, set()])
        entry[0] = entry[0] or whole
        for part in allocation or []:
            if (part.get("base") or 0) > 0 or (part.get("fee") or 0) > 0:
                entry[1].add(part.get("business_owner"))
    seen = set()
    for order_id, listing_id, owner_id in OrderItem.objects.filter(order_id__in=list(refunds), listing_id__in=ids).values_list(
        "order_id", "listing_id", "listing__business_owner_id",
    ):
        whole, owners = refunds[order_id]
        if whole or owner_id in owners:
            seen.add((order_id, listing_id))
    counts = {}
    for _, listing_id in seen:
        counts[listing_id] = counts.get(listing_id, 0) + 1
    return counts


def for_listings(listing_ids):
    """{listing id: (paid, refunded)} for every id given, over its orders, service requests and stay bookings."""
    ids = list(listing_ids)
    totals = {pk: (0, 0) for pk in ids}
    if not ids:
        return totals
    ledger_on = escrow.enabled()

    # Products. An order is paid when status is paid, or cancelled with a successful checkout session.
    paid_sessions = CheckoutSession.objects.filter(kind=CheckoutSession.ORDER_CHECKOUT, status=CheckoutSession.SUCCESS).annotate(
        order_ref=Cast(KeyTextTransform("order_id", "metadata"), IntegerField()),
    ).filter(order_ref=OuterRef("order_id"))
    lines = OrderItem.objects.filter(listing_id__in=ids).annotate(was_paid=Exists(paid_sessions))
    cancelled_after_pay = Q(order__status=Order.CANCELLED, was_paid=True)
    paid = Q(order__status=Order.PAID) | cancelled_after_pay
    refunded = cancelled_after_pay
    for row in lines.values("listing_id").annotate(
        paid=Count("order_id", distinct=True, filter=paid), refunded=Count("order_id", distinct=True, filter=refunded),
    ):
        _add(totals, row["listing_id"], row["paid"], row["refunded"])
    if ledger_on:
        for listing_id, count in _refunded_paid_orders(ids).items():
            _add(totals, listing_id, 0, count)

    # Services.
    refunded = Q(paid_at__isnull=False, status=ServiceRequest.CANCELLED)
    if ledger_on:
        refunded = refunded | Q(paid_at__isnull=False, sale__refunds__isnull=False)
    for row in ServiceRequest.objects.filter(listing_id__in=ids).values("listing_id").annotate(
        paid=Count("id", distinct=True, filter=Q(paid_at__isnull=False)), refunded=Count("id", distinct=True, filter=refunded),
    ):
        _add(totals, row["listing_id"], row["paid"], row["refunded"])

    # Stays.
    refunded = Q(paid_at__isnull=False, cancelled_at__isnull=False)
    if ledger_on:
        refunded = refunded | Q(paid_at__isnull=False, sale__refunds__isnull=False)
    for row in Booking.objects.filter(listing_id__in=ids).values("listing_id").annotate(
        paid=Count("id", distinct=True, filter=Q(paid_at__isnull=False)), refunded=Count("id", distinct=True, filter=refunded),
    ):
        _add(totals, row["listing_id"], row["paid"], row["refunded"])
    return totals


def for_events(event_ids):
    """{event id: (paid, refunded)} for every id given, counted in tickets."""
    ids = list(event_ids)
    totals = {pk: (0, 0) for pk in ids}
    if not ids:
        return totals
    tickets = Ticket.objects.filter(ticket_type__event_id__in=ids)
    for row in tickets.values("ticket_type__event_id").annotate(
        paid=Count("id"), refunded=Count("id", filter=Q(refunded_at__isnull=False)),
    ):
        totals[row["ticket_type__event_id"]] = (row["paid"], row["refunded"])
    if escrow.enabled():
        named = set()
        for source in BookingRefund.objects.filter(sale__event_id__in=ids, source__startswith="ticket-").values_list("source", flat=True):
            tail = source[len("ticket-"):]
            if tail.isdecimal():
                named.add(int(tail))
        if named:
            for row in tickets.filter(pk__in=named, refunded_at__isnull=True).values("ticket_type__event_id").annotate(extra=Count("id")):
                event_id = row["ticket_type__event_id"]
                paid, refunded = totals[event_id]
                totals[event_id] = (paid, refunded + row["extra"])
    return totals
