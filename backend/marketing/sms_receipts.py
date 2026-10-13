"""Hubtel delivery receipts (Marketing). Two doors, one rule: a recipient is Delivered only when Hubtel says so.

Callback: POST /api/marketing/sms/hubtel/callback/<token>/ (views_hubtel.py). Reconcile: a periodic status check
(providers/hubtel_sms.py, GET .../v1/messages/{id}) for texts still "sent" after a while. Both call
apply_receipt(), which is idempotent: only a recipient still in "sent" can move, and it moves once."""
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from .models_campaigns import Campaign, CampaignRecipient
from .providers.hubtel_sms import classify


def refresh_cost(campaign_id):
    """actual_cost is the sum of rates Hubtel reported; None while it has reported none."""
    total = CampaignRecipient.objects.filter(campaign_id=campaign_id, provider_cost__isnull=False).aggregate(t=Sum("provider_cost"))["t"]
    Campaign.objects.filter(pk=campaign_id).update(actual_cost=Decimal(total).quantize(Decimal("0.01")) if total is not None else None)


def apply_receipt(message_id, status_word, rate=None, now=None):
    """Record Hubtel's word for a message. Returns 'delivered', 'failed', 'recorded' (unrecognised or in flight), 'duplicate' or 'unknown'."""
    now = now or timezone.now()
    if not message_id:
        return "unknown"
    with transaction.atomic():
        row = CampaignRecipient.objects.select_for_update().filter(provider_ref=message_id, campaign__channel="sms").first()
        if row is None:
            return "unknown"
        if row.status != CampaignRecipient.SENT:
            return "duplicate"                      # already settled (a retried callback) or never sent
        outcome = classify(status_word)
        row.provider_status, row.provider_updated_at = (status_word or "")[:40], now
        fields = ["provider_status", "provider_updated_at"]
        if rate is not None and row.provider_cost is None:
            row.provider_cost = rate
            fields.append("provider_cost")
        if outcome == "delivered":
            row.status, row.delivered_at = CampaignRecipient.DELIVERED, now
            fields += ["status", "delivered_at"]
        elif outcome == "failed":
            row.status, row.error = CampaignRecipient.FAILED, f"Hubtel reported: {(status_word or '')[:60]}"
            fields += ["status", "error"]
        row.save(update_fields=fields)
    if rate is not None:
        refresh_cost(row.campaign_id)
    return outcome or "recorded"


def reconcile(now=None, min_age=timedelta(minutes=15), limit=200):
    """Ask Hubtel about texts still 'sent' after min_age. A text Hubtel cannot be asked about stays 'sent'."""
    from .providers import get_provider

    provider = get_provider("sms")
    if not getattr(provider, "fetch_status", None) or not provider.can_send():
        return 0
    now = now or timezone.now()
    rows = CampaignRecipient.objects.filter(
        campaign__channel="sms", status=CampaignRecipient.SENT, sent_at__lte=now - min_age, sent_at__gte=now - timedelta(days=3),
    ).exclude(provider_ref="").order_by("id")[:limit]
    settled = 0
    for ref in list(rows.values_list("provider_ref", flat=True)):
        answer = provider.fetch_status(ref)
        if answer and apply_receipt(ref, answer[0], answer[1], now) in ("delivered", "failed"):
            settled += 1
    return settled
