"""New-order alerts for business owners.

Called once, when an order is marked paid (payments.services._finalize_order_checkout,
which both the simulated and the Hubtel-webhook paths go through). An order can span
several businesses, so each owner is alerted about their own lines only — the same
isolation rule as OwnerOrderSerializer and the sales report.

With the ledger on (it recorded this payment), each owner's in-app alert also carries the platform fee and the amount
due, and is the in-app copy of the money text queued for them (wallets.vendor_texts; spec §6), so a business gets one
notice per order, not two. The customer is never told the platform fee (spec §3.2).
"""
from decimal import Decimal

from django.db import transaction

from accounts.emails import send_new_order_email
from notifications.models import Notification
from notifications.services import notify_business_owner


def alert_owners_of_paid_order(order):
    from wallets import vendor_texts
    from wallets.models import VendorText

    shares = vendor_texts.paid_amounts(order)  # {} unless the ledger recorded this payment; never raises
    lines_by_owner = {}
    for item in order.items.select_related("listing__business_owner"):
        lines_by_owner.setdefault(item.listing.business_owner, []).append(item)

    for owner, items in lines_by_owner.items():
        lines = [(item.quantity, item.line_name, item.line_total) for item in items]
        subtotal = sum((item.line_total for item in items), Decimal("0.00"))
        summary = ", ".join(f"{quantity} × {name}" for quantity, name, _ in lines)
        body = f"{summary} — GHS {subtotal}"
        amounts = shares.get(owner.pk)
        if amounts is not None:
            body = f"{body}. {vendor_texts.paid_line(amounts)}"
        # The in-app alert is a row in the same transaction, so it rolls back with it.
        notice = notify_business_owner(
            owner, Notification.NEW_ORDER, f"New order #{order.id}",
            body=body, link="/business-dashboard", icon="🛍️",
        )
        if amounts is not None and not owner.is_suspended:
            # Queued in this transaction and sent after it commits; never raises (a text never blocks a payment).
            vendor_texts.queue(
                owner, VendorText.ORDER_PAID, vendor_texts.paid_key(order, owner), vendor_texts.paid_text(order, amounts),
                order=order, notification=notice,
            )
        # The email can't be taken back, so it waits until the payment is committed.
        if owner.email:
            transaction.on_commit(
                lambda email=owner.email, lines=lines, subtotal=subtotal: send_new_order_email(
                    email, order.id, lines, subtotal
                )
            )
