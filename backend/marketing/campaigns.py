"""Campaign rules: estimates, the checks before a send, and every state change (Marketing M3).

A campaign moves draft -> (waiting for Super Admin) -> scheduled -> sending -> sent. Only a draft or a
withdrawn campaign can be edited, which is also what keeps an approval honest: the approver signs
exactly what was asked for (a change after the request would make it stale)."""
import hashlib
import json
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from activity.services import record
from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.services import ApprovalError

from . import audience as audience_rules
from . import cost, messages, policy
from .models import SendPolicy
from .models_campaigns import Campaign, CampaignRecipient, SenderId, Template
from .models_consent import CHANNEL_LABELS, CUSTOMER, Segment
from .providers import get_provider, provider_status

KIND = "marketing.campaign"
MAX_NAME = 120
REMIND_SECONDS = 2 * 3600


class CampaignError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def signature(c):
    """Everything an approver signs. If any of it changes, the request is stale."""
    data = {
        "name": c.name, "channel": c.channel, "segment": c.segment_id, "filters": c.filters, "body": c.body, "subject": c.subject,
        "link": c.link_path, "send_at": c.send_at.isoformat() if c.send_at else None, "template": c.template_id,
        "recipients": c.est_recipients, "cost": str(c.est_cost),
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:24]


def estimate(c):
    """(recipients, segments_each, cost, cost_known, skipped_by_cap, matched): what sending would reach and cost today."""
    if not c.segment_id:
        return 0, 1, Decimal("0"), True, 0, 0
    counted = audience_rules.count_for(c.audience, c.filters, c.channel)
    recipients = max(0, counted["count"] - counted["skipped_by_cap"])
    segments = messages.sms_segments(messages.render(c, example=True)) if c.channel == "sms" else 1
    amount, known = cost.estimate(c.channel, recipients * segments)
    return recipients, segments, amount, known, counted["skipped_by_cap"], counted["matched"]


def refresh_estimate(c):
    recipients, _, amount, known, _, _ = estimate(c)
    c.est_recipients, c.est_cost, c.cost_known = recipients, amount, known


def needs_approval(c):
    return cost.needs_approval(c.channel, c.est_recipients * (messages.sms_segments(messages.render(c, example=True)) if c.channel == "sms" else 1), policy.approval_threshold())


def checks(c):
    """The 'checks before it can go' list: [{key, title, detail, state: ok|warn|block}]. 'block' stops a send."""
    out = []
    status = provider_status(c.channel) if c.channel in CHANNEL_LABELS else None
    if status is None:
        return [{"key": "channel", "title": "Channel", "detail": "Choose a channel.", "state": "block"}]
    if status["status"] == "not_connected":
        out.append({"key": "provider", "title": "Provider", "detail": f"{status['label']} is not connected, so this can be saved as a draft but not sent.", "state": "block"})
    elif status["status"] == "simulated":
        out.append({"key": "provider", "title": "Provider", "detail": f"{status['label']} is simulated: the send is recorded here and nothing reaches anyone.", "state": "warn"})
    else:
        out.append({"key": "provider", "title": "Provider", "detail": f"{status['label']} is connected.", "state": "ok"})
    if not c.segment_id:
        out.append({"key": "consent", "title": "Consent", "detail": "Pick an audience. Only people with an opt-in on record for this channel can be picked.", "state": "block"})
    elif c.est_recipients == 0:
        out.append({"key": "consent", "title": "Consent", "detail": "Nobody in this audience has an opt-in on record for this channel yet.", "state": "block"})
    else:
        out.append({"key": "consent", "title": "Consent", "detail": f"all {c.est_recipients:,} have {CHANNEL_LABELS[c.channel]} opt-in on record", "state": "ok"})
    out.append({"key": "stop", "title": "Opt-out link", "detail": "added to every message" if c.channel != "whatsapp" else "WhatsApp templates carry a Stop offers button", "state": "ok"})
    if not c.body.strip():
        out.append({"key": "message", "title": "Message", "detail": "Write the message.", "state": "block"})
    else:
        problem = messages.contact_problem(c.body)
        out.append({"key": "message", "title": "Message", "detail": problem or "from AshantiHub, no business contact details", "state": "block" if problem else "ok"})
    if c.channel == "email" and not c.subject.strip():
        out.append({"key": "subject", "title": "Subject", "detail": "An email needs a subject line.", "state": "block"})
    if c.send_at is None:
        out.append({"key": "window", "title": "Send window", "detail": "Pick a send time.", "state": "block"})
    else:
        problem = policy.send_moment_problem(c.send_at)
        if c.send_at <= timezone.now():
            problem = "That time has passed."
        out.append({"key": "window", "title": "Send window", "detail": problem or f"{timezone.localtime(c.send_at):%a %d %b %H:%M} is inside the sending window", "state": "block" if problem else "ok"})
    cap = SendPolicy.current().per_person_cap_days
    out.append({"key": "cap", "title": "Frequency cap", "detail": f"people messaged in the last {cap} days are left out when it sends", "state": "ok"})
    if c.channel == "sms":
        registered = SenderId.objects.filter(status=SenderId.APPROVED).values("name").distinct().count()
        out.append({"key": "sender", "title": "Sender ID", "detail": "recorded as approved on at least one network" if registered else "no sender ID is recorded as approved yet (see Sender IDs & providers)", "state": "ok" if registered else "warn"})
    threshold = policy.approval_threshold()
    amount, known = c.est_cost, c.cost_known
    if not known:
        out.append({"key": "budget", "title": "Budget", "detail": "no price is set for this channel, so the cost is unknown: Super Admin approves it", "state": "warn"})
    elif amount > threshold:
        out.append({"key": "budget", "title": "Budget", "detail": f"GH₵ {amount} is above GH₵ {threshold}: needs Super Admin", "state": "warn"})
    else:
        out.append({"key": "budget", "title": "Budget", "detail": "no approval needed" if amount == 0 else f"GH₵ {amount} is within GH₵ {threshold}", "state": "ok"})
    return out


