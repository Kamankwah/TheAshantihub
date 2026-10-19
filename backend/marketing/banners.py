"""Banner rules and state changes (canvas 12). Every state change locks the banner row."""
import re
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from approvals import services as approvals
from approvals.models import ApprovalRequest

from .models_banners import Banner

KIND = "marketing.banner"
MAX_IMAGE_BYTES = 5 * 1024 * 1024

# Canvas sizes, shown beside the picker; not enforced (a real photo is cropped by the page).
SLOT_INFO = {
    Banner.HOME_HERO: {"label": "Home · hero", "size": "1600 × 900"},
    Banner.HOME_STRIP: {"label": "Home · middle strip", "size": "1600 × 300"},
    Banner.CATEGORY_TOP: {"label": "Category · top", "size": "1200 × 300"},
    Banner.EVENTS_TOP: {"label": "Events · top", "size": "1200 × 300"},
    Banner.FLASH: {"label": "Flash banner", "size": "text strip"},
}

PATH_RE = re.compile(r"^/[A-Za-z0-9\-._~/%?=&#+]*$")
# Phone numbers and WhatsApp links: customers contact AshantiHub, never a business.
CONTACT_RE = re.compile(r"(whatsapp|wa\.me|https?:|www\.|tel:|\+?\d[\d\s\-()]{7,}\d)", re.IGNORECASE)


class BannerError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def clean_link(value):
    value = (value or "").strip()
    if not value:
        return ""
    if value.startswith("//") or "\\" in value or not PATH_RE.match(value):
        raise BannerError("The link must be a page on this site, such as /events. Full web addresses, phone numbers and WhatsApp links are not allowed.")
    return value


def clean_text(value, field, limit):
    value = (value or "").strip()
    if not value:
        raise BannerError(f"{field} is required.")
    if len(value) > limit:
        raise BannerError(f"{field} must be {limit} characters or fewer.")
    if CONTACT_RE.search(value):
        raise BannerError(f"{field} must not contain a phone number, web address or WhatsApp link. Customers contact AshantiHub, not the business.")
    return value


def check_window(starts_at, ends_at, now=None):
    now = now or timezone.now()
    if ends_at is not None and ends_at <= starts_at:
        raise BannerError("The end must be after the start.")
    if ends_at is not None and ends_at <= now:
        raise BannerError("The end is already in the past.")


def public_row(banner, request=None):
    url = banner.image.url if banner.image else ""
    if request is not None and url:
        url = request.build_absolute_uri(url)
    row = {
        "id": banner.pk, "slot": banner.slot, "title": banner.title, "alt_text": banner.alt_text,
        "image": url, "link_path": banner.link_path, "sponsored": banner.sponsored,
    }
    if banner.slot == Banner.FLASH:
        row["message"] = banner.message
        row["countdown_ends_at"] = banner.countdown_ends_at
    return row


def ctr(views, clicks):
    return round(clicks * 100 / views, 1) if views else None


def staff_row(banner, request=None, now=None):
    now = now or timezone.now()
    url = banner.image.url if banner.image else ""
    if request is not None and url:
        url = request.build_absolute_uri(url)
    return {
        "id": banner.pk, "slot": banner.slot, "slot_label": SLOT_INFO[banner.slot]["label"],
        "category": {"id": banner.category_id, "slug": banner.category.slug, "label": banner.category.label} if banner.category_id else None,
        "title": banner.title, "alt_text": banner.alt_text, "image": url, "link_path": banner.link_path,
        "message": banner.message, "countdown_ends_at": banner.countdown_ends_at,
        "sponsored": banner.sponsored, "internal_note": banner.internal_note,
        "starts_at": banner.starts_at, "ends_at": banner.ends_at,
        "state": banner.state, "phase": banner.phase(now),
        "approval_id": banner.approval_id, "approved_by": banner.approved_by.full_name if banner.approved_by_id else "",
        "approved_at": banner.approved_at, "return_note": banner.return_note,
        "views": banner.views, "clicks": banner.clicks, "ctr": ctr(banner.views, banner.clicks),
        "created_by": banner.created_by.full_name if banner.created_by_id else "", "created_at": banner.created_at,
    }


def _locked(pk):
    try:
        return Banner.objects.select_for_update(of=("self",)).select_related("category", "approved_by", "created_by").get(pk=pk)
    except Banner.DoesNotExist as exc:
        raise BannerError("That banner no longer exists.", 404) from exc


def _check_flash(banner):
    if not (banner.message or "").strip():
        raise BannerError("Write the flash banner's message first.")
    if banner.countdown_ends_at is not None and banner.countdown_ends_at <= banner.starts_at:
        raise BannerError("The countdown must end after the banner starts.")


def publish_direct(banner_id, staff):
    """A flash banner goes live without Super Admin approval: Marketing owns it (site_promo.manage).
    Every other slot still goes through submit() and the `marketing.banner` approval."""
    if "site_promo.manage" not in staff.effective_permission_codenames():
        raise BannerError("You can't publish banners.", 403)
    with transaction.atomic():
        banner = _locked(banner_id)
        if banner.slot != Banner.FLASH:
            raise BannerError("Only a flash banner can be published directly. Send other banners for approval.", 400)
        if banner.state not in (Banner.DRAFT, Banner.REJECTED, Banner.TAKEN_DOWN):
            raise BannerError("Only a draft or taken-down banner can be published.", 409)
        _check_flash(banner)
        check_window(banner.starts_at, banner.ends_at)
        banner.state = Banner.APPROVED
        banner.return_note = ""
        banner.approval = None
        banner.approved_by = staff
        banner.approved_at = timezone.now()
        banner.save(update_fields=["state", "return_note", "approval", "approved_by", "approved_at", "updated_at"])
    return banner


