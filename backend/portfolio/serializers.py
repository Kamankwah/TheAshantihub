"""Request shapes for the portfolio endpoints (staff phase 2A)."""
import datetime as dt
import math

from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers

from accounts.gps import validate_ashanti_gps
from accounts.kyc import address_correction
from accounts.models import BusinessOwner, BusinessOwnerProfile, StaffUser
from accounts.phones import normalize_gh_phone
from accounts.validators import validate_image_content_type
from approvals.models import ApprovalRequest
from calls.models import CallLog
from fraud.models import FraudFlag
from listings.models import Category, Zone

from . import checks
from .health import calls_about
from .models import AppliedChange
from .services import approver_name

GHANA_LAT = (4.5, 11.2)
GHANA_LNG = (-3.3, 1.3)
MAX_ACCURACY_M = 100
OUTSIDE_GHANA = "This pin isn't in Ghana. Check the location and try again."
EMAIL_TAKEN = "That email already belongs to another account."
STAFF_EMAIL = "That email belongs to a staff member — ask Operations."


def flag_brief(flag):
    """The short form of a fraud flag shown on registration results and, in
    Task 8, on the business review sheet."""
    return {"id": flag.pk, "kind": flag.kind, "kind_label": flag.get_kind_display(), "title": flag.title}


class FiniteFloatField(serializers.FloatField):
    """A FloatField that refuses NaN and ±infinity ("nan", "inf" parse as
    floats) before its min/max validators run."""

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            raise serializers.ValidationError("Enter a number.")
        return value


class ScoutRegistrationSerializer(serializers.Serializer):
    owner_full_name = serializers.CharField(max_length=150)
    owner_phone = serializers.CharField(max_length=40)
    owner_email = serializers.EmailField(required=False, allow_blank=True, max_length=254)
    business_name = serializers.CharField(max_length=150)
    business_kind = serializers.ChoiceField(choices=BusinessOwnerProfile.BUSINESS_KIND_CHOICES)
    business_category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all())
    zone = serializers.PrimaryKeyRelatedField(queryset=Zone.objects.all())
    gps_address = serializers.CharField(max_length=20)
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    location_accuracy_m = FiniteFloatField(required=False, allow_null=True, min_value=0, max_value=100000)
    location_is_manual = serializers.BooleanField(required=False, default=False)
    signboard_photo = serializers.ImageField(validators=[validate_image_content_type])
    ghana_card_front = serializers.ImageField(validators=[validate_image_content_type])
    ghana_card_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
    maker_note = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def validate_owner_phone(self, value):
        try:
            return normalize_gh_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_owner_email(self, value):
        value = (value or "").strip()
        if not value:
            return None
        if BusinessOwner.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(EMAIL_TAKEN)
        # Password resets go to this email: a staff member's would keep the
        # business under their control after the owner claims it.
        if StaffUser.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(STAFF_EMAIL)
        return value

    def validate_gps_address(self, value):
        return validate_ashanti_gps(value)

    def validate_lat(self, value):
        if not GHANA_LAT[0] <= value <= GHANA_LAT[1]:
            raise serializers.ValidationError(OUTSIDE_GHANA)
        return value

    def validate_lng(self, value):
        if not GHANA_LNG[0] <= value <= GHANA_LNG[1]:
            raise serializers.ValidationError(OUTSIDE_GHANA)
        return value

    def validate_location_accuracy_m(self, value):
        return None if value is None else int(math.ceil(value))

    def validate_ghana_card_number(self, value):
        return (value or "").strip().upper() or None

    def validate(self, attrs):
        if attrs["business_category"].kind != attrs["business_kind"]:
            raise serializers.ValidationError(
                {"business_category": ["Choose a category for this kind of business."]}
            )
        if not attrs.get("location_is_manual"):
            accuracy = attrs.get("location_accuracy_m")
            if accuracy is None:
                raise serializers.ValidationError(
                    {"location_accuracy_m": ["Say how accurate the location is, or place the pin by hand."]}
                )
            if accuracy > MAX_ACCURACY_M:
                raise serializers.ValidationError({"lat": [
                    f"Location isn't accurate enough (±{accuracy} m). "
                    "Wait for a better fix, or place the pin by hand."
                ]})
        return attrs