def blockers(c):
    return [x["detail"] for x in checks(c) if x["state"] == "block"]


def clean_fields(data, staff_filter=True):
    """Validated writable fields from a request body: raises CampaignError."""
    out = {}
    if "name" in data:
        name = str(data["name"]).strip()
        if not name or len(name) > MAX_NAME:
            raise CampaignError("Give the campaign a name (up to 120 characters).")
        out["name"] = name
    if "channel" in data:
        if data["channel"] not in CHANNEL_LABELS:
            raise CampaignError("Choose a channel.")
        out["channel"] = data["channel"]
    for key, limit in (("body", 2000), ("subject", 150), ("link_path", 200)):
        if key in data:
            value = str(data[key] or "").strip() if key != "body" else str(data[key] or "")
            if len(value) > limit:
                raise CampaignError(f"{key.replace('_', ' ').capitalize()} is too long.")
            out[key] = value
    if out.get("link_path") and not out["link_path"].startswith("/"):
        raise CampaignError("The link must be a page on AshantiHub, such as /events.")
    if "link_path" in out and "//" in out["link_path"]:
        raise CampaignError("The link must be a page on AshantiHub, such as /events.")
    if "send_at" in data:
        raw = data["send_at"]
        if raw in (None, ""):
            out["send_at"] = None
        else:
            from django.utils.dateparse import parse_datetime

            when = parse_datetime(str(raw))
            if when is None:
                raise CampaignError("That send time is not valid.")
            if timezone.is_naive(when):
                when = timezone.make_aware(when)
            out["send_at"] = when
    if "segment" in data:
        if data["segment"] in (None, ""):
            out["segment"] = None
        else:
            seg = Segment.objects.filter(pk=data["segment"], archived_at__isnull=True).first()
            if seg is None:
                raise CampaignError("That audience no longer exists.")
            out["segment"] = seg
    if "template" in data:
        if data["template"] in (None, ""):
            out["template"] = None
        else:
            tpl = Template.objects.filter(pk=data["template"], archived_at__isnull=True).first()
            if tpl is None:
                raise CampaignError("That template no longer exists.")
            out["template"] = tpl
    return out


def apply_fields(c, fields):
    seg = fields.pop("segment", "unset")
    if seg != "unset":
        c.segment = seg
        c.audience, c.filters = (seg.audience, seg.filters) if seg else ("", {})
    for key, value in fields.items():
        setattr(c, key, value)
    if c.segment_id and c.segment.channel != c.channel:
        # An audience is counted for one channel (the one its people opted in to).
        c.audience, c.filters = c.segment.audience, c.segment.filters
    c.updated_at = timezone.now()


def audience_for_channel(c):
    """The segment's rules, evaluated for the campaign's own channel (a segment saved for SMS can be reused for email)."""
    return c.audience, c.filters


def save(c, staff, data):
    if c.pk and c.status not in Campaign.EDITABLE:
        raise CampaignError("Withdraw this campaign before changing it.", 409)
    fields = clean_fields(data)
    if c._state.adding and "name" not in fields:
        raise CampaignError("Give the campaign a name.")
    apply_fields(c, fields)
    if c.segment_id and c.channel and c.audience:
        refresh_estimate(c)
    else:
        c.est_recipients, c.est_cost, c.cost_known = 0, Decimal("0"), True
    if c._state.adding:
        c.created_by = staff
    c.save()
    return c


def duplicate(c, staff):
    copy = Campaign(
        name=f"{c.name} (copy)"[:MAX_NAME], channel=c.channel, segment=c.segment, audience=c.audience, filters=c.filters, template=c.template,
        subject=c.subject, body=c.body, link_path=c.link_path, created_by=staff,
    )
    if copy.segment_id:
        refresh_estimate(copy)
    copy.save()
    return copy


