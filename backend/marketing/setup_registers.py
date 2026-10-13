"""Templates, the sender-ID register and the provider checklist (Marketing M3).

Everything the networks and Meta decide is recorded here BY A PERSON: AshantiHub has no connection to
either, so no status is ever set by a machine and none is shown as if it were."""
from datetime import date

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone

from . import messages
from .models_campaigns import Campaign, ProviderStep, SenderId, Template
from .providers import provider_status

STOP_BUTTON = "stop offers"
MAX_NAME = 80
SMS_ROOM_FOR_ONE = 126      # characters left for a one-SMS message once the stop footer is added (canvas guidance)


class RegisterError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _text(data, key, limit, required=False):
    value = str(data.get(key) or "").strip()
    if required and not value:
        raise RegisterError(f"{key.replace('_', ' ').capitalize()} is required.")
    if len(value) > limit:
        raise RegisterError(f"{key.replace('_', ' ').capitalize()} is too long.")
    return value


def template_body(t):
    used = t.campaigns.count()
    last = t.campaigns.order_by("-created_at").first()
    encoding, length = messages.sms_encoding(t.body) if t.channel == Template.SMS else ("", len(t.body))
    out = {
        "id": t.pk, "channel": t.channel, "name": t.name, "body": t.body, "category": t.category, "buttons": t.buttons,
        "meta_status": t.meta_status, "meta_note": t.meta_note, "meta_recorded_by": t.meta_recorded_by.full_name if t.meta_recorded_by_id else None,
        "meta_recorded_at": t.meta_recorded_at, "used": used, "last_used": last.created_at if last else None,
        "updated_at": t.updated_at, "updated_by": t.updated_by.full_name if t.updated_by_id else None,
        "length": length, "encoding": encoding or None,
        "can_use": t.channel == Template.SMS or (t.meta_status == Template.APPROVED and t.category == Template.MARKETING),
    }
    if t.channel == Template.SMS:
        out["room"] = max(0, SMS_ROOM_FOR_ONE - length)
        out["cedi_sign"] = "₵" in t.body
    return out


def clean_template(data, existing=None):
    out = {}
    channel = data.get("channel", existing.channel if existing else None)
    if channel not in (Template.SMS, Template.WHATSAPP):
        raise RegisterError("Choose SMS or WhatsApp.")
    if existing and channel != existing.channel:
        raise RegisterError("A template can't change channel. Make a new one.")
    out["channel"] = channel
    if "name" in data or not existing:
        out["name"] = _text(data, "name", MAX_NAME, required=True)
    if "body" in data or not existing:
        body = _text(data, "body", 1000, required=True)
        problem = messages.contact_problem(body)
        if problem:
            raise RegisterError(problem)
        out["body"] = body
    category = data.get("category", existing.category if existing else Template.MARKETING)
    if category not in (Template.UTILITY, Template.MARKETING):
        raise RegisterError("Choose Marketing or Utility.")
    out["category"] = category if channel == Template.WHATSAPP else Template.MARKETING
    if channel == Template.WHATSAPP:
        buttons = data.get("buttons", existing.buttons if existing else [])
        if not isinstance(buttons, list) or len(buttons) > 3:
            raise RegisterError("A WhatsApp template can have up to 3 buttons.")
        buttons = [str(b).strip()[:25] for b in buttons if str(b).strip()]
        if out["category"] == Template.MARKETING and STOP_BUTTON not in [b.lower() for b in buttons]:
            raise RegisterError("Every marketing template must carry a \"Stop offers\" button.")
        out["buttons"] = buttons
    else:
        out["buttons"] = []
    return out


@transaction.atomic
def save_template(staff, data, template=None):
    fields = clean_template(data, template)
    if template is None:
        template = Template(created_by=staff)
        template.meta_status = Template.NOT_SUBMITTED if fields["channel"] == Template.WHATSAPP else ""
    elif template.channel == Template.WHATSAPP and template.meta_status in (Template.APPROVED, Template.WAITING) \
            and (fields.get("body") != template.body or fields.get("buttons") != template.buttons or fields.get("category") != template.category):
        raise RegisterError("Meta reviewed this wording. Make a new template to change it.", 409)
    elif template.channel == Template.WHATSAPP and template.meta_status == Template.REJECTED:
        template.meta_status, template.meta_note = Template.NOT_SUBMITTED, ""       # edited after a rejection: ready to submit again
    for key, value in fields.items():
        setattr(template, key, value)
    template.updated_by, template.updated_at = staff, timezone.now()
    try:
        template.save()
    except IntegrityError:
        raise RegisterError("That could not be saved.")
    return template


def record_meta(staff, template, status, note):
    if template.channel != Template.WHATSAPP:
        raise RegisterError("Only a WhatsApp template is reviewed by Meta.")
    if status not in (Template.NOT_SUBMITTED, Template.WAITING, Template.APPROVED, Template.REJECTED):
        raise RegisterError("Choose where Meta has got to.")
    note = (note or "").strip()[:300]
    if status == Template.REJECTED and not note:
        raise RegisterError("Write Meta's reason, so it can be fixed and sent again.")
    template.meta_status, template.meta_note = status, note
    template.meta_recorded_by, template.meta_recorded_at = staff, timezone.now()
    template.save()
    return template