def submit(banner_id, staff, request=None):
    """Draft or returned banner -> sent for approval. A Super Admin's own banner goes live at once."""
    with transaction.atomic():
        banner = _locked(banner_id)
        if banner.state not in (Banner.DRAFT, Banner.REJECTED, Banner.TAKEN_DOWN):
            raise BannerError("Only a draft, returned or taken-down banner can be sent for approval.", 409)
        if banner.slot == Banner.FLASH:
            _check_flash(banner)
        elif not banner.image:
            raise BannerError("Add the banner photo first.")
        if banner.slot == Banner.CATEGORY_TOP and banner.category_id is None:
            raise BannerError("Choose the category for a category banner.")
        check_window(banner.starts_at, banner.ends_at)
        banner.state = Banner.WAITING
        banner.return_note = ""
        banner.save(update_fields=["state", "return_note", "updated_at"])
        try:
            approval = approvals.submit(
                staff, KIND, title=f"Show banner: {banner.title}"[:200], target=banner,
                payload={"banner": banner.pk}, request=request,
            )
        except approvals.ApprovalError as exc:
            raise BannerError(exc.message, getattr(exc, "status_code", 400)) from exc
        banner.refresh_from_db()
        banner.approval = approval
        banner.save(update_fields=["approval", "updated_at"])
    return banner


def withdraw(banner_id, staff, request=None):
    """The maker pulls a banner back from Super Admin."""
    with transaction.atomic():
        banner = _locked(banner_id)
        if banner.state != Banner.WAITING or banner.approval_id is None:
            raise BannerError("This banner is not waiting for approval.", 409)
        try:
            approvals.cancel(banner.approval_id, staff, http_request=request)
        except approvals.ApprovalError as exc:
            raise BannerError(exc.message, getattr(exc, "status_code", 409)) from exc
        banner.state = Banner.DRAFT
        banner.save(update_fields=["state", "updated_at"])
    return banner


def take_down(banner_id, staff):
    with transaction.atomic():
        banner = _locked(banner_id)
        if banner.state != Banner.APPROVED:
            raise BannerError("Only an approved banner can be taken down.", 409)
        banner.state = Banner.TAKEN_DOWN
        banner.taken_down_by = staff
        banner.taken_down_at = timezone.now()
        banner.save(update_fields=["state", "taken_down_by", "taken_down_at", "updated_at"])
    return banner


def reschedule(banner_id, staff, starts_at, ends_at):
    """New dates for an approved banner. The photo, words and link do not change, so the approval stands."""
    with transaction.atomic():
        banner = _locked(banner_id)
        if banner.state != Banner.APPROVED:
            raise BannerError("Only an approved banner can be rescheduled.", 409)
        check_window(starts_at, ends_at)
        banner.starts_at, banner.ends_at = starts_at, ends_at
        banner.save(update_fields=["starts_at", "ends_at", "updated_at"])
    return banner


def apply_approved(approval, banner_id):
    banner = _locked(banner_id)
    if banner.state != Banner.WAITING:
        raise approvals.StaleRequest("This banner changed after it was sent. Ask for a fresh request.")
    banner.state = Banner.APPROVED
    banner.approved_by = approval.decided_by or approval.maker
    banner.approved_at = timezone.now()
    banner.approval = approval
    banner.save(update_fields=["state", "approved_by", "approved_at", "approval", "updated_at"])


def mark_returned(approval, banner_id):
    with transaction.atomic():
        banner = Banner.objects.select_for_update(of=("self",)).filter(pk=banner_id, state=Banner.WAITING).first()
        if banner:
            banner.state = Banner.REJECTED
            banner.return_note = (approval.decision_note or "")[:500]
            banner.save(update_fields=["state", "return_note", "updated_at"])


# ─── Reads shared with the overview and the calendar ─────────────────────────
def totals(since, until):
    """Counters of approved banners whose window touched [since, until]. Lifetime counters
    of those banners (there is no per-day tally), so the screen says so."""
    from django.db.models import Count, Q, Sum

    rows = Banner.objects.filter(state=Banner.APPROVED, starts_at__lte=until).filter(Q(ends_at__isnull=True) | Q(ends_at__gte=since))
    agg = rows.aggregate(n=Count("id"), views=Sum("views"), clicks=Sum("clicks"))
    return agg["n"] or 0, agg["views"] or 0, agg["clicks"] or 0


def upcoming(days):
    """Overview 'Scheduled next' rows for banners starting within `days`."""
    now = timezone.now()
    out = []
    rows = Banner.objects.filter(state__in=[Banner.APPROVED, Banner.WAITING], starts_at__gt=now, starts_at__lte=now + timedelta(days=days)).order_by("starts_at")
    for b in rows:
        waiting = b.state == Banner.WAITING
        out.append({
            "at": b.starts_at, "kind": "banner", "what": f"{SLOT_INFO[b.slot]['label']}: {b.title}",
            "status": "Waiting for Super Admin" if waiting else "Scheduled", "tone": "warn" if waiting else "ok",
        })
    return out


def banner_entries(start, end):
    """Banner windows overlapping [start, end) for the calendar: [{id, kind, title, starts_at, ends_at, status}]."""
    from django.db.models import Q

    now = timezone.now()
    rows = (
        Banner.objects.filter(state__in=[Banner.DRAFT, Banner.WAITING, Banner.APPROVED], starts_at__lt=end)
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=start)).order_by("starts_at", "id")
    )
    out = []
    for b in rows:
        status = b.phase(now) if b.state == Banner.APPROVED else ("waiting_approval" if b.state == Banner.WAITING else "draft")
        out.append({"id": b.pk, "kind": "banner", "title": b.title, "starts_at": b.starts_at, "ends_at": b.ends_at, "status": status})
    return out
