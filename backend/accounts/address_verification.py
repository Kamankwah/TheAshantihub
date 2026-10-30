"""The staff Address verification queue and decision (plan "shop location and address verification", Task 2).

The queue lists the businesses whose shop address nobody has decided yet (plus the decided history). A decision reuses the
`address_verified*` fields the KYC gate already reads (`kyc.address_decision_missing`) and adds how and why it was made.

* Evidence ladder for "verified": the owner's own phone fix from the shop (50 m or better) AND the signboard photo AND a
  recorded video-call outcome for the first verification; a later verification of a fresh owner pin may use `gps_capture`
  alone; a scout's confirmed field report is the alternative (`scout`). A `desk` check can only mark an address wrong.
* "Wrong" always carries a reason; the owner reads it on their dashboard and in a notice, and must share the location again.
* Maker-checker: `kyc.is_kyc_submitter` (registrar, account manager, makers of the business's requests, whoever last set the
  pin, ...) never decides, Super Admin included. Super Admin is the fallback only for businesses someone else registered.
* Lock order: the owner row, then the profile row, then the activity chain (`record()` last), as the capture paths do.
"""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from activity.services import record
from notifications.services import notify_business_owner

from . import kyc
from .claims import ClaimError
from .location_capture import address_status
from .models import BusinessOwner, BusinessOwnerProfile, LocationCapture, ScoutAssignment
from .phones import mask_phone

PERMISSION = "address.verify"
PENDING, VERIFIED, WRONG = "pending", "verified", "wrong"
TABS = (PENDING, VERIFIED, WRONG)
GPS_ACCURACY_M = 50  # an owner fix must be this good to count as the GPS evidence
NOTE_MAX = 1000

ALREADY_DECIDED = "This address has already been decided."
KYC_REJECTED = "This business's KYC was rejected, so its address can't be decided."
GPS_EVIDENCE = (
    "Verifying needs the owner's own phone location from the shop, accurate to 50 m or better. "
    "Send the owner a location link and wait for them to share it."
)
SIGNBOARD_MISSING = "There is no signboard photo on file for this business, so its address can't be verified yet."
VIDEO_CALL_REQUIRED = "The first verification needs a video call with the owner. Choose Video call and write what the call showed."
DESK_CANNOT_VERIFY = "A desk check can only mark an address wrong. Verify with a video call, a scout's report or the owner's GPS capture."
SCOUT_REPORT_MISSING = "No scout has reported visiting this shop and confirming its address."
CALL_NOTE_REQUIRED = "Write what the video call showed."
WRONG_TITLE = "Your shop's address needs attention"
WRONG_BODY = "AshantiHub could not confirm your shop's location: {reason} Open your dashboard and share your shop's location again from the shop."


# --- the queue ------------------------------------------------------------------------------------------------------

def loaded(owners):
    """Everything a row reads, joined in one query."""
    return owners.select_related(
        "profile__zone", "profile__address_verified_by", "profile__location_set_by_staff", "registered_by",
    )


def queue_queryset(tab):
    """The businesses on one tab. KYC-rejected businesses never appear. Pending: no profile or no decision yet, oldest
    first. Verified / wrong: the history, newest decision first."""
    owners = loaded(BusinessOwner.objects.exclude(kyc_status=BusinessOwner.REJECTED))
    if tab == PENDING:
        return owners.filter(Q(profile__isnull=True) | Q(profile__address_verified_at__isnull=True)).order_by("created_at", "id")
    return owners.filter(
        profile__address_verified_at__isnull=False, profile__address_verified=(tab == VERIFIED),
    ).order_by("-profile__address_verified_at", "-id")


def pending_count():
    """The staff badge: how many businesses wait for an address decision (the pending tab's total)."""
    return queue_queryset(PENDING).count()


def tab_of(raw):
    return raw if raw in TABS else PENDING  # the moderated-queue contract: an unknown value means pending


def _capture_state(capture, now):
    if capture.used_at is not None:
        return "used"
    if capture.revoked_at is not None:
        return "revoked"
    if capture.expires_at is not None and capture.expires_at <= now:
        return "expired"
    return "live"


def _last_captures(owner_ids):
    rows = (
        LocationCapture.objects.filter(business_owner_id__in=owner_ids).select_related("created_by")
        .order_by("business_owner_id", "-created_at", "-id").distinct("business_owner_id")
    )
    return {row.business_owner_id: row for row in rows}


