"""One KYC decision for both doors (plan 2A Task 5): the KYC queue's
Approve/Reject (KYCApproveView, KYCRejectView) and the business.kyc approval
kind (portfolio/approval_kinds.py). Whichever door decides first wins; the
other is refused, and the owner hears once.

Lock order, the same on both doors: the pending business.kyc approval rows,
then the target advisory lock (close_pending_for_target on the queue door,
approvals.services.approve() on the approval door), then the owner row;
record() last."""
from django.db import transaction
from django.db.models import CharField, OuterRef, Prefetch, Subquery
from django.db.models.functions import Cast
from django.utils import timezone

from activity.models import ActivityEvent
from activity.services import record
from approvals.models import ApprovalRequest
from approvals.services import MakerCannotDecide, close_pending_for_target
from fraud.models import FraudFlag
from fraud.services import open_flag_exists
from notifications.services import notify_business_owner

from .models import BusinessOwner, BusinessOwnerProfile, ScoutAssignment

KYC_KIND = "business.kyc"
TARGET_TYPE = "accounts.businessowner"
# A staff member's direct edit to an owner's details (StaffBusinessOwnerDetailView).
DETAILS_CHANGED = "business_owner.details_changed"
# Approval kinds whose maker put this business's details forward: KYC, a scout's details change, and the scout who
# verified the business's own name/contact change on site (portfolio.detail_changes, plan 7F-C Task 8).
SUBMITTER_KINDS = (KYC_KIND, "business.update", "business.detail_change")
QUEUE_APPROVE_NOTE = "Approved in the KYC queue."
ALREADY_DECIDED = "This business has already been decided."
SELF_DEALING_HOLD = "Decide the self-dealing case in Fraud cases first."
REASON_REQUIRED = "Write the reason the owner will see."
ADDRESS_FIRST = "Record the Ghana Post address decision first."
CONFIRMATION_MISSING = "The owner has not confirmed this registration yet."
CONFIRMATION_MISSING_CODE = "confirmation_missing"
# Every KYC door's refusal of a submitter (is_kyc_submitter). The approvals
# engine's own maker refusal is unchanged; the queue door maps it to this.
OWN_REGISTRATION = "You supplied or changed this business's details, so someone else decides its KYC."
NOT_FOUND = "We couldn't find that business."


class KycError(Exception):
    def __init__(self, message, status_code=400, code=""):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code  # a machine-readable reason the API answers beside the message, when there is one


def self_dealing_open(owner):
    return open_flag_exists(owner, FraudFlag.SELF_DEALING)


def is_kyc_submitter(owner, staff):
    """True for anyone who put this business's KYC evidence, address or
    details forward: its registrar, its current account manager, the maker of
    any business.kyc, business.update or business.detail_change request for it
    (any status: the last is the scout who verified a change on site), the field
    scout who corrected its Ghana Post address (their ScoutAssignment report
    marks the address wrong and gives the correction - one who only confirmed
    it, or marked it wrong without a correction, is not), and any staff member who
    edited the owner's details directly (a business_owner.details_changed
    event). They never decide it, nor record its address decision."""
    if owner.registered_by_id == staff.pk or owner.account_manager_id == staff.pk:
        return True
    if ApprovalRequest.objects.filter(
        kind__in=SUBMITTER_KINDS, target_type=TARGET_TYPE, target_id=str(owner.pk), maker=staff,
    ).exists():
        return True
    if ScoutAssignment.objects.filter(
        business_owner=owner, scout=staff, address_confirmed=False,
    ).exclude(corrected_address="").exists():
        return True
    return ActivityEvent.objects.filter(
        verb=DETAILS_CHANGED, actor_type=ActivityEvent.STAFF, actor_id=staff.pk,
        target_type=TARGET_TYPE, target_id=str(owner.pk),
    ).exists()


def _locked_owner(owner_id, staff):
    """Lock the owner and refuse whoever submitted its KYC evidence (see
    is_kyc_submitter): no exemption, on either door, approve or reject."""
    try:
        owner = BusinessOwner.objects.select_for_update().get(pk=owner_id)
    except BusinessOwner.DoesNotExist:
        raise KycError(NOT_FOUND, status_code=404) from None
    if is_kyc_submitter(owner, staff):
        raise MakerCannotDecide(OWN_REGISTRATION)
    return owner


