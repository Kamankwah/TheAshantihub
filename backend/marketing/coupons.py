"""Coupon rules the staff screens use: validation, single-use code generation, activation.

Rules that are always on (shown as plain statements in the editor): one coupon per order, never
on a flash-sale price; AshantiHub pays the discount and the seller keeps the full price; the
minimum spend counts items only; the budget cap is a hard ceiling; a coupon whose cap is above
the approval threshold waits for Super Admin."""
import secrets
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from approvals import services as approvals
from approvals.models import ApprovalRequest
from listings.models import Category

from . import policy as policy_rules
from .models_promos import Coupon, CouponCode
from .promos import cents

KIND_KEY = "marketing.coupon"
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_CODES = 1000
EDITABLE = (Coupon.DRAFT,)


class CouponError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _dec(value, label, minimum=Decimal("0")):
    try:
        out = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise CouponError(f"{label} must be an amount like 15.00.")
    if out < minimum or out > Decimal("9999999"):
        raise CouponError(f"{label} is out of range.")
    return cents(out)


def _int(value, label, minimum=1, maximum=10_000_000):
    if isinstance(value, bool):
        raise CouponError(f"{label} must be a whole number.")
    try:
        out = int(value)
    except (TypeError, ValueError):
        raise CouponError(f"{label} must be a whole number.")
    if not minimum <= out <= maximum:
        raise CouponError(f"{label} must be between {minimum} and {maximum}.")
    return out


def _when(value, end):
    """A date ("2026-11-09") is the start or the very end of that local day; a datetime is kept."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        text = str(value)
        try:
            moment = datetime.fromisoformat(text)
        except ValueError:
            raise CouponError("Dates must look like 2026-11-09.")
        if len(text) <= 10:
            moment = datetime.combine(moment.date(), time(23, 59, 59) if end else time(0, 0))
    return timezone.make_aware(moment) if timezone.is_naive(moment) else moment


def clean(data, existing=None):
    """Validated model fields from a request body (raises CouponError)."""
    d = {**(existing_dict(existing) if existing else {}), **data}
    out = {}
    code = str(d.get("code", "")).strip().upper().replace(" ", "")
    if not (2 <= len(code) <= 30) or not all(c.isalnum() or c in "-_" for c in code):
        raise CouponError("The code must be 2 to 30 letters, numbers or dashes.")
    out["code"] = code
    out["name"] = str(d.get("name", ""))[:120]
    out["code_mode"] = d.get("code_mode") or Coupon.SHARED
    if out["code_mode"] not in (Coupon.SHARED, Coupon.SINGLE_USE):
        raise CouponError("Choose one shared code or single-use codes.")
    out["kind"] = d.get("kind")
    if out["kind"] not in (Coupon.PERCENT, Coupon.FIXED):
        raise CouponError("Choose % off or GH₵ off.")
    out["value"] = _dec(d.get("value"), "The discount", Decimal("0.01"))
    if out["kind"] == Coupon.PERCENT and out["value"] > 100:
        raise CouponError("A percentage can't be more than 100.")
    maxd = d.get("max_discount")
    out["max_discount"] = _dec(maxd, "The most off one order", Decimal("0.01")) if maxd not in (None, "") and out["kind"] == Coupon.PERCENT else None
    out["min_spend"] = _dec(d.get("min_spend") or 0, "The minimum spend")
    out["usage_limit"] = _int(d.get("usage_limit"), "Total uses", 1, MAX_CODES if out["code_mode"] == Coupon.SINGLE_USE else 10_000_000)
    out["per_customer_limit"] = _int(d.get("per_customer_limit", 1), "Per customer", 1, 1000)
    out["starts_at"] = _when(d.get("starts_at"), False)
    out["expires_at"] = _when(d.get("expires_at"), True)
    if out["starts_at"] and out["expires_at"] and out["expires_at"] <= out["starts_at"]:
        raise CouponError("The coupon must expire after it starts.")
    cat = d.get("category")
    if cat in (None, ""):
        out["category"] = None
    else:
        out["category"] = Category.objects.filter(pk=cat).first()
        if out["category"] is None:
            raise CouponError("That category doesn't exist.")
    ceiling = out["value"] if out["kind"] == Coupon.FIXED else out["max_discount"]
    cap = d.get("budget_cap")
    if cap in (None, ""):
        if ceiling is None:
            raise CouponError("A percentage coupon needs 'up to GH₵' per order or a budget cap, so its most cost is known.")
        cap = ceiling * out["usage_limit"]
    out["budget_cap"] = _dec(cap, "The budget cap", Decimal("0.01"))
    return out


def existing_dict(c):
    return {
        "code": c.code, "name": c.name, "code_mode": c.code_mode, "kind": c.kind, "value": c.value, "max_discount": c.max_discount,
        "min_spend": c.min_spend, "usage_limit": c.usage_limit, "per_customer_limit": c.per_customer_limit,
        "starts_at": c.starts_at, "expires_at": c.expires_at, "category": c.category_id, "budget_cap": c.budget_cap,
    }


def code_taken(code, exclude_coupon=None):
    q = Coupon.objects.filter(code__iexact=code)
    if exclude_coupon is not None:
        q = q.exclude(pk=exclude_coupon.pk)
    return q.exists() or CouponCode.objects.filter(code__iexact=code).exists()


def generate_codes(coupon, count):
    """Replace a draft's single-use codes with `count` fresh ones like WB-7KQ2M."""
    coupon.codes.all().delete()
    made = set()
    while len(made) < count:
        code = f"{coupon.code}-" + "".join(secrets.choice(ALPHABET) for _ in range(5))
        if code in made or code_taken(code):
            continue
        made.add(code)
    CouponCode.objects.bulk_create([CouponCode(coupon=coupon, code=c) for c in sorted(made)])


