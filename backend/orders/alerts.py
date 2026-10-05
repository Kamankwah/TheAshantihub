"""New-order alerts for business owners.

Called once, when an order is marked paid (payments.services._finalize_order_checkout,
which both the simulated and the Hubtel-webhook paths go through). An order can span
several businesses, so each owner is alerted about their own lines only — the same
isolation rule as OwnerOrderSerializer and the sales report.
"""
from decimal import Decimal

from django.db import transaction

from accounts.emails import send_new_order_email
from notifications.models import Notification
from notifications.services import notify_business_owner


def alert_owners_of_paid_order(order):
    lines_by_owner = {}
    for item in order.items.select_related("listing__business_owner"):
        lines_by_owner.setdefault(item.listing.business_owner, []).append(item)

    for owner, items in lines_by_owner.items():
        lines = [(item.quantity, item.listing.name, item.line_total) for item in items]
        subtotal = sum((item.line_total for item in items), Decimal("0.00"))
        summary = ", ".join(f"{quantity} × {name}" for quantity, name, _ in lines)
        # The in-app alert is a row in the same transaction, so it rolls back with it.
        notify_business_owner(
            owner, Notification.NEW_ORDER, f"New order #{order.id}",
            body=f"{summary} — GHS {subtotal}", link="/business-dashboard", icon="🛍️",
        )
        # The email can't be taken back, so it waits until the payment is committed.
        if owner.email:
            transaction.on_commit(
                lambda email=owner.email, lines=lines, subtotal=subtotal: send_new_order_email(
                    email, order.id, lines, subtotal
                )
            )