def send_for_go(c, staff, request=None):
    """Schedule it, or send it to Super Admin when it costs more than the limit. Returns the campaign."""
    with transaction.atomic():
        c = Campaign.objects.select_for_update().get(pk=c.pk)
        if c.status not in Campaign.EDITABLE:
            raise CampaignError("This campaign is already scheduled or sent.", 409)
        refresh_estimate(c)
        problems = blockers(c)
        if problems:
            raise CampaignError(problems[0], 409 if "not connected" in problems[0] else 400)
        if needs_approval(c):
            payload = {"campaign": c.pk, "recipients": c.est_recipients, "cost": str(c.est_cost), "cost_known": c.cost_known, "signature": None}
            c.status = Campaign.WAITING
            c.save()
            payload["signature"] = signature(c)
            try:
                approval = approvals.submit(
                    staff, KIND, title=f"Send campaign: {c.name}", target=c, payload=payload,
                    maker_note="", request=request,
                )
            except ApprovalError:
                raise
            c.refresh_from_db()
            if c.status == Campaign.WAITING:       # a Super Admin's own request applied at once and already moved it
                c.approval = approval
                c.save(update_fields=["approval"])
            return c
        c.status = Campaign.SCHEDULED
        c.note = ""
        c.save()
        record(staff, "marketing.campaign_scheduled", target=c, summary=f"Scheduled {c.name}", request=request)
        return c


def withdraw(c, staff, request=None):
    with transaction.atomic():
        c = Campaign.objects.select_for_update().get(pk=c.pk)
        if c.status not in (Campaign.WAITING, Campaign.SCHEDULED):
            raise CampaignError("Only a campaign that is waiting or scheduled can be withdrawn.", 409)
        if c.status == Campaign.WAITING and c.approval_id:
            try:
                approvals.cancel(c.approval_id, staff, http_request=request)
            except approvals.NotPending:
                pass
        c.status = Campaign.WITHDRAWN
        c.note = "Withdrawn by " + staff.full_name
        c.save()
        record(staff, "marketing.campaign_withdrawn", target=c, summary=f"Withdrew {c.name}", request=request)
        return c


def remind(c, staff):
    """Nudge the approvers once every two hours."""
    if c.status != Campaign.WAITING or not c.approval_id:
        raise CampaignError("Nothing is waiting for approval.", 409)
    key = f"mk-remind-{c.pk}"
    if cache.get(key):
        raise CampaignError("You reminded them recently. Try again in a couple of hours.", 429)
    from notifications.services import notify_staff

    approval = ApprovalRequest.objects.get(pk=c.approval_id)
    for person in approvals.approvers_for(approval):
        notify_staff(person, "approval_waiting", f"Reminder from {staff.full_name}: {approval.title}", body=approval.target_label, link=f"approvals/{approval.pk}", icon="🗳️")
    cache.set(key, 1, REMIND_SECONDS)


def send_test(c, staff):
    """A test goes only to the sender's own address; it is never sent to an audience. Returns the provider's honest answer."""
    key = f"mk-test-{staff.pk}"
    count = cache.get(key, 0)
    if count >= 5:
        raise CampaignError("That is enough tests for now. Try again in an hour.", 429)
    provider = get_provider(c.channel)
    if not provider.can_send():
        raise CampaignError(f"{provider.label} is not connected, so a test can't be sent.", 409)
    if c.channel == "inapp":
        raise CampaignError("An in-app message can't be sent to a staff account. Preview it below.", 409)
    address = staff.email if c.channel == "email" else (staff.phone or "")
    if not address:
        raise CampaignError("Your account has no phone number, so a test can't be sent to you.", 400)
    from .providers.base import Message

    result = provider.send(Message(channel=c.channel, address=address, subject=c.subject or c.name, body=messages.render(c, example=True), unsubscribe_url=messages.stop_url("test")))
    cache.set(key, count + 1, 3600)
    record(staff, "marketing.campaign_test_sent", target=c, summary=f"Sent a test of {c.name} to themselves ({result.state})")
    return result.state


def expire_unapproved(now=None):
    """A request still waiting when its send time arrives is dropped: nothing is sent and the campaign goes back to Draft."""
    now = now or timezone.now()
    n = 0
    for pk in Campaign.objects.filter(status=Campaign.WAITING, send_at__lte=now).values_list("pk", flat=True):
        with transaction.atomic():
            c = Campaign.objects.select_for_update().get(pk=pk)
            if c.status != Campaign.WAITING:
                continue
            if c.approval_id:
                ApprovalRequest.objects.filter(pk=c.approval_id, status=ApprovalRequest.PENDING).update(
                    status=ApprovalRequest.CANCELLED, decided_at=now, decision_note="The send time passed before it was decided.")
            c.status, c.note = Campaign.DRAFT, "The send time passed before Super Admin decided, so nothing was sent."
            c.save()
            n += 1
    return n