def _scout_confirmed(owner_ids):
    return set(
        ScoutAssignment.objects.filter(
            business_owner_id__in=owner_ids, status=ScoutAssignment.VISITED, address_confirmed=True,
        ).values_list("business_owner_id", flat=True)
    )


def owner_gps_evidence(profile):
    """The owner's own phone fix from the shop, 50 m or better (not a staff or hand-placed pin)."""
    return (
        profile is not None and profile.lat is not None and profile.lng is not None
        and profile.location_set_by == BusinessOwnerProfile.LOCATION_BY_OWNER and not profile.location_is_manual
        and profile.location_accuracy_m is not None and profile.location_accuracy_m <= GPS_ACCURACY_M
    )


def blocked_reason(owner, staff):
    """Why `staff` may not decide this business now, or None. Same maker-checker function as the decision itself."""
    profile = getattr(owner, "profile", None)
    if profile is not None and profile.address_verified_at is not None:
        return ALREADY_DECIDED
    if owner.kyc_status == BusinessOwner.REJECTED:
        return KYC_REJECTED
    if kyc.is_kyc_submitter(owner, staff):  # up to four small queries a row: fine for a page of 20
        return kyc.OWN_REGISTRATION
    return None


def rows(owners, staff, request):
    """The queue row for each owner (loaded with `queue_queryset`'s select_related), in order. The latest capture and the
    scout reports are fetched once for the whole page."""
    owners = list(owners)
    ids = [owner.pk for owner in owners]
    captures, confirmed, now = _last_captures(ids), _scout_confirmed(ids), timezone.now()
    return [_row(owner, staff, request, captures.get(owner.pk), owner.pk in confirmed, now) for owner in owners]


def _row(owner, staff, request, capture, scout_report, now):
    profile = getattr(owner, "profile", None)
    pin = None
    if profile is not None and profile.lat is not None and profile.lng is not None:
        setter = profile.location_set_by_staff
        pin = {
            "lat": float(profile.lat), "lng": float(profile.lng), "accuracy_m": profile.location_accuracy_m,
            "set_by": profile.location_set_by or None, "set_by_staff_name": setter.full_name if setter else None,
            "set_at": profile.location_set_at, "is_manual": profile.location_is_manual,
        }
    last_capture = None
    if capture is not None:
        last_capture = {
            "source": capture.source, "created_at": capture.created_at, "expires_at": capture.expires_at,
            "used_at": capture.used_at, "revoked_at": capture.revoked_at, "state": _capture_state(capture, now),
            "accuracy_m": capture.accuracy_m, "sent_by_name": capture.created_by.full_name if capture.created_by else None,
        }
    decided = profile is not None and profile.address_verified_at is not None
    verifier = profile.address_verified_by if decided else None
    photo = profile.signboard_photo if profile is not None else None
    reason = blocked_reason(owner, staff)
    return {
        "id": owner.pk,
        "business_name": owner.display_name,
        "owner_name": owner.full_name,
        "phone": mask_phone(owner.login_phone),
        "zone": profile.zone.name if profile is not None and profile.zone else None,
        "kyc_status": owner.kyc_status,
        "gps_address": (profile.gps_address or None) if profile is not None else None,
        "signboard_photo": request.build_absolute_uri(photo.url) if photo else None,
        "pin": pin,
        "registrar": {"id": owner.registered_by.pk, "name": owner.registered_by.full_name} if owner.registered_by else None,
        "last_capture": last_capture,
        "address_status": address_status(profile),
        "verification": {
            "method": profile.address_verification_method or None, "note": profile.address_verification_note or None,
            "by_name": verifier.full_name if verifier else None, "at": profile.address_verified_at,
        } if decided else None,
        "evidence": {
            "owner_gps_50m": owner_gps_evidence(profile), "signboard": bool(photo), "scout_report": scout_report,
            "first_verification": profile is None or profile.address_first_verified_at is None,
        },
        "can_decide": reason is None,
        "blocked_reason": reason,
    }


def row_for(owner_id, staff, request):
    """One business's row (the decision answers with it, even though it has just left the pending tab)."""
    return rows([loaded(BusinessOwner.objects).get(pk=owner_id)], staff, request)[0]