def archive_template(template):
    if template.campaigns.filter(status__in=[Campaign.DRAFT, Campaign.WAITING, Campaign.SCHEDULED, Campaign.SENDING]).exists():
        raise RegisterError("A campaign that is not finished uses this template.", 409)
    template.archived_at = timezone.now()
    template.save(update_fields=["archived_at"])


# ─── sender IDs and providers ───────────────────────────────────────────────
def sender_body(s):
    return {
        "id": s.pk, "name": s.name, "network": s.network, "network_label": s.get_network_display(), "status": s.status, "status_label": s.get_status_display(),
        "note": s.note, "used_for": s.used_for, "submitted_on": s.submitted_on, "decided_on": s.decided_on,
        "recorded_by": s.recorded_by.full_name if s.recorded_by_id else None, "updated_at": s.updated_at,
    }


def clean_sender(data, existing=None):
    out = {}
    if existing is None or "name" in data:
        name = _text(data, "name", 11, required=True)
        if not name.replace(" ", "").isalnum():
            raise RegisterError("A sender ID is letters and numbers only (up to 11 characters).")
        out["name"] = name
    if existing is None or "network" in data:
        if data.get("network") not in dict(SenderId.NETWORK_CHOICES):
            raise RegisterError("Choose a network.")
        out["network"] = data["network"]
    if "status" in data or existing is None:
        if data.get("status", SenderId.DRAFT) not in dict(SenderId.STATUS_CHOICES):
            raise RegisterError("Choose where this network has got to.")
        out["status"] = data.get("status", SenderId.DRAFT)
    for key, limit in (("used_for", 120), ("note", 200)):
        if key in data:
            out[key] = _text(data, key, limit)
    for key in ("submitted_on", "decided_on"):
        if key in data:
            raw = data[key]
            try:
                out[key] = date.fromisoformat(raw) if raw else None
            except (TypeError, ValueError):
                raise RegisterError("Dates are YYYY-MM-DD.")
            if out[key] and out[key] > timezone.localdate():
                raise RegisterError("That date is in the future: record what has happened.")
    return out


def save_sender(staff, data, sender=None):
    fields = clean_sender(data, sender)
    sender = sender or SenderId()
    for key, value in fields.items():
        setattr(sender, key, value)
    sender.recorded_by, sender.updated_at = staff, timezone.now()
    try:
        with transaction.atomic():
            sender.save()
    except IntegrityError:
        raise RegisterError("That sender ID is already recorded for this network.", 409)
    return sender


def grouped_senders():
    """One row per sender name with a cell per network (a network with nothing recorded is shown as not recorded)."""
    rows = {}
    for s in SenderId.objects.select_related("recorded_by"):
        row = rows.setdefault(s.name, {"name": s.name, "length": len(s.name), "used_for": "", "networks": {}})
        row["networks"][s.network] = sender_body(s)
        row["used_for"] = row["used_for"] or s.used_for
    return list(rows.values())


def step_body(p):
    return {"id": p.pk, "position": p.position, "title": p.title, "detail": p.detail, "status": p.status, "note": p.note,
            "recorded_by": p.recorded_by.full_name if p.recorded_by_id else None, "recorded_at": p.recorded_at}


def record_step(staff, step, status, note):
    if status not in dict(ProviderStep.STATUS_CHOICES):
        raise RegisterError("Choose to do, in review or done.")
    step.status, step.note = status, (note or "").strip()[:300]
    step.recorded_by, step.recorded_at = staff, timezone.now()
    step.save()
    return step


def email_facts():
    real = provider_status("email")["status"] == "connected"
    return [
        {"label": "Sends as", "value": settings.DEFAULT_FROM_EMAIL},
        {"label": "Mail server", "value": "An SMTP server is configured" if real else "None configured: messages are only written to the server log"},
        {"label": "Domain checks", "value": "Not checked from here (SPF, DKIM and DMARC are set up with the mail host)"},
        {"label": "Unsubscribe", "value": "Link in every email and a one-click header"},
        {"label": "Cost", "value": "No per-message charge is counted"},
    ]


def overview():
    sms = provider_status("sms")
    from .cost import unit_price
    price = unit_price("sms")
    wa_price = unit_price("whatsapp")
    steps = [step_body(p) for p in ProviderStep.objects.filter(provider="whatsapp").select_related("recorded_by")]
    templates = dict(Template.objects.filter(channel=Template.WHATSAPP, archived_at__isnull=True).values_list("meta_status").annotate(n=Count("id")))
    return {
        "sms": {**sms, "price": str(price) if price is not None else None, "price_note": "The planning price set on the server, not a quote from a provider.",
                "balance": None, "balance_note": "No SMS provider is connected, so there is no balance, alert or delivery report to show.",
                "delivery_reports": False, "backup": "None."},
        "senders": grouped_senders(), "networks": [{"key": k, "label": v} for k, v in SenderId.NETWORK_CHOICES],
        "whatsapp": {**provider_status("whatsapp"), "steps": steps, "done": sum(1 for s in steps if s["status"] == "done"), "price_marketing_usd": "0.0225", "price_utility_usd": "0.004",
                     "unit_price": str(wa_price) if wa_price is not None else None, "templates": templates},
        "email": {**provider_status("email"), "facts": email_facts()},
        "inapp": provider_status("inapp"),
    }
