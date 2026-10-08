import datetime as dt
import hashlib
import ipaddress
import json
import logging

from django.db import connection, transaction
from django.utils import timezone

from accounts.serializers import mask_but_last

from .models import ActivityEvent

logger = logging.getLogger(__name__)

GENESIS = "0" * 64
CHAIN_LOCK_KEY = 72210001  # pg_advisory_xact_lock key serialising chain writes
MAX_JSON_CHARS = 8000
SECRET_MARKERS = (
    "password", "token", "secret", "otp", "totp", "recovery",
    "api_key", "apikey", "authorization", "credential",
)
SECRET_EXACT_KEYS = ("code", "pin", "cvv")
SECRET_SUFFIXES = ("_code", "_pin")

# Callables run after commit with each saved event (plan 1B: realtime publish).
on_recorded = []


def _is_secret_key(key):
    lowered = str(key).lower()
    return (
        any(marker in lowered for marker in SECRET_MARKERS)
        or lowered in SECRET_EXACT_KEYS
        or lowered.endswith(SECRET_SUFFIXES)
    )


def redact(value):
    if isinstance(value, dict):
        return {k: "[redacted]" if _is_secret_key(k) else redact(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


MASKED_KEYS = (
    "counterpart_phone", "payout_momo_number", "payout_bank_account_number",
    "momo_number", "account_number", "bank_account_number",
)


def _mask_value(value):
    if isinstance(value, dict):
        return {
            k: mask_but_last(str(v), keep=3)
            if str(k).lower() in MASKED_KEYS and isinstance(v, (str, int)) and not isinstance(v, bool) and str(v)
            else _mask_value(v)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_mask_value(v) for v in value]
    return value


def _without_nul(value):
    """Postgres jsonb refuses NUL characters; request bodies are untrusted."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, dict):
        return {_without_nul(k): _without_nul(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_without_nul(v) for v in value]
    return value


def _bounded(value):
    if value is None:
        return None
    text = json.dumps(_without_nul(_mask_value(redact(value))), default=str, sort_keys=True)
    if len(text) > MAX_JSON_CHARS:
        return {"truncated": True, "preview": text[:MAX_JSON_CHARS]}
    return json.loads(text)


def _actor_fields(actor):
    from accounts.models import BusinessOwner, Customer, StaffUser

    if actor is None:
        return {"actor_type": ActivityEvent.SYSTEM, "actor_id": None, "actor_role": "", "actor_label": "System"}
    if isinstance(actor, StaffUser):
        return {
            "actor_type": ActivityEvent.STAFF, "actor_id": actor.pk,
            "actor_role": actor.role.name, "actor_label": actor.full_name,
        }
    if isinstance(actor, BusinessOwner):
        return {"actor_type": ActivityEvent.BUSINESS_OWNER, "actor_id": actor.pk, "actor_role": "", "actor_label": actor.full_name}
    if isinstance(actor, Customer):
        return {"actor_type": ActivityEvent.CUSTOMER, "actor_id": actor.pk, "actor_role": "", "actor_label": actor.full_name}
    raise TypeError(f"Unsupported activity actor: {type(actor).__name__}")


def hashable_fields(event):
    return {
        "occurred_at": event.occurred_at.astimezone(dt.timezone.utc).isoformat(),
        "actor_type": event.actor_type,
        "actor_id": event.actor_id,
        "actor_role": event.actor_role,
        "actor_label": event.actor_label,
        "on_behalf_of_id": event.on_behalf_of_id,
        "verb": event.verb,
        "method": event.method,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "target_label": event.target_label,
        "summary": event.summary,
        "before": event.before,
        "after": event.after,
        "ip": _canonical_ip(event.ip),
        "user_agent": event.user_agent,
        "request_id": event.request_id,
    }


def compute_hash(prev_hash, fields):
    payload = prev_hash + json.dumps(fields, default=str, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _canonical_ip(value):
    """Canonical string for an IP, or None if absent/invalid (zone ids included).
    Used both when recording and when hashing, so Postgres' own normalisation
    of the stored value can never change an event's hash."""
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(str(value).strip()))
    except ValueError:
        return None


def _client_ip(request):
    # X-Real-IP is set by nginx to $remote_addr and cannot be spoofed by the
    # client; X-Forwarded-For is client-controlled and deliberately ignored.
    return _canonical_ip(request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR"))


def client_ip(request):
    """Public name for the canonical client IP (accounts.sessions reads it)."""
    return _client_ip(request)


def _notify(event):
    for hook in list(on_recorded):
        try:
            hook(event)
        except Exception:
            logger.exception("activity on_recorded hook failed for event %s", event.pk)


def record(actor, verb, *, target=None, target_type="", target_id="", target_label="",
           summary="", before=None, after=None, method="", request=None, on_behalf_of=None):
    django_request = getattr(request, "_request", request)
    if target is not None:
        target_type = target._meta.label_lower
        target_id = str(target.pk)
        target_label = str(target)
    event = ActivityEvent(
        occurred_at=timezone.now(),
        on_behalf_of_id=getattr(on_behalf_of, "pk", None),
        verb=verb[:100],
        method=method[:8],
        target_type=target_type[:50],
        target_id=str(target_id)[:64],
        target_label=_without_nul(str(target_label))[:200],
        summary=_without_nul(str(summary))[:300],
        before=_bounded(before),
        after=_bounded(after),
        ip=_client_ip(django_request) if django_request is not None else None,
        user_agent=django_request.META.get("HTTP_USER_AGENT", "")[:300] if django_request is not None else "",
        request_id=getattr(django_request, "activity_request_id", "") if django_request is not None else "",
        **_actor_fields(actor),
    )
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [CHAIN_LOCK_KEY])
        prev = ActivityEvent.objects.order_by("-id").values_list("hash", flat=True).first() or GENESIS
        event.prev_hash = prev
        event.hash = compute_hash(prev, hashable_fields(event))
        event.save(force_insert=True)
        transaction.on_commit(lambda: _notify(event))
    if django_request is not None:
        django_request._activity_recorded = True
    return event


def verify_chain():
    """(True, None) if every event links to the previous one and its hash
    matches its content; otherwise (False, id_of_first_bad_event)."""
    prev = GENESIS
    for event in ActivityEvent.objects.order_by("id").iterator(chunk_size=2000):
        if event.prev_hash != prev or event.hash != compute_hash(prev, hashable_fields(event)):
            return False, event.pk
        prev = event.hash
    return True, None
