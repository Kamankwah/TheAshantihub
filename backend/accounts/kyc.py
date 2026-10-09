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

from .models import BusinessOwner, ScoutAssignment

KYC_KIND = "business.kyc"
TARGET_TYPE = "accounts.businessowner"
# A staff member's direct edit to an owner's details (StaffBusinessOwnerDetailView).
DETAILS_CHANGED = "business_owner.details_changed"
QUEUE_APPROVE_NOTE = "Approved in the KYC queue."
ALREADY_DECIDED = "This business has already been decided."
SELF_DEALING_HOLD = "Decide the self-dealing case in Fraud cases first."
REASON_REQUIRED = "Write the reason the owner will see."
ADDRESS_FIRST = "Record the Ghana Post address decision first."
OWN_REGISTRATION = "You can't approve your own request."
NOT_FOUND = "We couldn't find that business."


class KycError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def self_dealing_open(owner):
    return open_flag_exists(owner, FraudFlag.SELF_DEALING)


def is_kyc_submitter(owner, staff):
    """True for anyone who put this business's KYC evidence, address or
    details forward: its registrar, its current account manager, the maker of
    any business.kyc or business.update request for it (any status), the field
    scout who corrected its Ghana Post address (their ScoutAssignment report
    marks the address wrong and gives the correction - one who only confirmed
    it, or marked it wrong without a correction, is not), and any staff member who
    edited the owner's details directly (a business_owner.details_changed
    event). They never decide it, nor record its address decision."""
    if owner.registered_by_id == staff.pk or owner.account_manager_id == staff.pk:
        return True
    if ApprovalRequest.objects.filter(
        kind__in=(KYC_KIND, "business.update"), target_type=TARGET_TYPE, target_id=str(owner.pk), maker=staff,
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


def address_decision_missing(owner):
    """A scout-registered business needs the Ghana Post address decision before
    KYC approval, on either door. Self-registered owners keep the old behaviour."""
    if owner.registration_channel != BusinessOwner.SCOUT:
        return False
    profile = getattr(owner, "profile", None)
    return profile is None or profile.address_verified_at is None


def approve_owner(owner_id, staff, *, http_request=None, from_approval=None):
    """Verify a pending owner. From the queue (from_approval is None) the
    pending business.kyc requests are settled first — refusing a maker; from
    the approval kind the engine already holds the request and the target."""
    with transaction.atomic():
        closed = []
        if from_approval is None:
            closed = close_pending_for_target(
                KYC_KIND, target_type=TARGET_TYPE, target_id=str(owner_id), staff=staff,
                approved=True, note=QUEUE_APPROVE_NOTE,
            )
        owner = _locked_owner(owner_id, staff)
        if owner.kyc_status != BusinessOwner.PENDING:
            raise KycError(ALREADY_DECIDED)
        if address_decision_missing(owner):
            raise KycError(ADDRESS_FIRST)
        if self_dealing_open(owner):
            raise KycError(SELF_DEALING_HOLD)
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
        closed = close_pending_for_target(
            KYC_KIND, target_type=TARGET_TYPE, target_id=str(owner_id), staff=staff, approved=False, note=reason,
        )
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