def _corrections(owner):
    """Field reports that marked the address wrong and gave a correction
    (ScoutVerifyView rewrote gps_address from them)."""
    return ScoutAssignment.objects.filter(business_owner=owner, address_confirmed=False).exclude(corrected_address="")


def address_correction(owner):
    """The latest field correction as the KYC screens show it, or None."""
    latest = _corrections(owner).select_related("scout").order_by("-visited_at", "-id").first()
    if latest is None:
        return None
    return {"scout_name": latest.scout.full_name, "corrected_address": latest.corrected_address, "at": latest.visited_at}


def address_decision_missing(owner):
    """The Ghana Post address decision is needed before KYC approval, on either
    door, for every business: approval rests on the address alone (the Ghana
    Card, certificate and TIN are optional). A business with no profile has no
    decision. A field correction clears the decision, so someone other than the
    corrector re-checks it before approval."""
    profile = getattr(owner, "profile", None)
    return profile is None or profile.address_verified_at is None


def confirmation_missing(owner):
    """A business a staff member registered cannot be verified until its owner confirms the registration from the
    texted link (portfolio.confirmations). Either door refuses it with 409 `confirmation_missing`. An online owner, or
    one from before the pipeline, has no registration row and counts as confirmed."""
    from portfolio.confirmations import registration_confirmed  # portfolio imports accounts: keep the import lazy

    return not registration_confirmed(owner)


SIMULATED_NOTE = " Texts are simulated on this server, so no link went out."


def confirmation_missing_message(owner):
    """The 409 text for an unconfirmed registration. When the owner's latest registration link was only simulated
    (nothing was texted), it says so instead of letting staff wait for a message that never left."""
    from portfolio.models import OwnerConfirmation  # lazy, as above

    latest = OwnerConfirmation.objects.filter(
        business_owner=owner, scope=OwnerConfirmation.REGISTRATION,
    ).order_by("-pk").first()
    if latest is not None and latest.confirmed_at is None and latest.send_state == OwnerConfirmation.SIMULATED:
        return CONFIRMATION_MISSING + SIMULATED_NOTE
    return CONFIRMATION_MISSING


def _close_pending(owner_id, staff, *, approved, note):
    """close_pending_for_target for the queue door, with the KYC refusal: the
    maker of a pending business.kyc request is a KYC submitter."""
    try:
        return close_pending_for_target(
            KYC_KIND, target_type=TARGET_TYPE, target_id=str(owner_id), staff=staff, approved=approved, note=note,
        )
    except MakerCannotDecide:
        raise MakerCannotDecide(OWN_REGISTRATION) from None


def approve_owner(owner_id, staff, *, http_request=None, from_approval=None):
    """Verify a pending owner. From the queue (from_approval is None) the
    pending business.kyc requests are settled first — refusing a maker; from
    the approval kind the engine already holds the request and the target."""
    with transaction.atomic():
        closed = []
        if from_approval is None:
            closed = _close_pending(owner_id, staff, approved=True, note=QUEUE_APPROVE_NOTE)
        owner = _locked_owner(owner_id, staff)
        if owner.kyc_status != BusinessOwner.PENDING:
            raise KycError(ALREADY_DECIDED)
        if address_decision_missing(owner):
            raise KycError(ADDRESS_FIRST)
        if self_dealing_open(owner):
            raise KycError(SELF_DEALING_HOLD)
        if confirmation_missing(owner):
            raise KycError(confirmation_missing_message(owner), status_code=409, code=CONFIRMATION_MISSING_CODE)
        owner.kyc_status = BusinessOwner.VERIFIED
        owner.kyc_rejection_reason = None
        owner.reviewed_by = staff
        owner.reviewed_at = timezone.now()
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason", "reviewed_by", "reviewed_at"])
        notify_business_owner(
            owner, "kyc_approved", "Your business is verified!",
            body="Your KYC has been approved — you can now publish listings.",
            link="/business-dashboard", icon="✅",
        )
        from commission import services as commission  # commission imports accounts

        commission.accrue_registration(owner, now=owner.reviewed_at)  # idempotent; nothing without an approved policy
        # Listings staff made for this business that the owner already confirmed were waiting for this KYC. Both doors
        # (the queue and the business.kyc approval) end here, so this is the one place they are sent on.
        from portfolio.staff_listing_kind import submit_waiting

        transaction.on_commit(lambda: submit_waiting(owner.pk))
        if from_approval is None:
            after = {"via": "kyc-queue", "approval_ids": [approval.pk for approval in closed]}
        else:
            after = {"via": "approval", "approval_id": from_approval.pk}
        record(staff, "kyc-approve", target=owner, after=after, request=http_request)
    return owner


