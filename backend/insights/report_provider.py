"""The Accountant's "From the system" sections for My reports. Everything is
counted from records the Accountant's own actions left (disputes resolved,
ticket money released or refunded, credit adjustments, proposals made) over
whole local days start..end; no figure needs a ledger. Called by
reports.providers."""
from django.db.models import Count, Sum

from reports.providers import day_bounds


def _money(value):
    return f"{(value or 0):.2f}"


def accountant_sections(staff, start, end):
    from approvals.models import ApprovalRequest
    from credit.models import CreditScore
    from disputes.models import Dispute
    from events.models import Ticket

    low, high = day_bounds(start, end)
    resolved = Dispute.objects.filter(resolved_by=staff, updated_at__gte=low, updated_at__lt=high)
    refunded = resolved.filter(status=Dispute.RESOLVED, refund_amount__gt=0).aggregate(n=Count("id"), total=Sum("refund_amount"))
    released = Ticket.objects.filter(escrow_released_by_staff=staff, escrow_released_at__gte=low, escrow_released_at__lt=high)
    ticket_refunds = Ticket.objects.filter(refunded_by_staff=staff, refunded_at__gte=low, refunded_at__lt=high).aggregate(n=Count("id"), total=Sum("price"))
    proposals = ApprovalRequest.objects.filter(maker=staff, created_at__gte=low, created_at__lt=high)
    return [
        {
            "key": "disputes",
            "title": "Disputes and refunds",
            "rows": [
                {"label": "Disputes decided", "value": resolved.count()},
                {"label": "Resolved with a refund", "value": refunded["n"] or 0},
                {"label": "Refunded through disputes (GH₵)", "value": _money(refunded["total"])},
            ],
        },
        {
            "key": "escrow",
            "title": "Ticket money",
            "rows": [
                {"label": "Released by you", "value": released.count()},
                {"label": "Refunded by you", "value": ticket_refunds["n"] or 0},
                {"label": "Refunded by you (GH₵)", "value": _money(ticket_refunds["total"])},
            ],
        },
        {
            "key": "pricing",
            "title": "Proposals and credit",
            "rows": [
                {"label": "Proposals sent for approval", "value": proposals.count()},
                {"label": "Credit score adjustments", "value": CreditScore.objects.filter(adjusted_by=staff, adjusted_at__gte=low, adjusted_at__lt=high).count()},
            ],
        },
    ]
