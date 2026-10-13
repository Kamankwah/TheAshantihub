"""The `marketing.banner` approval: Super Admin only, no amount. A banner goes live only
when this is approved; a Super Admin's own banner applies at once (the engine's rule)."""
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import banners
from .models_banners import Banner

KIND_KEY = banners.KIND


def _super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


def _banner(request):
    return Banner.objects.get(pk=request.payload["banner"])


def _iso(value):
    return value.isoformat() if value else None


def _current_state(request):
    b = _banner(request)
    return {"state": b.state, "slot": b.slot, "title": b.title, "alt_text": b.alt_text, "link_path": b.link_path,
            "image": b.image.name, "starts_at": _iso(b.starts_at), "ends_at": _iso(b.ends_at)}


def _validate(request):
    b = _banner(request)
    try:
        banners.check_window(b.starts_at, b.ends_at)
    except banners.BannerError as exc:
        raise ApprovalError(f"{exc.message} Ask Marketing to reschedule it.") from exc


def _apply(request):
    banners.apply_approved(request, request.payload["banner"])


def _on_rejected(request):
    banners.mark_returned(request, request.payload["banner"])


def _diff(request):
    b = _banner(request)
    when = f"{b.starts_at:%d %b %Y %H:%M}" + (f" to {b.ends_at:%d %b %Y %H:%M}" if b.ends_at else ", no end date")
    rows = [
        {"field": "Where", "before": "Not shown", "after": banners.SLOT_INFO[b.slot]["label"] + (f" ({b.category.label})" if b.category_id else "")},
        {"field": "Words", "before": "", "after": b.title},
        {"field": "Link", "before": "", "after": b.link_path or "No link"},
        {"field": "When", "before": "", "after": when},
    ]
    if b.sponsored:
        rows.append({"field": "Label", "before": "", "after": "Shown as Sponsored"})
    return rows


def _consequences(request):
    return ["The banner shows on the public site from its start time until its end time.", "Nobody can contact a business from a banner: it links to a page on this site."]


BANNER_KIND = ApprovalKind(
    key=KIND_KEY, label="Show a banner on the site", pool_permission="", current_state=_current_state, apply=_apply,
    response_hours=48, chain_note="Super Admin only", resolve_approver=_super_admin_only, render_diff=_diff,
    validate=_validate, on_rejected=_on_rejected, consequences=_consequences,
)