def reject_owner(owner_id, staff, reason, *, http_request=None):
    """Reject a pending owner from the queue; a pending business.kyc request
    is returned to its maker with the same reason."""
    reason = (reason or "").strip()
    if not reason:
        raise KycError(REASON_REQUIRED)
    with transaction.atomic():
        closed = _close_pending(owner_id, staff, approved=False, note=reason)
        owner = _locked_owner(owner_id, staff)
        if owner.kyc_status != BusinessOwner.PENDING:
            raise KycError(ALREADY_DECIDED)
        owner.kyc_status = BusinessOwner.REJECTED
        owner.kyc_rejection_reason = reason[:500]
        owner.reviewed_by = staff
        owner.reviewed_at = timezone.now()
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason", "reviewed_by", "reviewed_at"])
        notify_business_owner(
            owner, "kyc_rejected", "Your KYC needs attention", body=reason, link="/business-dashboard", icon="⚠️",
        )
        record(
            staff, "kyc-reject", target=owner,
            after={"via": "kyc-queue", "reason": reason, "approval_ids": [approval.pk for approval in closed]},
            request=http_request,
        )
    return owner


# ── What the KYC queue and detail show beside the owner ────────────────────


def with_review_data(queryset):
    """Who registered the business, its open fraud cases and its pending
    business.kyc request — loaded with the owners, not a query per row."""
    pending = (
        ApprovalRequest.objects.filter(
            kind=KYC_KIND, target_type=TARGET_TYPE, status=ApprovalRequest.PENDING,
            target_id=Cast(OuterRef("pk"), output_field=CharField()),
        )
        .order_by("pk")
        .values("pk")[:1]
    )
    return (
        queryset.select_related(
            "reviewed_by", "registered_by__role", "profile__business_category", "profile__zone", "profile__address_verified_by",
        )
        .prefetch_related(Prefetch(
            "fraud_flags",
            queryset=FraudFlag.objects.filter(status=FraudFlag.OPEN).order_by("created_at", "id"),
            to_attr="open_fraud_flags_list",
        ))
        .annotate(kyc_pending_approval_id=Subquery(pending))
    )


def open_fraud_flag_rows(owner):
    flags = getattr(owner, "open_fraud_flags_list", None)
    if flags is None:
        flags = owner.fraud_flags.filter(status=FraudFlag.OPEN).order_by("created_at", "id")
    return [{"id": flag.id, "kind": flag.kind, "kind_label": flag.get_kind_display(), "title": flag.title} for flag in flags]


def pending_approval_id(owner):
    if hasattr(owner, "kyc_pending_approval_id"):
        return owner.kyc_pending_approval_id
    return (
        ApprovalRequest.objects.filter(
            kind=KYC_KIND, target_type=TARGET_TYPE, target_id=str(owner.pk), status=ApprovalRequest.PENDING,
        )
        .order_by("pk")
        .values_list("pk", flat=True)
        .first()
    )


# ── The owner's identity documents (optional identity documents) ───────────


def submit_identity(profile):
    """Put an owner's Ghana Card forward for the identity check: not_submitted
    or rejected becomes pending, only when the number and both photos are on
    file. A pending or verified identity is never touched. Returns whether it
    moved; idempotent. One conditional UPDATE, so two requests at once cannot
    both move it."""
    if not profile.has_identity_documents():
        return False
    now = timezone.now()
    moved = BusinessOwnerProfile.objects.filter(
        pk=profile.pk,
        identity_status__in=(BusinessOwnerProfile.IDENTITY_NOT_SUBMITTED, BusinessOwnerProfile.IDENTITY_REJECTED),
    ).update(
        identity_status=BusinessOwnerProfile.IDENTITY_PENDING, identity_submitted_at=now, identity_rejection_reason=None,
    )
    if moved:
        profile.identity_status = BusinessOwnerProfile.IDENTITY_PENDING
        profile.identity_submitted_at = now
        profile.identity_rejection_reason = None
    return bool(moved)