class KycResubmitSerializer(serializers.Serializer):
    signboard_photo = serializers.ImageField(required=False, validators=[validate_image_content_type])
    ghana_card_front = serializers.ImageField(required=False, validators=[validate_image_content_type])
    maker_note = serializers.CharField(required=False, allow_blank=True, max_length=1000)


# ── Portfolio and health (plan 2A Task 8) ──────────────────────────────────
# The list item, the business page and the KYC review sheet are read-only
# dicts built from health.RatedBusiness rows; the reassign and follow-up
# endpoints validate with the two serializers at the end.

FOLLOW_UP_DUE_TIME = dt.time(17, 0)
REASON_REQUIRED = "Write the reason — it's kept on the record."
RECENT_CALLS_SHOWN = 10
NOTICE_FIELDS = (
    ("overdue_notice_at", "Overdue notice"),
    ("reminder_day7_at", "Day 7 reminder"),
    ("reminder_day13_at", "Day 13 reminder"),
)


def _portfolio_profile(owner):
    return getattr(owner, "profile", None)


def _portfolio_person(staff):
    return {"id": staff.pk, "full_name": staff.full_name} if staff is not None else None


def _portfolio_named(obj, attribute="name"):
    return {"id": obj.pk, "name": getattr(obj, attribute)} if obj is not None else None


def _portfolio_float(value):
    return float(value) if value is not None else None


def _portfolio_file_url(request, field):
    return request.build_absolute_uri(field.url) if field else None


def _portfolio_mask_ip(ip):
    """Operations sees the network, not the device: 102.176.44.9 → 102.176.x.x."""
    if not ip:
        return None
    if ":" in ip:
        return ":".join(ip.split(":")[:2]) + ":…"
    parts = ip.split(".")
    return ".".join(parts[:2] + ["x", "x"]) if len(parts) == 4 else ip


def portfolio_item(row):
    """One business in a portfolio list (row: health.RatedBusiness)."""
    owner = row.owner
    profile = _portfolio_profile(owner)
    return {
        "id": owner.pk,
        "business_name": owner.display_name,
        "owner_name": owner.full_name,
        "login_phone": owner.login_phone,
        "zone": _portfolio_named(getattr(profile, "zone", None)),
        "kyc_status": owner.kyc_status,
        "registration_channel": owner.registration_channel,
        "needs_claim": owner.needs_claim,
        "claimed_at": owner.claimed_at,
        "account_manager": _portfolio_person(owner.account_manager),
        "health": {"rating": row.rating, "reasons": list(row.reasons)},
        "subscription": row.subscription,
        "listings_live": owner.live_listings,
        "listings_total": owner.total_listings,
        "listings_waiting": owner.listings_waiting,
        "last_order_at": owner.last_order_at,
        "last_contact": {"kind": "call", "at": owner.last_call_at} if owner.last_call_at else None,
        "open_fraud_flags": owner.open_fraud_flags,
    }


def subscription_due_item(row):
    """A Subscriptions-due row: the list item plus the notices the clock sent."""
    item = portfolio_item(row)
    subscription = row.owner.subscription
    item["notices"] = [
        {"label": label, "at": getattr(subscription, field)}
        for field, label in NOTICE_FIELDS
        if getattr(subscription, field) is not None
    ]
    # The clock emails only owners with an email on file (SMS isn't connected).
    item["owner_has_email"] = bool(row.owner.email)
    return item


