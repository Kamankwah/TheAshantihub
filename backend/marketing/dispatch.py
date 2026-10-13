"""Sending a campaign (Marketing M3). Runs from the minute tick; safe to run twice at once.

Every recipient is re-checked at send time: still opted in, not messaged inside the per-person cap, and the
provider is asked to send. A send outside the window simply waits for the next one (a big send still running at the
end of the window pauses and carries on at the next sending moment). Delivery is never assumed."""
import logging
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from . import audience as audience_rules
from . import consent, messages, policy
from .models import SendPolicy
from .models_campaigns import Campaign, CampaignRecipient
from .models_consent import BUSINESS, CUSTOMER
from .providers import get_provider
from .providers.base import Message, NotConnected

logger = logging.getLogger(__name__)
BATCH = 50
NETWORKS = {"mtn": ("24", "25", "53", "54", "55", "59"), "telecel": ("20", "50"), "airteltigo": ("26", "27", "56", "57")}


def network_of(phone):
    """The mobile network a Ghana number belongs to, from its prefix ('' when unknown). Prefixes move between networks, so this is a guide."""
    from accounts.phones import phone_key

    key = phone_key(phone)
    for name, prefixes in NETWORKS.items():
        if key[:2] in prefixes:
            return name
    return ""


def address_of(campaign, subject):
    if campaign.channel == "email":
        return subject.email or ""
    if campaign.channel == "inapp":
        return "app"
    return (subject.phone if campaign.audience == CUSTOMER else subject.login_phone) or ""


def build_recipients(c, now=None):
    """Queue everyone who is opted in now and not inside the cap; record who was left out and why."""
    cap = SendPolicy.current().per_person_cap_days
    recent = audience_rules.recently_messaged_ids(c.audience, cap, now)
    failing = audience_rules.failing_ids(c.audience, c.channel)
    field = "customer" if c.audience == CUSTOMER else "business_owner"
    rows = []
    for subject in audience_rules.reachable(c.audience, c.filters, c.channel).iterator(chunk_size=500):
        kwargs = {"campaign": c, field: subject}
        address = address_of(c, subject)
        if subject.pk in recent:
            rows.append(CampaignRecipient(status=CampaignRecipient.SKIPPED, skip_reason=CampaignRecipient.CAP, **kwargs))
        elif subject.pk in failing:
            rows.append(CampaignRecipient(status=CampaignRecipient.SKIPPED, skip_reason=CampaignRecipient.FAILED_TWICE, **kwargs))
        elif not address:
            rows.append(CampaignRecipient(status=CampaignRecipient.SKIPPED, skip_reason=CampaignRecipient.NO_CONTACT, **kwargs))
        else:
            rows.append(CampaignRecipient(network=network_of(address) if c.channel in ("sms", "whatsapp") else "", **kwargs))
    CampaignRecipient.objects.bulk_create(rows, batch_size=500, ignore_conflicts=True)


def _deliver(c, provider, row):
    subject = row.subject
    if not consent.is_opted_in(subject, c.channel):
        row.status, row.skip_reason = CampaignRecipient.SKIPPED, CampaignRecipient.OPTED_OUT
        row.save(update_fields=["status", "skip_reason"])
        return
    message = Message(
        channel=c.channel, address=address_of(c, subject), subject=c.subject or c.name, body=messages.render(c, row), recipient=subject,
        unsubscribe_url=messages.stop_url(consent.short_stop_token(row)), campaign_id=c.pk,
    )
    now = timezone.now()
    try:
        result = provider.send(message)
    except NotConnected as exc:
        row.status, row.error = CampaignRecipient.FAILED, exc.message[:200]
        row.save(update_fields=["status", "error"])
        return
    except Exception as exc:     # a provider bug must not stop the rest of the campaign
        logger.exception("Campaign %s send failed", c.pk)
        row.status, row.error = CampaignRecipient.FAILED, str(exc)[:200]
        row.save(update_fields=["status", "error"])
        return
    row.provider_ref = result.ref[:80]
    row.sent_at = now
    if result.state == "failed":
        row.status, row.error = CampaignRecipient.FAILED, result.error[:200]
    elif result.state == "simulated":
        row.status = CampaignRecipient.SIMULATED
    elif c.channel == "inapp" or result.delivered:
        row.status, row.delivered_at = CampaignRecipient.DELIVERED, now
    else:
        row.status = CampaignRecipient.SENT
    row.save(update_fields=["status", "error", "provider_ref", "sent_at", "delivered_at"])


def dispatch(campaign_id, now=None):
    """Advance one campaign. Returns 'waiting' (not time yet / outside the window / not connected), 'sending' or 'sent'."""
    now = now or timezone.now()
    with transaction.atomic():
        c = Campaign.objects.select_for_update().filter(pk=campaign_id).first()
        if c is None or c.status not in (Campaign.SCHEDULED, Campaign.SENDING) or (c.send_at and c.send_at > now):
            return "waiting"
        provider = get_provider(c.channel)
        if not provider.can_send():
            c.note = f"{provider.label} is not connected, so this was not sent."
            c.status = Campaign.FAILED if c.status == Campaign.SCHEDULED else c.status
            c.save()
            return "waiting"
        if policy.send_moment_problem(now):
            return "waiting"
        if c.status == Campaign.SCHEDULED:
            build_recipients(c, now)
            c.status = Campaign.SENDING
            c.provider_state = provider.status()
            c.save()
    while True:
        if policy.send_moment_problem(timezone.now()):
            return "sending"           # paused until the next sending moment
        with transaction.atomic():
            batch = list(CampaignRecipient.objects.select_for_update(skip_locked=True, of=("self",)).select_related("customer", "business_owner").filter(campaign_id=campaign_id, status=CampaignRecipient.QUEUED).order_by("id")[:BATCH])
            if not batch:
                break
            c = Campaign.objects.get(pk=campaign_id)
            for row in batch:
                _deliver(c, provider, row)
    return finish(campaign_id)


def finish(campaign_id):
    with transaction.atomic():
        c = Campaign.objects.select_for_update().get(pk=campaign_id)
        if c.status != Campaign.SENDING:
            return c.status
        if CampaignRecipient.objects.filter(campaign=c, status=CampaignRecipient.QUEUED).exists():
            return "sending"
        c.status, c.sent_at = Campaign.SENT, timezone.now()
        c.save()
    return Campaign.SENT


def tick(now=None):
    """The minute tick: drop requests that missed their time, then advance every campaign that is due or part-way."""
    from .campaigns import expire_unapproved

    now = now or timezone.now()
    dropped = expire_unapproved(now)
    results = {}
    due = Campaign.objects.filter(status__in=[Campaign.SCHEDULED, Campaign.SENDING], send_at__lte=now).values_list("pk", flat=True)
    for pk in due:
        results[pk] = dispatch(pk, now)
    return {"dropped": dropped, "campaigns": results}
