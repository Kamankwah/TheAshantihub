"""ledger.fee_rules and ledger.setting: a new fee ladder or money-setting value, proposed by Accounting and
approved by a Super Admin (a Super Admin's own change applies at once). Applying never backdates: the
change takes effect at the later of the proposed time and now, so orders already paid keep their snapshot."""
from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import fees, settings_store
from .models import FeeBand, FeeRuleSet, MoneySetting

FEE_RULES_KEY = "ledger.fee_rules"
SETTING_KEY = "ledger.setting"
CATEGORY_LABELS = dict(FeeRuleSet.CATEGORY_CHOICES)


def effective_time(raw):
    """The later of the proposed time (ISO string, or None for now) and now."""
    now = timezone.now()
    if not raw:
        return now
    parsed = parse_datetime(str(raw)) if not isinstance(raw, datetime) else raw
    if parsed is None:
        raise ApprovalError("Use a full date and time, like 2026-11-01T09:00:00Z, for when it starts.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return max(parsed, now)


def bands_as_dicts(rule_set):
    return [
        {"lower": b.lower_pesewas, "upper": b.upper_pesewas, "percent_bp": b.percent_bp, "flat": b.flat_pesewas}
        for b in rule_set.bands.all()
    ] if rule_set else []


def describe_band(band):
    top = "and above" if band["upper"] is None else f"to {band['upper']}"
    price = f"{band['percent_bp'] / 100:g}%" if band["percent_bp"] is not None else f"{band['flat']} pesewas flat"
    return f"{band['lower']} {top}: {price}"


# --- fee rules -------------------------------------------------------------------------------------------

def fee_current_state(request):
    category = request.payload.get("category")
    return {"category": category, "bands": bands_as_dicts(fees.rule_set_in_force(category))}


def fee_validate(request):
    payload = request.payload
    if payload.get("category") not in CATEGORY_LABELS:
        raise ApprovalError("Pick products, services or events.")
    try:
        fees.validate_bands(payload.get("bands") or [])
    except fees.FeeError as exc:
        raise ApprovalError(str(exc)) from exc
    effective_time(payload.get("effective_from"))


def fee_apply(request):
    payload = request.payload
    decider = request.decided_by or request.maker
    rule_set = FeeRuleSet.objects.create(
        category=payload["category"], effective_from=effective_time(payload.get("effective_from")),
        created_by=decider, approval_id=request.pk,
    )
    for band in payload["bands"]:
        FeeBand.objects.create(
            rule_set=rule_set, lower_pesewas=band["lower"], upper_pesewas=band["upper"],
            percent_bp=band["percent_bp"], flat_pesewas=band["flat"],
        )
    # Last: the event refreshes every open fee screen live.
    record(
        decider, "ledger.fee_rules_applied", target=rule_set,
        summary=f"{CATEGORY_LABELS[rule_set.category]} fee rules changed, effective {rule_set.effective_from:%Y-%m-%d %H:%M}",
        after={"category": rule_set.category, "bands": payload["bands"]},
    )


def fee_diff(request):
    before = (request.before or {}).get("bands") or []
    label = CATEGORY_LABELS.get(request.payload["category"], request.payload["category"])
    return [{
        "field": f"{label} fee bands",
        "before": "; ".join(describe_band(b) for b in before) or None,
        "after": "; ".join(describe_band(b) for b in request.payload["bands"]),
    }]


def super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


FEE_RULES = ApprovalKind(
    key=FEE_RULES_KEY, label="Change platform-fee rules", pool_permission="", current_state=fee_current_state,
    apply=fee_apply, response_hours=48, chain_note="Super Admin only", resolve_approver=super_admin_only,
    render_diff=fee_diff, validate=fee_validate, requires_sudo=True,
    consequences=lambda request: ["Applies only to orders paid after it starts. Orders already paid keep the fee they were given."],
)


# --- money settings --------------------------------------------------------------------------------------

def setting_current_state(request):
    key = request.payload.get("key")
    return {"key": key, "value": settings_store.current(key) if key in settings_store.DEFINITIONS else None}


def setting_validate(request):
    payload = request.payload
    try:
        settings_store.clean(payload.get("key"), payload.get("value"))
    except settings_store.SettingError as exc:
        raise ApprovalError(str(exc)) from exc
    effective_time(payload.get("effective_from"))


def setting_apply(request):
    payload = request.payload
    decider = request.decided_by or request.maker
    value = settings_store.clean(payload["key"], payload.get("value"))
    row = MoneySetting.objects.create(
        key=payload["key"], value=value, effective_from=effective_time(payload.get("effective_from")),
        created_by=decider, approval_id=request.pk,
    )
    record(
        decider, "ledger.setting_applied", target=row,
        summary=f"{settings_store.DEFINITIONS[row.key].label} set to {'blank' if value is None else value}",
        after={"key": row.key, "value": value},
    )


def setting_diff(request):
    definition = settings_store.DEFINITIONS[request.payload["key"]]
    before = (request.before or {}).get("value")
    return [{"field": definition.label, "before": None if before is None else str(before), "after": "blank" if request.payload.get("value") in (None, "") else str(request.payload["value"])}]


MONEY_SETTING = ApprovalKind(
    key=SETTING_KEY, label="Change a money setting", pool_permission="", current_state=setting_current_state,
    apply=setting_apply, response_hours=48, chain_note="Super Admin only", resolve_approver=super_admin_only,
    render_diff=setting_diff, validate=setting_validate, requires_sudo=True,
    consequences=lambda request: ["Applies only to orders paid after it starts."],
)
