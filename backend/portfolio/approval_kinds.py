"""Approval kinds owned by the portfolio app (plan 2A). PortfolioConfig.ready()
registers every kind in KINDS. Task 5 adds business.kyc; Task 9 appends the
three scout change kinds."""
from accounts.kyc import KYC_KIND, SELF_DEALING_HOLD, KycError, approve_owner, self_dealing_open
from accounts.models import BusinessOwner, BusinessOwnerProfile
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

NOT_WAITING = "This business isn't waiting for KYC any more."
ADDRESS_FIRST = "Record the Ghana Post address decision first."


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

KINDS = (BUSINESS_KYC,)
