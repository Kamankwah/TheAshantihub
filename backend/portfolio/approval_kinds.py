"""Approval kinds owned by the portfolio app (plan 2A). PortfolioConfig.ready()
registers every kind in KINDS. Task 5 adds business.kyc; Task 9 appends the
three scout change kinds."""
from accounts.kyc import ADDRESS_FIRST, KYC_KIND, SELF_DEALING_HOLD, KycError, approve_owner, self_dealing_open
from accounts.models import BusinessOwner, BusinessOwnerProfile
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from .proposals import (
    BUSINESS_UPDATE_KEY,
    LISTING_CREATE_KEY,
    LISTING_PHOTOS_KEY,
    apply_listing_create,
    apply_listing_photos,
    apply_update,
    listing_create_diff,
    listing_create_state,
    listing_photos_diff,
    listing_photos_state,
    update_diff,
    update_state,
    validate_listing_create,
    validate_listing_photos,
    validate_update,
)

NOT_WAITING = "This business isn't waiting for KYC any more."


def _profile(owner_id):
    return BusinessOwnerProfile.objects.filter(business_owner_id=owner_id).first()


def _kyc_current_state(request):
    # Only the KYC status: a decision made anywhere else makes the request stale.
    return {"kyc_status": BusinessOwner.objects.values_list("kyc_status", flat=True).get(pk=request.target_id)}


def _kyc_validate(request):
    owner = BusinessOwner.objects.get(pk=request.target_id)
    if owner.kyc_status != BusinessOwner.PENDING:
        raise ApprovalError(NOT_WAITING)
    profile = _profile(owner.pk)
    if profile is None or profile.address_verified_at is None:
        raise ApprovalError(ADDRESS_FIRST)
    if self_dealing_open(owner):
        raise ApprovalError(SELF_DEALING_HOLD)


def _kyc_apply(request):
    # request.decided_by is set before apply runs (approvals.services._approve;
    # the maker on a Super Admin's direct path).
    try:
        approve_owner(int(request.target_id), request.decided_by, from_approval=request)
    except KycError as exc:
        raise ApprovalError(exc.message) from exc


def _address_text(profile):
    if profile is None or not profile.gps_address:
        return "Not given"
    if profile.address_verified_at is None:
        return f"{profile.gps_address} · not checked yet"
    return f"{profile.gps_address} · {'verified' if profile.address_verified else 'marked wrong'}"


def _kyc_diff(request):
    owner = BusinessOwner.objects.select_related("registered_by").filter(pk=request.target_id).first()
    if owner is None:
        return [{"field": "Business", "before": None, "after": request.target_label}]
    registered_by = owner.registered_by.full_name if owner.registered_by_id else "The owner, online"
    return [
        {"field": "Business", "before": None, "after": owner.display_name},
        {"field": "Owner", "before": None, "after": f"{owner.full_name} · {owner.login_phone}"},
        {"field": "Registered by", "before": None, "after": registered_by},
        {"field": "Ghana Post address", "before": None, "after": _address_text(_profile(owner.pk))},
    ]


BUSINESS_KYC = ApprovalKind(
    key=KYC_KIND,
    label="New business (KYC)",
    pool_permission="kyc.approve",
    current_state=_kyc_current_state,
    apply=_kyc_apply,
    response_hours=24,
    render_diff=_kyc_diff,
    validate=_kyc_validate,
)

BUSINESS_UPDATE = ApprovalKind(
    key=BUSINESS_UPDATE_KEY,
    label="Business details change",
    pool_permission="portfolio.manage",
    current_state=update_state,  # only the fields in the payload: a change to any of them makes it stale
    apply=apply_update,
    response_hours=24,
    render_diff=update_diff,
    validate=validate_update,  # re-runs the phone / address / email duplicate checks
)

LISTING_CREATE = ApprovalKind(
    key=LISTING_CREATE_KEY,
    label="New product or service",
    pool_permission="portfolio.manage",
    current_state=listing_create_state,
    apply=apply_listing_create,  # publishes: this approval is the listing's moderation
    response_hours=24,
    render_diff=listing_create_diff,
    validate=validate_listing_create,  # KYC approved, subscription live and within its limit, photos unused
)

LISTING_PHOTOS = ApprovalKind(
    key=LISTING_PHOTOS_KEY,
    label="Listing photos",
    pool_permission="portfolio.manage",
    current_state=listing_photos_state,
    apply=apply_listing_photos,
    response_hours=24,
    render_diff=listing_photos_diff,
    validate=validate_listing_photos,
)

KINDS = (BUSINESS_KYC, BUSINESS_UPDATE, LISTING_CREATE, LISTING_PHOTOS)
