"""Scout registration (staff phase 2A, S1) and the KYC resubmit.

register_business() refuses an exact duplicate before writing anything, then
in one transaction creates the owner (with an unusable password until they
claim the login), the profile, the account-manager assignment, any fraud
cases (similar business nearby, self-dealing) and the business.kyc approval
request, and records business.registered last."""
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, Role
from activity.services import record
from approvals.models import ApprovalRequest
from approvals.services import submit
from fraud.models import FraudFlag
from fraud.services import raise_flag
from notifications.services import notify_staff_role

from . import checks
from .serializers import KycResubmitSerializer, ScoutRegistrationSerializer
from .services import assign_account_manager

KYC_KIND = "business.kyc"
OWNER_TARGET_TYPE = "accounts.businessowner"
MANAGES_PORTFOLIO = "businesses.manage_portfolio"
DUPLICATE_MESSAGE = "Already registered — ask Operations."
NOT_WAITING_MESSAGE = "This business isn't waiting for KYC any more."
ALREADY_WAITING_MESSAGE = "A KYC request for this business is already waiting for a decision."


class RegistrationError(Exception):
    """A refusal the scout can act on, answered as {"detail", "code"} — plus
    "matched" for a duplicate: the names of the checks that matched, never
    the other business."""

    def __init__(self, message, *, code="", matched=(), status_code=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.matched = list(matched)
        self.status_code = status_code


def _as_dict(data, files=None):
    """One plain dict from request.data (a QueryDict for multipart) and
    request.FILES — or from plain dicts in tests."""
    values = {}
    for source in (data, files):
        if source is not None:
            for key in source.keys():
                values[key] = source.get(key)
    return values


def _six(value):
    return Decimal(f"{float(value):.6f}")


def register_business(scout, data, files, *, http_request=None):
    serializer = ScoutRegistrationSerializer(data=_as_dict(data, files))
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    identity = {
        "phone": values["owner_phone"],
        "gps_address": values["gps_address"],
        "ghana_card_number": values.get("ghana_card_number"),
    }
    matched = checks.exact_duplicates(**identity)
    if matched:
        raise RegistrationError(DUPLICATE_MESSAGE, code="duplicate", matched=matched)
    name = values["business_name"]
    with transaction.atomic():
        owner = _create_business(scout, values, identity)
        if MANAGES_PORTFOLIO in scout.effective_permission_codenames():
            assign_account_manager(owner, scout, by=scout, reason="Registered the business")
        flags = _raise_flags(scout, owner, values)
        approval = _submit_kyc(scout, owner, name, maker_note=values.get("maker_note", ""), http_request=http_request)
        record(
            scout, "business.registered", target_type=OWNER_TARGET_TYPE, target_id=str(owner.pk), target_label=name,
            after={"business_name": name, "flags": [flag.pk for flag in flags]}, request=http_request,
        )
    return {"business_owner": owner, "approval": approval, "flags": flags}


def _create_business(registrar, values, identity):
    phone = values["owner_phone"]
    try:
        with transaction.atomic():
            owner = BusinessOwner.objects.create(
                full_name=values["owner_full_name"],
                login_phone=phone,
                email=values.get("owner_email"),
                password_hash=make_password(None),  # unusable until the owner claims the login
                kyc_status=BusinessOwner.PENDING,
                registration_channel=BusinessOwner.SCOUT,
                registered_by=registrar,
            )
            BusinessOwnerProfile.objects.create(
                business_owner=owner,
                business_name=values["business_name"],
                business_kind=values["business_kind"],
                business_category=values["business_category"],
                zone=values["zone"],
                gps_address=values["gps_address"],
                business_contact_phone=phone,
                lat=_six(values["lat"]),
                lng=_six(values["lng"]),
                location_accuracy_m=values.get("location_accuracy_m"),
                location_set_by="scout" if registrar.role.name == Role.SCOUT else "operations",
                location_set_at=timezone.now(),
                location_is_manual=values.get("location_is_manual", False),
                ghana_card_number=values.get("ghana_card_number"),
                signboard_photo=values["signboard_photo"],
                ghana_card_front_image=values["ghana_card_front"],
            )
    except IntegrityError:
        # Another registration with the same phone or Ghana Card committed
        # between the duplicate check and this insert.
        raise RegistrationError(
            DUPLICATE_MESSAGE, code="duplicate", matched=checks.exact_duplicates(**identity),
        ) from None
    return owner


def _pin_note(values):
    if values.get("location_is_manual"):
        return "Pin placed by hand"
    return f"Pin accuracy ±{values.get('location_accuracy_m')} m"


def _raise_flags(registrar, owner, values):
    """Fraud cases the registration raises — allowed through, shown on the
    KYC request. record_event=False: business.registered carries their ids."""
    name = values["business_name"]
    flags = []
    for staff in checks.staff_phone_matches(values["owner_phone"]):
        flags.append(raise_flag(
            FraudFlag.SELF_DEALING,
            title=f"Owner's phone matches staff member {staff.full_name}"[:200],
            detail=(
                f"{registrar.full_name} registered {name}. The owner's phone is the phone on "
                f"{staff.full_name}'s staff account ({staff.role.get_name_display()})."
            ),
            evidence=[
                f"Owner: {owner.full_name}",
                f"Staff member: {staff.full_name}",
                f"Registered by: {registrar.full_name}",
            ],
            business_owner=owner,
            staff_subject=staff,
            dedupe_key=f"self_dealing:{owner.pk}:{staff.pk}",
            record_event=False,
        ))
    nearby = checks.similar_nearby(name, values["lat"], values["lng"], exclude_owner_id=owner.pk)
    others = BusinessOwner.objects.in_bulk([match["business_owner_id"] for match in nearby])
    for match in nearby:
        flags.append(raise_flag(
            FraudFlag.SIMILAR_NEARBY,
            title=f"{name} is {match['distance_m']} m from {match['business_name']}"[:200],
            detail=(
                f"{registrar.full_name} registered {name}. {match['business_name']} is already registered "
                f"{match['distance_m']} m away with a similar name — check they are different businesses."
            ),
            evidence=[
                f"Name similarity {match['similarity']:.2f}",
                f"{match['distance_m']} m apart",
                _pin_note(values),
            ],
            business_owner=owner,
            related_business_owner=others.get(match["business_owner_id"]),
            dedupe_key=f"similar_nearby:{owner.pk}:{match['business_owner_id']}",
            record_event=False,
        ))
    return flags


def _submit_kyc(maker, owner, business_name, *, maker_note, http_request, resubmitted=False):
    if maker.role.name == Role.SUPER_ADMIN:
        # Decision 14: a Super Admin's own request applies at once, which
        # would skip the KYC check — the business waits in the KYC queue.
        what = f"sent {business_name} again" if resubmitted else f"registered {business_name}"
        notify_staff_role(
            "kyc.approve", "kyc_needs_approval", "New KYC submission",
            body=f"{maker.full_name} {what}. It needs KYC review.",
            link="kyc", icon="🪪",
        )
        return None
    title = f"New business: {business_name}" + (" (sent again)" if resubmitted else "")
    return submit(
        maker, KYC_KIND, title=title,
        payload={"business_owner_id": owner.pk, "business_name": business_name},
        target_type=OWNER_TARGET_TYPE, target_id=str(owner.pk), target_label=business_name,
        maker_note=maker_note or "", request=http_request,
    )


def _pending_kyc_request(owner):
    return ApprovalRequest.objects.filter(
        kind=KYC_KIND, target_type=OWNER_TARGET_TYPE, target_id=str(owner.pk), status=ApprovalRequest.PENDING,
    )


def resubmit_kyc(owner, staff, data, files, *, http_request=None):
    """A fresh business.kyc request after Operations returned the last one,
    optionally with retaken photos. Refused unless the owner is still pending
    and no business.kyc request for it is waiting."""
    serializer = KycResubmitSerializer(data=_as_dict(data, files))
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    with transaction.atomic():
        owner = BusinessOwner.objects.select_for_update().get(pk=owner.pk)
        if owner.kyc_status != BusinessOwner.PENDING:
            raise RegistrationError(NOT_WAITING_MESSAGE, code="not_pending")
        if _pending_kyc_request(owner).exists():
            raise RegistrationError(ALREADY_WAITING_MESSAGE, code="already_pending")
        profile = BusinessOwnerProfile.objects.get(business_owner=owner)
        photos = []
        if values.get("signboard_photo") is not None:
            profile.signboard_photo = values["signboard_photo"]
            photos.append("signboard_photo")
        if values.get("ghana_card_front") is not None:
            profile.ghana_card_front_image = values["ghana_card_front"]
            photos.append("ghana_card_front_image")
        if photos:
            profile.save(update_fields=photos)
        name = profile.business_name or owner.full_name
        approval = _submit_kyc(
            staff, owner, name, maker_note=values.get("maker_note", ""), http_request=http_request, resubmitted=True,
        )
        record(
            staff, "business.kyc_resubmitted", target_type=OWNER_TARGET_TYPE, target_id=str(owner.pk),
            target_label=name, after={"photos": photos, "approval_id": approval.pk if approval else None},
            request=http_request,
        )
    return approval