def business_detail(row, request):
    """The business page: the list item plus details, listings, waiting
    requests, recent calls, assignment history and open fraud cases.
    can_manage — the caller is the account manager, who may propose changes.
    An open case's title can name a staff member (a self-dealing match), so
    only portfolio.manage holders get it; others see its kind."""
    owner = row.owner
    shows_titles = "portfolio.manage" in request.user.effective_permission_codenames()
    profile = _portfolio_profile(owner)
    listings = owner.listings.annotate(photos_count=Count("photos")).order_by("-created_at", "-id")
    pending = (
        ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING)
        .filter(
            Q(target_type=BusinessOwner._meta.label_lower, target_id=str(owner.pk))
            | Q(payload__business_owner_id=owner.pk)
        )
        .select_related("assigned_to")
        .order_by("due_at", "id")
    )
    calls = CallLog.objects.filter(calls_about(owner.pk)).select_related("staff").order_by("-started_at", "-id")
    data = portfolio_item(row)
    data.update({
        "business_kind": getattr(profile, "business_kind", None),
        "business_category": _portfolio_named(getattr(profile, "business_category", None), "label"),
        "gps_address": getattr(profile, "gps_address", None),
        "lat": _portfolio_float(getattr(profile, "lat", None)),
        "lng": _portfolio_float(getattr(profile, "lng", None)),
        "location_accuracy_m": getattr(profile, "location_accuracy_m", None),
        "location_is_manual": bool(getattr(profile, "location_is_manual", False)),
        "location_set_by": getattr(profile, "location_set_by", ""),
        "business_contact_phone": getattr(profile, "business_contact_phone", None),
        "business_description": getattr(profile, "business_description", ""),
        "opening_hours": getattr(profile, "opening_hours", ""),
        "signboard_photo": _portfolio_file_url(request, getattr(profile, "signboard_photo", None)),
        "email": owner.email,
        "registered_by": _portfolio_person(owner.registered_by),
        "created_at": owner.created_at,
        "listings": [
            {
                "id": listing.pk,
                "name": listing.name,
                "status": listing.status,
                "main_photo": _portfolio_file_url(request, listing.main_photo),
                "photos_count": listing.photos_count,
                "price_amount": str(listing.price_amount) if listing.price_amount is not None else None,
            }
            for listing in listings
        ],
        "pending_requests": [
            {
                "id": approval.pk,
                "kind": approval.kind,
                "title": approval.title,
                "created_at": approval.created_at,
                "due_at": approval.due_at,
                "stage": approval.stage,
                "waiting_for": approver_name(approval),
            }
            for approval in pending
        ],
        "recent_calls": [
            {
                "id": call.pk,
                "direction": call.direction,
                "outcome": call.outcome,
                "purpose": call.purpose,
                "started_at": call.started_at,
                "staff_name": call.staff.full_name,
            }
            for call in calls[:RECENT_CALLS_SHOWN]
        ],
        "assignments": [
            {
                "scout_name": assignment.scout.full_name,
                "assigned_by_name": assignment.assigned_by.full_name if assignment.assigned_by else None,
                "reason": assignment.reason,
                "started_at": assignment.started_at,
                "ended_at": assignment.ended_at,
            }
            for assignment in owner.manager_assignments.select_related("scout", "assigned_by")
        ],
        "open_flags": [
            flag_brief(flag) if shows_titles else {key: value for key, value in flag_brief(flag).items() if key != "title"}
            for flag in FraudFlag.objects.filter(business_owner=owner, status=FraudFlag.OPEN).order_by("-created_at", "-id")
        ],
        "can_manage": owner.account_manager_id == request.user.pk,
    })
    return data