# --- the decision ---------------------------------------------------------------------------------------------------

class DecisionSerializer(serializers.Serializer):
    result = serializers.ChoiceField(choices=[VERIFIED, WRONG])
    method = serializers.ChoiceField(choices=[value for value, _ in BusinessOwnerProfile.ADDRESS_METHOD_CHOICES])
    note = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=NOTE_MAX, trim_whitespace=True)

    def validate(self, attrs):
        attrs["note"] = attrs.get("note") or ""
        if not attrs["note"]:
            if attrs["result"] == WRONG:
                raise serializers.ValidationError({"note": [kyc.REASON_REQUIRED]})
            if attrs["result"] == VERIFIED and attrs["method"] == "video_call":
                raise serializers.ValidationError({"note": [CALL_NOTE_REQUIRED]})
        return attrs


def _require_evidence(owner, profile, method):
    """The evidence ladder for "verified". Raises ClaimError (400 with a code) for the first thing missing."""
    if profile is None or profile.lat is None or profile.lng is None:
        raise ClaimError(kyc.PIN_REQUIRED, code=kyc.PIN_REQUIRED_CODE)
    if method == "desk":
        raise ClaimError(DESK_CANNOT_VERIFY, code="desk_cannot_verify")
    if method == "scout":
        if not ScoutAssignment.objects.filter(
            business_owner=owner, status=ScoutAssignment.VISITED, address_confirmed=True,
        ).exists():
            raise ClaimError(SCOUT_REPORT_MISSING, code="scout_report_missing")
        return
    if method == "gps_capture" and profile.address_first_verified_at is None:
        raise ClaimError(VIDEO_CALL_REQUIRED, code="video_call_required")
    if not owner_gps_evidence(profile):
        raise ClaimError(GPS_EVIDENCE, code="gps_evidence")
    if not profile.signboard_photo:
        raise ClaimError(SIGNBOARD_MISSING, code="signboard_missing")


def decide(owner_id, staff, data, *, http_request=None):
    """Record the address decision for one business and return nothing; the caller answers the queue row."""
    body = DecisionSerializer(data=data if hasattr(data, "get") else {})
    body.is_valid(raise_exception=True)
    result, method, note = body.validated_data["result"], body.validated_data["method"], body.validated_data["note"]
    with transaction.atomic():
        try:
            owner = BusinessOwner.objects.select_for_update().get(pk=owner_id)  # 1. the owner
        except BusinessOwner.DoesNotExist:
            raise ClaimError(kyc.NOT_FOUND, code="not_found", status_code=404) from None
        if kyc.is_kyc_submitter(owner, staff):
            raise ClaimError(kyc.OWN_REGISTRATION, code="own_registration", status_code=403)
        if owner.kyc_status == BusinessOwner.REJECTED:
            raise ClaimError(KYC_REJECTED, code="kyc_rejected", status_code=409)
        profile = BusinessOwnerProfile.objects.select_for_update().filter(business_owner=owner).first()  # 2. the profile
        if profile is not None and profile.address_verified_at is not None:
            raise ClaimError(ALREADY_DECIDED, code="already_decided", status_code=409)
        before = address_status(profile)
        if result == VERIFIED:
            _require_evidence(owner, profile, method)
        elif profile is None:
            profile = BusinessOwnerProfile(business_owner=owner)
        now = timezone.now()
        profile.address_verified = result == VERIFIED
        profile.address_verified_by, profile.address_verified_at = staff, now
        profile.address_verification_method, profile.address_verification_note = method, note
        if result == VERIFIED and profile.address_first_verified_at is None:
            profile.address_first_verified_at = now
        profile.save()
        if result == WRONG:
            notify_business_owner(
                owner, "address_wrong", WRONG_TITLE, body=WRONG_BODY.format(reason=note.rstrip(".") + "."),
                link="/business-dashboard", icon="📍",
            )
        record(
            staff, "address-verified" if result == VERIFIED else "address-marked-wrong", target=owner,
            summary="Verified the shop's address" if result == VERIFIED else "Marked the shop's address wrong",
            before={"address_status": before}, after={"result": result, "method": method, "note": note}, request=http_request,
        )  # 3. the activity chain, last
    return owner