@transaction.atomic
def save_draft(data, staff, coupon=None):
    fields = clean(data, coupon)
    if coupon is not None:
        coupon = Coupon.objects.select_for_update().get(pk=coupon.pk)
        if coupon.status not in EDITABLE:
            raise CouponError("A coupon can only be edited while it is a draft.", 409)
    if code_taken(fields["code"], coupon):
        raise CouponError("That code is already in use.", 409)
    if coupon is None:
        coupon = Coupon(created_by=staff)
    for k, v in fields.items():
        setattr(coupon, k, v)
    coupon.status = Coupon.DRAFT
    coupon.save()
    if coupon.code_mode == Coupon.SINGLE_USE:
        generate_codes(coupon, coupon.usage_limit)
    else:
        coupon.codes.all().delete()
    return coupon


def needs_approval(coupon):
    return coupon.budget_cap > policy_rules.approval_threshold()


@transaction.atomic
def activate(coupon_id, staff, request=None):
    """At or under the approval threshold: live at once. Above it: waits for Super Admin (a
    Super Admin's own request is applied by the engine at once). Returns (coupon, approval|None)."""
    coupon = Coupon.objects.select_for_update().get(pk=coupon_id)
    if coupon.status != Coupon.DRAFT:
        raise CouponError("Only a draft can be activated.", 409)
    if coupon.expires_at and coupon.expires_at <= timezone.now():
        raise CouponError("The expiry date has already passed.")
    if not needs_approval(coupon):
        go_live(coupon, staff)
        return coupon, None
    coupon.status = Coupon.WAITING
    coupon.save(update_fields=["status", "updated_at"])
    try:
        approval = approvals.submit(
            staff, KIND_KEY, title=f"Coupon {coupon.code} could cost GH₵ {coupon.budget_cap}", target=coupon,
            payload={"coupon": coupon.pk, "budget_cap": str(coupon.budget_cap)}, request=request,
        )
    except approvals.ApprovalError as exc:
        raise CouponError(exc.message, getattr(exc, "status_code", 400))
    coupon.refresh_from_db()
    return coupon, approval


def go_live(coupon, staff):
    coupon.status = Coupon.ACTIVE
    coupon.activated_at = timezone.now()
    coupon.activated_by = staff
    coupon.paused_reason, coupon.paused_at = "", None
    coupon.save(update_fields=["status", "activated_at", "activated_by", "paused_reason", "paused_at", "updated_at"])


@transaction.atomic
def pause(coupon_id, reason="Paused by staff"):
    coupon = Coupon.objects.select_for_update().get(pk=coupon_id)
    if coupon.status != Coupon.ACTIVE:
        raise CouponError("Only a live coupon can be paused.", 409)
    coupon.status = Coupon.PAUSED
    coupon.paused_reason, coupon.paused_at = reason[:200], timezone.now()
    coupon.save(update_fields=["status", "paused_reason", "paused_at", "updated_at"])
    return coupon


@transaction.atomic
def resume(coupon_id):
    coupon = Coupon.objects.select_for_update().get(pk=coupon_id)
    if coupon.status != Coupon.PAUSED:
        raise CouponError("Only a paused coupon can be resumed.", 409)
    if coupon.cost_to_date() >= coupon.budget_cap:
        raise CouponError("The budget cap has been reached. Copy the coupon with a new budget instead.", 409)
    coupon.status = Coupon.ACTIVE
    coupon.paused_reason, coupon.paused_at = "", None
    coupon.save(update_fields=["status", "paused_reason", "paused_at", "updated_at"])
    return coupon


@transaction.atomic
def end(coupon_id):
    coupon = Coupon.objects.select_for_update().get(pk=coupon_id)
    if coupon.status not in (Coupon.ACTIVE, Coupon.PAUSED):
        raise CouponError("Only a live or paused coupon can be ended.", 409)
    coupon.status = Coupon.EXPIRED
    coupon.save(update_fields=["status", "updated_at"])
    return coupon


def delete_draft(coupon_id):
    with transaction.atomic():
        coupon = Coupon.objects.select_for_update().get(pk=coupon_id)
        if coupon.status != Coupon.DRAFT:
            raise CouponError("Only a draft can be deleted.", 409)
        coupon.delete()


def pending_approval(coupon):
    return ApprovalRequest.objects.filter(kind=KIND_KEY, status=ApprovalRequest.PENDING, target_type="marketing.coupon", target_id=str(coupon.pk)).first()


def serialize(c, detail=False):
    now = timezone.now()
    cost = c.cost_to_date()
    out = {
        "id": c.pk, "code": c.code, "name": c.name, "code_mode": c.code_mode, "kind": c.kind, "value": str(c.value),
        "max_discount": str(c.max_discount) if c.max_discount is not None else None, "min_spend": str(c.min_spend),
        "usage_limit": c.usage_limit, "uses": c.uses(), "per_customer_limit": c.per_customer_limit,
        "starts_at": c.starts_at, "expires_at": c.expires_at, "category": c.category_id,
        "category_label": c.category.label if c.category_id else None, "status": c.status,
        "effective_status": c.effective_status(now), "budget_cap": str(c.budget_cap), "cost_to_date": str(cost),
        "paused_reason": c.paused_reason, "needs_approval": needs_approval(c), "editable": c.status in EDITABLE,
        "created_at": c.created_at,
    }
    if detail:
        out["sample_codes"] = list(c.codes.values_list("code", flat=True)[:5])
        out["code_count"] = c.codes.count()
        ap = pending_approval(c)
        out["approval_id"] = ap.pk if ap else None
    return out