def business_review_sheet(owner, request):
    """The KYC review sheet. The duplicate and self-dealing checks run now,
    against today's records, through the same helper as the Register wizard's
    Review step (portfolio.checks.registration_checks)."""
    profile = _portfolio_profile(owner)
    lat, lng = getattr(profile, "lat", None), getattr(profile, "lng", None)
    found = checks.registration_checks(
        owner_phone=owner.login_phone,
        business_name=owner.display_name,
        gps_address=getattr(profile, "gps_address", None) or None,
        lat=lat,
        lng=lng,
        ghana_card_number=getattr(profile, "ghana_card_number", None) or None,
        exclude_owner_id=owner.pk,
    )
    consent = owner.consents.select_related("staff").order_by("-accepted_at", "-id").first()
    flags = FraudFlag.objects.filter(
        Q(business_owner=owner) | Q(related_business_owner=owner)
    ).order_by("-created_at", "-id")
    verifier = getattr(profile, "address_verified_by", None)
    return {
        "owner": {
            "full_name": owner.full_name,
            "login_phone": owner.login_phone,
            "email": owner.email,
            "ghana_card_number": getattr(profile, "ghana_card_number", None),
            "needs_claim": owner.needs_claim,
            "claimed_at": owner.claimed_at,
        },
        "business": {
            "business_name": owner.display_name,
            "business_kind": getattr(profile, "business_kind", None),
            "category": _portfolio_named(getattr(profile, "business_category", None), "label"),
            "zone": _portfolio_named(getattr(profile, "zone", None)),
            "opening_hours": getattr(profile, "opening_hours", ""),
            "is_formal": bool(getattr(profile, "is_formal", False)),
            "tin_given": bool(getattr(profile, "tin", None)),
        },
        "photos": {
            "signboard": _portfolio_file_url(request, getattr(profile, "signboard_photo", None)),
            "ghana_card_front": _portfolio_file_url(request, getattr(profile, "ghana_card_front_image", None)),
            "ghana_card_back": _portfolio_file_url(request, getattr(profile, "ghana_card_back_image", None)),
        },
        "location": {
            "lat": _portfolio_float(lat),
            "lng": _portfolio_float(lng),
            "accuracy_m": getattr(profile, "location_accuracy_m", None),
            "is_manual": bool(getattr(profile, "location_is_manual", False)),
            "set_by": getattr(profile, "location_set_by", ""),
            "set_at": getattr(profile, "location_set_at", None),
            "gps_address": getattr(profile, "gps_address", None),
            "address_verified": bool(getattr(profile, "address_verified", False)),
            "address_verified_by_name": verifier.full_name if verifier is not None else None,
            "address_verified_at": getattr(profile, "address_verified_at", None),
        },
        "checks": {**found, "accuracy_m": getattr(profile, "location_accuracy_m", None)},
        "consent": {
            "terms_version": consent.terms_version,
            "accepted_at": consent.accepted_at,
            "channel": consent.channel,
            "staff_name": consent.staff.full_name if consent.staff else None,
            "user_agent": consent.user_agent,
            "ip": _portfolio_mask_ip(consent.ip),
        } if consent is not None else None,
        "flags": [
            {**flag_brief(flag), "status": flag.status, "created_at": flag.created_at}
            for flag in flags
        ],
        "registered_by_name": owner.registered_by.full_name if owner.registered_by else None,
        "created_at": owner.created_at,
        # U6: the latest field correction of the Ghana Post address, or None.
        "address_correction": address_correction(owner),
    }


class ReassignSerializer(serializers.Serializer):
    scout = serializers.IntegerField()
    reason = serializers.CharField(
        max_length=300, error_messages={"required": REASON_REQUIRED, "blank": REASON_REQUIRED},
    )


class FollowUpSerializer(serializers.Serializer):
    owner = serializers.IntegerField()
    # 185 so the assignee's notification, "Follow-up: {title}", fits its 200.
    title = serializers.CharField(max_length=185)
    due_at = serializers.CharField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_due_at(self, value):
        """A date and time, or a date alone (due at 17:00 that day); never in the past."""
        # A date alone is checked first: on Python 3.12, parse_datetime()
        # reads "2026-10-10" as midnight.
        text = value.strip()
        try:
            day = parse_date(text) if len(text) == 10 else None
            moment = None if day is not None else parse_datetime(text)
        except ValueError:
            moment = day = None
        if moment is None and day is None:
            raise serializers.ValidationError("Use a date like 2026-10-09, or a date and time.")
        if moment is None:
            if day < timezone.localdate():
                raise serializers.ValidationError("Pick a day that hasn't passed.")
            moment = dt.datetime.combine(day, FOLLOW_UP_DUE_TIME)
        if timezone.is_naive(moment):
            moment = timezone.make_aware(moment)
        if day is None and moment < timezone.now():
            raise serializers.ValidationError("Pick a time that hasn't passed.")
        return moment


class StagePhotoSerializer(serializers.Serializer):
    """POST businesses/<pk>/photos/ — one photo plus where the phone said it
    was taken (each optional; a phone may not give a position)."""

    image = serializers.ImageField(validators=[validate_image_content_type])
    lat = FiniteFloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    lng = FiniteFloatField(required=False, allow_null=True, min_value=-180, max_value=180)
    accuracy_m = FiniteFloatField(required=False, allow_null=True, min_value=0, max_value=100000)


class OwnerChangeSerializer(serializers.ModelSerializer):
    """A change the owner's account manager made, as the owner's dashboard shows it."""

    made_by_name = serializers.CharField(source="approval.maker.full_name", read_only=True)
    can_undo = serializers.SerializerMethodField()

    class Meta:
        model = AppliedChange
        fields = ["id", "kind", "summary", "made_by_name", "applied_at", "undo_until", "can_undo", "undone_at",
                  "undo_failed"]

    def get_can_undo(self, obj):
        return obj.undone_at is None and timezone.now() <= obj.undo_until