# ── Staff review of the owner's identity documents ─────────────────────────
#
# A separate decision from the KYC above: it moves only
# BusinessOwnerProfile.identity_status (the verified check mark) and never
# touches kyc_status, the pending business.kyc request or the commission.
# Lock order: the owner row (_locked_owner, which refuses a submitter), then
# the profile row, then record() last. The owner's own profile PATCH locks the
# profile row alone, so the two cannot deadlock. The owner's notices reuse the
# kyc_approved / kyc_rejected kinds (the registry is not enforced and the
# titles say which check).

IDENTITY_NOT_PENDING = "This business's identity documents are not waiting for review."
IDENTITY_ONLY_REJECTED = "Only rejected identity documents can be sent back for re-review."


def _locked_identity(owner_id, staff, expected):
    """Lock the owner, then its profile row, and require the identity to be in
    `expected`. Returns (owner, profile). Raises KycError otherwise, and
    MakerCannotDecide for a submitter."""
    owner = _locked_owner(owner_id, staff)
    profile = BusinessOwnerProfile.objects.select_for_update(of=("self",)).filter(business_owner=owner).first()
    if profile is None or profile.identity_status != expected:
        raise KycError(IDENTITY_NOT_PENDING if expected == BusinessOwnerProfile.IDENTITY_PENDING else IDENTITY_ONLY_REJECTED)
    return owner, profile


def approve_identity(owner_id, staff, *, http_request=None):
    """Verify a pending identity: the owner's products now show the check mark."""
    with transaction.atomic():
        owner, profile = _locked_identity(owner_id, staff, BusinessOwnerProfile.IDENTITY_PENDING)
        profile.identity_status = BusinessOwnerProfile.IDENTITY_VERIFIED
        profile.identity_rejection_reason = None
        profile.identity_reviewed_by = staff
        profile.identity_reviewed_at = timezone.now()
        profile.save(update_fields=[
            "identity_status", "identity_rejection_reason", "identity_reviewed_by", "identity_reviewed_at",
        ])
        notify_business_owner(
            owner, "kyc_approved", "You're verified!",
            body="Your identity documents have been approved. Your products now show the verified check mark.",
            link="/business-dashboard", icon="✅",
        )
        record(staff, "identity-approve", target=owner, after={"identity_status": profile.identity_status}, request=http_request)
    return owner


def reject_identity(owner_id, staff, reason, *, http_request=None):
    """Reject a pending identity; the owner sees the reason."""
    reason = (reason or "").strip()
    if not reason:
        raise KycError(REASON_REQUIRED)
    with transaction.atomic():
        owner, profile = _locked_identity(owner_id, staff, BusinessOwnerProfile.IDENTITY_PENDING)
        profile.identity_status = BusinessOwnerProfile.IDENTITY_REJECTED
        profile.identity_rejection_reason = reason[:500]
        profile.identity_reviewed_by = staff
        profile.identity_reviewed_at = timezone.now()
        profile.save(update_fields=[
            "identity_status", "identity_rejection_reason", "identity_reviewed_by", "identity_reviewed_at",
        ])
        notify_business_owner(
            owner, "kyc_rejected", "Your identity documents need attention", body=reason,
            link="/business-dashboard", icon="⚠️",
        )
        record(
            staff, "identity-reject", target=owner,
            after={"identity_status": profile.identity_status, "reason": reason}, request=http_request,
        )
    return owner


def reopen_identity(owner_id, staff, *, http_request=None):
    """Send rejected identity documents back to the queue: pending again, the
    reason and the reviewer pair cleared (the moderated-queue contract)."""
    with transaction.atomic():
        owner, profile = _locked_identity(owner_id, staff, BusinessOwnerProfile.IDENTITY_REJECTED)
        profile.identity_status = BusinessOwnerProfile.IDENTITY_PENDING
        profile.identity_rejection_reason = None
        profile.identity_reviewed_by = None
        profile.identity_reviewed_at = None
        profile.save(update_fields=[
            "identity_status", "identity_rejection_reason", "identity_reviewed_by", "identity_reviewed_at",
        ])
        record(staff, "identity-reopen", target=owner, after={"identity_status": profile.identity_status}, request=http_request)
    return owner
