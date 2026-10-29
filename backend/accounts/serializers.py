import datetime

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import serializers

from . import sessions
from .authentication import ACCOUNT_MODELS
from .emails import send_password_reset_email, send_staff_invite_email
from .gps import validate_ashanti_gps
from .models import (
    BusinessOwner,
    BusinessOwnerProfile,
    Customer,
    PasswordResetToken,
    Role,
    RoleInviteRule,
    ScoutAssignment,
    StaffSession,
    StaffUser,
)
from delivery.models import VEHICLE_TYPES as VEHICLE_TYPE_CHOICES, DeliveryZone, Rider
from listings.models import Zone

from .permissions import can_lead_team, can_manage_staff, general_manager_manager_problem
from .phones import filter_by_phone, mask_phone

# Used to pay the same check_password() cost when no account is found, so that
# login timing does not leak whether an identifier exists (see login serializers below).
DUMMY_PASSWORD_HASH = make_password("dummy-password-for-constant-time-login-checks")

# Shown to a suspended account whose credentials are otherwise valid (staff
# user-management tools). Deliberately generic — points them at support rather
# than explaining the specific reason (the reason is staff-internal).
SUSPENDED_LOGIN_MESSAGE = "This account has been suspended. Please contact AshantiHub support."
DEACTIVATED_LOGIN_MESSAGE = "This staff account is no longer active. Please contact AshantiHub support."


def mask_but_last(value, keep=5):
    """Show only the last `keep` characters of an account/phone number,
    masking the rest (punch-list item 9). The payout numbers are stored
    unmasked; this is the ONLY thing that should ever ship them to a client,
    and it never ships the full value.

    A value shorter than `keep` is masked entirely rather than shown in full —
    a 4-digit number isn't safer to reveal just because it's short.
    """
    if not value:
        return None
    digits = str(value)
    if len(digits) <= keep:
        return "•" * len(digits)
    return "•" * (len(digits) - keep) + digits[-keep:]


# What a staff edit of a business owner's details may put in the activity log
# (user decision U2): payout numbers and the TIN only masked, and never a
# password hash, whichever fields the edit reaches.
DETAILS_MASKED_FIELDS = ("payout_momo_number", "payout_bank_account_number", "tin")
DETAILS_NEVER_LOGGED = ("password_hash", "password")


def owner_details_change(before, after):
    """(before, after) holding only the fields whose value changed between the
    two {field: value} dicts, with DETAILS_MASKED_FIELDS masked to their last 3
    characters and DETAILS_NEVER_LOGGED left out - what the
    business_owner.details_changed activity event stores."""
    def shown(field, value):
        return mask_but_last(value, keep=3) if field in DETAILS_MASKED_FIELDS else value

    changed = [
        field for field in after
        if field not in DETAILS_NEVER_LOGGED and before.get(field) != after[field]
    ]
    return (
        {field: shown(field, before.get(field)) for field in changed},
        {field: shown(field, after[field]) for field in changed},
    )


def _capture_marketing_consent(subject, choices, context):
    """Sign-up's separate, unticked marketing boxes: only a ticked one writes a consent line."""
    from marketing import consent  # local: marketing imports accounts

    consent.capture_at_signup(subject, choices, request=context.get("request"))


NO_CODE_CONTACT = "Enter a Ghana mobile number or an email so we can send you a code."


def _require_usable_contact(unsaved_account, field):
    """While sign-up verification is enforced, refuse (before anything is saved) an account that could never
    receive its confirmation code. With the switch off this does nothing."""
    from otp import flags as otp_flags  # lazy: otp imports accounts
    from otp.identity import contacts

    if otp_flags.sign_up_enforced() and not contacts(unsaved_account):
        raise serializers.ValidationError({field: [NO_CODE_CONTACT]})


class CustomerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    # {"sms": true, "email": true, ...} - the sign-up form's marketing boxes, each separate and unticked by default.
    marketing_consent = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = Customer
        fields = ["id", "full_name", "phone", "email", "password", "marketing_consent"]

    def validate(self, attrs):
        phone = attrs.get("phone")
        email = attrs.get("email")
        if not phone and not email:
            raise serializers.ValidationError(
                "At least one of phone or email is required."
            )
        _require_usable_contact(Customer(phone=phone or "", email=email or ""), "phone")
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["password_hash"] = make_password(password)
        choices = validated_data.pop("marketing_consent", None)
        customer = Customer.objects.create(**validated_data)
        _capture_marketing_consent(customer, choices, self.context)
        return customer


INVITE_TOKEN_LIFETIME = datetime.timedelta(days=7)


class StaffInviteSerializer(serializers.ModelSerializer):
    role = serializers.SlugRelatedField(slug_field="name", queryset=Role.objects.all())
    manager = serializers.PrimaryKeyRelatedField(
        queryset=StaffUser.objects.filter(is_active=True), required=False, allow_null=True, write_only=True
    )

    # Screen 06 (Operations Invite): the day they start and, for a scout, the zones
    # they will work. Both are optional; areas are held on the pending account.
    start_date = serializers.DateField(required=False, allow_null=True)
    areas = serializers.PrimaryKeyRelatedField(queryset=Zone.objects.all(), many=True, required=False)

    # Delivery Manager's Invite a rider (screen 11): a Dispatch invite also carries the rider's vehicle,
    # home delivery zone, first shift day and a note. They live on the pending account's Rider profile.
    vehicle_type = serializers.ChoiceField(choices=VEHICLE_TYPE_CHOICES, required=False, write_only=True)
    home_zone = serializers.PrimaryKeyRelatedField(queryset=DeliveryZone.objects.all(), required=False, allow_null=True, write_only=True)
    first_shift_date = serializers.DateField(required=False, allow_null=True, write_only=True)
    invite_note = serializers.CharField(max_length=500, required=False, allow_blank=True, write_only=True)

    class Meta:
        model = StaffUser
        fields = ["id", "full_name", "email", "phone", "role", "manager", "start_date", "areas", "vehicle_type", "home_zone", "first_shift_date", "invite_note"]

    def validate_start_date(self, value):
        if value is not None and value < timezone.localdate():
            raise serializers.ValidationError("The start date can't be in the past.")
        return value

    def validate_role(self, value):
        requester = self.context["request"].user
        if value.name == Role.SUPER_ADMIN and requester.role.name != Role.SUPER_ADMIN:
            raise serializers.ValidationError("Only a super_admin can invite another super_admin.")
        if value.name == Role.GENERAL_MANAGER and requester.role.name != Role.SUPER_ADMIN:
            raise serializers.ValidationError("Only a super_admin can invite a General Manager.")
        if not can_manage_staff(requester) and not RoleInviteRule.objects.filter(
            inviter_role=requester.role, invitee_role=value
        ).exists():
            raise serializers.ValidationError("You can't invite someone to that role.")
        return value

    def validate(self, attrs):
        # A team manager's invitee always reports to them; only staff.manage
        # may name a different manager.
        requester = self.context["request"].user
        if not can_manage_staff(requester):
            attrs["manager"] = requester
        elif attrs.get("manager") is not None and not can_lead_team(attrs["manager"]):
            # Same rule as StaffManagerView: only someone who can lead a team.
            raise serializers.ValidationError({"manager": ["Choose a manager who can lead a team."]})
        problem = general_manager_manager_problem(attrs["role"].name, attrs.get("manager"))
        if problem:
            raise serializers.ValidationError({"manager": [problem]})
        if attrs.get("areas") and attrs["role"].name != Role.SCOUT:
            raise serializers.ValidationError({"areas": ["Areas are for scouts only."]})
        rider_fields = {"vehicle_type", "home_zone", "first_shift_date", "invite_note"}
        if rider_fields & set(attrs) and attrs["role"].name != Role.DISPATCH:
            raise serializers.ValidationError({"vehicle_type": ["Vehicle, home zone and first shift are for riders (Dispatch) only."]})
        return attrs

    def create(self, validated_data):
        # password_hash stays unusable until /staff/activate/ sets a real password.
        areas = validated_data.pop("areas", [])
        rider_profile = {k: validated_data.pop(k) for k in ("vehicle_type", "home_zone", "first_shift_date", "invite_note") if k in validated_data}
        validated_data["password_hash"] = make_password(get_random_string(32))
        validated_data["invited_by"] = self.context["request"].user
        validated_data["invite_token"] = get_random_string(43)
        validated_data["invite_expires_at"] = timezone.now() + INVITE_TOKEN_LIFETIME
        validated_data["invite_sent_at"] = timezone.now()
        staff = StaffUser.objects.create(**validated_data)
        if areas:
            staff.areas.set(areas)
        if rider_profile:
            # The Rider row is made by delivery.signals when a Dispatch account is saved.
            Rider.objects.update_or_create(staff=staff, defaults=rider_profile)
        # FRONTEND_BASE_URL is per-environment (production vs staging vs local
        # dev), so the link lands on the frontend whose backend actually holds
        # this token — a hardcoded domain here once sent staging invites to
        # the production site, where the token doesn't exist.
        send_staff_invite_email(
            staff, f"{settings.FRONTEND_BASE_URL}/staff/activate?token={staff.invite_token}"
        )
        return staff


class StaffActivateSerializer(serializers.Serializer):
    token = serializers.CharField()
    password = serializers.CharField(min_length=8)

    def validate_token(self, value):
        try:
            staff = StaffUser.objects.get(invite_token=value)
        except StaffUser.DoesNotExist as exc:
            raise serializers.ValidationError("Invalid invite token") from exc
        if staff.invite_expires_at is None or staff.invite_expires_at < timezone.now():
            raise serializers.ValidationError("Invite token has expired")
        self.staff = staff
        return value

    def save(self):
        self.staff.password_hash = make_password(self.validated_data["password"])
        self.staff.invite_token = None
        self.staff.invite_expires_at = None
        self.staff.activated_at = timezone.now()
        self.staff.save(update_fields=["password_hash", "invite_token", "invite_expires_at", "activated_at"])
        return self.staff


def invite_state(staff):
    if staff.invite_token is None:
        return None
    if staff.invite_expires_at and staff.invite_expires_at < timezone.now():
        return "expired"
    return "opened" if staff.invite_opened_at else "not_opened"


PASSWORD_RESET_TOKEN_LIFETIME = datetime.timedelta(hours=1)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    # Optional and normally omitted: the public form asks for email only —
    # surfacing an account-type picker (especially a "Staff" option) would
    # advertise which account classes exist and invite targeting. When
    # omitted, every account type matching the email gets its own reset
    # link; the emailed link carries the type, so the confirm step never
    # needs the caller to declare it either.
    account_type = serializers.ChoiceField(
        choices=list(ACCOUNT_MODELS.keys()), required=False
    )

    def save(self):
        email = self.validated_data["email"]
        requested_type = self.validated_data.get("account_type")
        types_to_check = [requested_type] if requested_type else list(ACCOUNT_MODELS.keys())
        # Always behave the same whether or not an account was found — the
        # view returns a generic success response either way, so this method
        # never signals "not found" back up to it (avoids leaking account
        # existence via response shape or timing).
        for account_type in types_to_check:
            account = ACCOUNT_MODELS[account_type].objects.filter(email=email).first()
            if account is None:
                continue
            if account_type == "business_owner" and account.needs_claim:
                # A scout-registered owner must accept the Business Agreement
                # through a claim (accounts/claims.py), not a reset.
                continue
            token = get_random_string(43)
            PasswordResetToken.objects.create(
                account_type=account_type,
                account_id=account.id,
                token=token,
                expires_at=timezone.now() + PASSWORD_RESET_TOKEN_LIFETIME,
            )
            reset_link = f"{settings.FRONTEND_BASE_URL}/reset-password?token={token}&type={account_type}"
            send_password_reset_email(email, reset_link)
        return None


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField()
    account_type = serializers.ChoiceField(choices=list(ACCOUNT_MODELS.keys()))
    password = serializers.CharField(min_length=8)

    def validate(self, attrs):
        try:
            reset_token = PasswordResetToken.objects.get(
                token=attrs["token"], account_type=attrs["account_type"]
            )
        except PasswordResetToken.DoesNotExist as exc:
            raise serializers.ValidationError("Invalid or expired reset token") from exc
        if reset_token.used_at is not None:
            raise serializers.ValidationError("This reset link has already been used")
        if reset_token.expires_at < timezone.now():
            raise serializers.ValidationError("This reset link has expired")

        model = ACCOUNT_MODELS[attrs["account_type"]]
        try:
            account = model.objects.get(pk=reset_token.account_id)
        except model.DoesNotExist as exc:
            raise serializers.ValidationError("Invalid or expired reset token") from exc

        self.reset_token = reset_token
        self.account = account
        return attrs

    def save(self):
        from otp import devices  # otp imports accounts
        from otp.models import TrustedDevice

        with transaction.atomic():
            self.account.password_hash = make_password(self.validated_data["password"])
            self.account.save(update_fields=["password_hash"])
            self.reset_token.used_at = timezone.now()
            self.reset_token.save(update_fields=["used_at"])
            if isinstance(self.account, StaffUser):
                # A reset is often "someone else may have my password": end
                # every device's session.
                sessions.revoke_all(self.account, StaffSession.PASSWORD_RESET)
            # Trusted devices already stop working with the old password (their fingerprint); this ends them and
            # records it (otp.devices).
            devices.revoke_all(self.account, TrustedDevice.PASSWORD_RESET)
        return self.account


class BusinessOwnerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    kyc_status = serializers.CharField(read_only=True)
    marketing_consent = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "login_phone", "email", "password", "kyc_status", "marketing_consent"]

    def validate(self, attrs):
        _require_usable_contact(
            BusinessOwner(login_phone=attrs.get("login_phone") or "", email=attrs.get("email") or ""), "login_phone"
        )
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["password_hash"] = make_password(password)
        choices = validated_data.pop("marketing_consent", None)
        owner = BusinessOwner.objects.create(**validated_data)
        BusinessOwnerProfile.objects.create(business_owner=owner)
        _capture_marketing_consent(owner, choices, self.context)
        return owner

    def to_representation(self, instance):
        return {
            "id": instance.id,
            "full_name": instance.full_name,
            "login_phone": instance.login_phone,
            "kyc_status": instance.kyc_status,
        }


class BusinessOwnerKYCSerializer(serializers.ModelSerializer):
    # Approver attribution (staff moderation-queue restructuring) — surfaced on
    # the list shape so the Approved/Rejected tabs can show who actioned each
    # submission without expanding its detail. kyc_rejection_reason is here for
    # the same reason (the Rejected tab shows it inline).
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True, default=None)
    # Plan 2A: who registered it, its open fraud cases and the pending
    # business.kyc request the queue's Approve/Reject would settle. The
    # helpers live in accounts/kyc.py, imported lazily (accounts.kyc imports
    # activity.services, which imports this module).
    registered_by_name = serializers.CharField(source="registered_by.full_name", read_only=True, default=None)
    # The registrar's role ("Scout", "Operations"), so the queue never labels an
    # Operations registrar a scout. Rides on the registered_by__role select_related.
    registered_by_role = serializers.CharField(source="registered_by.role.get_name_display", read_only=True, default=None)
    open_fraud_flags = serializers.SerializerMethodField()
    pending_approval_id = serializers.SerializerMethodField()
    # Masked ("024 *** 5531"): the full number is behind the recorded, password-
    # confirmed POST /api/portfolio/businesses/<id>/reveal-phone/.
    login_phone = serializers.SerializerMethodField()
    # The business the owner is registering, to name the row ("Kofi Asamoah · Manhyia Tailoring").
    business_name = serializers.CharField(source="profile.business_name", read_only=True, default=None)
    # The Ghana Card check (BusinessOwnerProfile.identity_status), separate from kyc_status; None without a profile.
    identity_status = serializers.CharField(source="profile.identity_status", read_only=True, default=None)

    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "business_name", "login_phone", "kyc_status", "kyc_rejection_reason",
            "created_at", "reviewed_by_name", "reviewed_at",
            "registration_channel", "registered_by_name", "registered_by_role", "open_fraud_flags", "pending_approval_id",
            "identity_status",
        ]

    def get_login_phone(self, obj):
        from .phones import mask_phone

        return mask_phone(obj.login_phone)

    def get_open_fraud_flags(self, obj):
        from .kyc import open_fraud_flag_rows

        return open_fraud_flag_rows(obj)

    def get_pending_approval_id(self, obj):
        from .kyc import pending_approval_id

        return pending_approval_id(obj)


class IdentityQueueSerializer(serializers.ModelSerializer):
    """A row of the staff identity queue. Every identity_* value is the owner's
    profile's identity review, never the KYC review (reviewed_by_name,
    reviewed_at and kyc_rejection_reason belong to the KYC queue)."""

    business_name = serializers.CharField(source="profile.business_name", read_only=True, default=None)
    registered_by_name = serializers.CharField(source="registered_by.full_name", read_only=True, default=None)
    registered_by_role = serializers.CharField(source="registered_by.role.get_name_display", read_only=True, default=None)
    login_phone = serializers.SerializerMethodField()
    identity_status = serializers.CharField(source="profile.identity_status", read_only=True, default=None)
    identity_submitted_at = serializers.DateTimeField(source="profile.identity_submitted_at", read_only=True, default=None)
    identity_reviewed_at = serializers.DateTimeField(source="profile.identity_reviewed_at", read_only=True, default=None)
    identity_reviewed_by_name = serializers.CharField(
        source="profile.identity_reviewed_by.full_name", read_only=True, default=None,
    )
    identity_rejection_reason = serializers.CharField(
        source="profile.identity_rejection_reason", read_only=True, default=None,
    )

    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "business_name", "login_phone", "registration_channel",
            "registered_by_name", "registered_by_role", "kyc_status", "identity_status",
            "identity_submitted_at", "identity_reviewed_at", "identity_reviewed_by_name", "identity_rejection_reason",
        ]

    def get_login_phone(self, obj):
        from .phones import mask_phone

        return mask_phone(obj.login_phone)


class BusinessOwnerProfileKYCDetailSerializer(serializers.ModelSerializer):
    # `tin` is shown to every kyc.approve session, unlike the business-owner
    # detail, where it is users.manage-only (user decision, 2026-10-04): a
    # reviewer checks a formally registered business against its TIN, and
    # already sees the more sensitive Ghana Card number and images here. By
    # role, every kyc.approve holder has users.manage anyway; only an
    # individual kyc.approve grant reaches the difference.
    #
    # Ghana Post address verification (punch-list item 8). address_verified_at
    # being non-null is the "a decision was made" signal the frontend's KYC
    # Approve/Reject gating reads.
    address_verified_by_name = serializers.CharField(
        source="address_verified_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "gps_address", "business_contact_phone", "is_formal", "business_kind",
            "business_reg_certificate", "tin",
            "address_verified", "address_verified_by_name", "address_verified_at",
            "identity_status", "identity_rejection_reason", "identity_submitted_at",
        ]


class BusinessOwnerKYCDetailSerializer(BusinessOwnerKYCSerializer):
    profile = BusinessOwnerProfileKYCDetailSerializer(read_only=True)
    # The business and its pin (plan 2A). An owner without a profile yet reads
    # None for each (a missing reverse one-to-one resolves to the default).
    business_name = serializers.CharField(source="profile.business_name", read_only=True, default=None)
    business_category_name = serializers.CharField(source="profile.business_category.label", read_only=True, default=None)
    zone_name = serializers.CharField(source="profile.zone.name", read_only=True, default=None)
    lat = serializers.DecimalField(source="profile.lat", max_digits=9, decimal_places=6, read_only=True, default=None)
    lng = serializers.DecimalField(source="profile.lng", max_digits=9, decimal_places=6, read_only=True, default=None)
    location_accuracy_m = serializers.IntegerField(source="profile.location_accuracy_m", read_only=True, default=None)
    location_is_manual = serializers.BooleanField(source="profile.location_is_manual", read_only=True, default=None)
    signboard_photo = serializers.ImageField(source="profile.signboard_photo", read_only=True, default=None)
    # U6: the latest field correction of the Ghana Post address, or None.
    address_correction = serializers.SerializerMethodField()

    class Meta(BusinessOwnerKYCSerializer.Meta):
        fields = [
            "id", "full_name", "login_phone", "email", "kyc_status", "kyc_rejection_reason",
            "created_at", "reviewed_by_name", "reviewed_at", "profile",
            "registration_channel", "registered_by_name", "registered_by_role", "open_fraud_flags", "pending_approval_id",
            "business_name", "business_category_name", "zone_name", "lat", "lng",
            "location_accuracy_m", "location_is_manual", "signboard_photo", "address_correction",
            "identity_status",
        ]

    def get_address_correction(self, obj):
        from .kyc import address_correction

        return address_correction(obj)


class PayoutDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "payout_bank_name", "payout_bank_account_number", "payout_bank_account_name",
            "payout_momo_network", "payout_momo_number", "payout_momo_name",
            "default_payout_method",
        ]
        extra_kwargs = {field: {"required": False} for field in fields}

    def validate(self, data):
        method = data.get("default_payout_method", self.instance.default_payout_method if self.instance else None)
        bank_number = data.get("payout_bank_account_number", getattr(self.instance, "payout_bank_account_number", None))
        momo_number = data.get("payout_momo_number", getattr(self.instance, "payout_momo_number", None))

        if method == BusinessOwnerProfile.BANK and not bank_number:
            raise serializers.ValidationError(
                {"default_payout_method": "Bank details must be provided to set bank as the default payout method."}
            )
        if method == BusinessOwnerProfile.MOMO and not momo_number:
            raise serializers.ValidationError(
                {"default_payout_method": "Mobile money details must be provided to set momo as the default payout method."}
            )
        return data

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.payout_verification_status = "pending"
        # Only the payout fields: the row is not locked here, so a full-row save could write back a stale
        # identity_status (or address) that staff changed after this request read the profile.
        instance.save(update_fields=[*validated_data, "payout_verification_status"])
        return instance


def hours_payload(owner):
    """The owner's weekly hours as the API shows them: [] (never invented) until they have entered some."""
    from .models import BusinessHours

    return [
        {
            "weekday": row.weekday, "closed": row.closed,
            "opens": row.opens.strftime("%H:%M") if row.opens else None,
            "closes": row.closes.strftime("%H:%M") if row.closes else None,
        }
        for row in BusinessHours.objects.filter(business_owner=owner).order_by("weekday")
    ]


def _strict_bool(value):
    """`closed` as a real bool: the string "false" and 0 must not read as truthy-closed."""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str) and value.strip().lower() in ("true", "false", "1", "0"):
        return value.strip().lower() in ("true", "1")
    raise serializers.ValidationError("closed must be true or false.")


class BusinessHoursSerializer(serializers.Serializer):
    """PUT body {days: [{weekday, closed, opens, closes}]}; the rules live in accounts.hours.set_week."""

    days = serializers.ListField(child=serializers.DictField(), allow_empty=False)

    def validate_days(self, days):
        cleaned = []
        for day in days:
            day = dict(day)
            try:
                day["closed"] = _strict_bool(day.get("closed"))
            except serializers.ValidationError:
                raise serializers.ValidationError("Each day's closed must be true or false.")
            cleaned.append(day)
        return cleaned


IDENTITY_LOCKED_STATUSES = (BusinessOwnerProfile.IDENTITY_PENDING, BusinessOwnerProfile.IDENTITY_VERIFIED)
IDENTITY_LOCKED_MESSAGE = "Your documents are in review (or verified) and can't be changed here."
DUPLICATE_CARD_MESSAGE = "We couldn't accept this Ghana Card number. Check it and try again, or contact support."


def normalize_card_number(value):
    """A Ghana Card number as stored: trimmed and upper-case (as the scout form stores it), or None when blank."""
    return (value or "").strip().upper() or None


def same_card_number(a, b):
    """Two card numbers compared as stored (older rows may hold lower case)."""
    return normalize_card_number(a) == normalize_card_number(b)


def card_number_taken(value, *, exclude=None):
    """Whether another business holds this number, in any case."""
    taken = BusinessOwnerProfile.objects.filter(ghana_card_number__iexact=value)
    if exclude is not None and exclude.pk is not None:
        taken = taken.exclude(pk=exclude.pk)
    return taken.exists()


class BusinessOwnerProfileUpdateSerializer(serializers.ModelSerializer):
    hours = serializers.SerializerMethodField()
    has_hours = serializers.SerializerMethodField()

    def get_hours(self, obj):
        return hours_payload(obj.business_owner)

    def get_has_hours(self, obj):
        from .hours import has_hours

        return has_hours(obj.business_owner)

    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "gps_address", "business_contact_phone", "is_formal",
            "business_reg_certificate", "tin", "business_kind", "hours", "has_hours",
            "identity_status", "identity_rejection_reason",
        ]
        read_only_fields = ["identity_status", "identity_rejection_reason"]
        extra_kwargs = {
            field: {"required": False}
            for field in fields
            if field not in ("hours", "has_hours", "identity_status", "identity_rejection_reason")
        }
        # business_kind is set at trial-start (billing.StartTrialSerializer) or, while
        # subscriptions are off, by billing.BusinessKindView, and
        # drives listing-category / subscription-plan gating on the frontend; it
        # is exposed here read-only so the owner's dashboard can read it, but
        # this KYC-edit endpoint must never let it be switched.
        extra_kwargs["business_kind"] = {"read_only": True}

    # Declared, so DRF adds no UniqueValidator (whose "already exists" would say someone holds the number): the
    # duplicate check below answers the generic DUPLICATE_CARD_MESSAGE, without case, as the identity POST does.
    ghana_card_number = serializers.CharField(max_length=30, required=False, allow_blank=True, allow_null=True)

    def validate_ghana_card_number(self, value):
        # The column is unique, so "no card number" must be NULL, never "":
        # a second business without one would collide on the empty string.
        value = normalize_card_number(value)
        if value and card_number_taken(value, exclude=self.instance):
            raise serializers.ValidationError(DUPLICATE_CARD_MESSAGE)
        return value

    def validate(self, data):
        owner = self.instance.business_owner
        if owner.kyc_status == BusinessOwner.VERIFIED:
            raise serializers.ValidationError(
                {"kyc_status": "Cannot edit a verified KYC profile."}
            )

        # Once the identity is pending or verified the documents are fixed: the check mark and the reviewer's
        # decision rest on exactly what is stored. The same number may be sent again (the registration form
        # resends it); anything else on the card is refused.
        if self.instance.identity_status in IDENTITY_LOCKED_STATUSES:
            errors = {}
            for field in ("ghana_card_front_image", "ghana_card_back_image"):
                if field in data:
                    errors[field] = IDENTITY_LOCKED_MESSAGE
            if "ghana_card_number" in data:
                if same_card_number(data["ghana_card_number"], self.instance.ghana_card_number):
                    data.pop("ghana_card_number")  # keep the reviewed number exactly as stored
                else:
                    errors["ghana_card_number"] = IDENTITY_LOCKED_MESSAGE
            if errors:
                raise serializers.ValidationError(errors)

        # Only the Ghana Post GPS address is mandatory, and it must be in the
        # Ashanti Region. The Ghana Card, certificate and TIN are optional:
        # KYC rests on the address. Checked against the effective
        # (post-update) value so a partial edit of an already-complete
        # profile still passes.
        gps = data.get("gps_address", self.instance.gps_address)
        try:
            validate_ashanti_gps(gps)
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({"gps_address": exc.detail})

        return data

    def update(self, instance, validated_data):
        owner = instance.business_owner
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if owner.kyc_status == BusinessOwner.REJECTED:
            owner.kyc_status = BusinessOwner.PENDING
            owner.kyc_rejection_reason = None
            owner.save(update_fields=["kyc_status", "kyc_rejection_reason"])
        return instance


class IdentitySubmissionSerializer(serializers.ModelSerializer):
    """The owner's identity documents (POST .../business-owners/me/identity/): the
    Ghana Card number and both photos are required; the certificate, TIN and
    is_formal are optional. The number's uniqueness is checked here, in one
    message that says nothing about who holds it."""

    ghana_card_number = serializers.CharField(max_length=30)

    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "business_reg_certificate", "tin", "is_formal",
        ]
        extra_kwargs = {
            "ghana_card_front_image": {"required": True, "allow_null": False},
            "ghana_card_back_image": {"required": True, "allow_null": False},
            "business_reg_certificate": {"required": False},
            "tin": {"required": False, "allow_blank": True, "allow_null": True},
            "is_formal": {"required": False},
        }

    def validate_ghana_card_number(self, value):
        value = normalize_card_number(value)
        if not value:
            raise serializers.ValidationError("Enter your Ghana Card number.")
        if card_number_taken(value, exclude=self.instance):
            raise serializers.ValidationError(DUPLICATE_CARD_MESSAGE)
        return value

    def validate_tin(self, value):
        return (value or "").strip() or None


class CustomerLoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField()

    def validate(self, attrs):
        account = Customer.objects.filter(
            Q(phone=attrs["identifier"]) | Q(email=attrs["identifier"])
        ).first()
        password_hash = account.password_hash if account else DUMMY_PASSWORD_HASH
        password_valid = check_password(attrs["password"], password_hash)
        if account is None or not password_valid:
            raise serializers.ValidationError("Invalid credentials")
        # Only surfaced after valid credentials — never leaks a suspension to
        # someone who couldn't otherwise sign in.
        if account.is_suspended:
            raise serializers.ValidationError(SUSPENDED_LOGIN_MESSAGE)
        self.account = account
        return attrs


class BusinessOwnerLoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField()

    def validate(self, attrs):
        identifier = attrs["identifier"]
        account = BusinessOwner.objects.filter(
            Q(login_phone=identifier) | Q(email=identifier)
        ).first()
        if account is None and "@" not in identifier:
            # The same phone written the other way: "0241234567" for a stored
            # "+233241234567" (scouts store +233…) or the reverse (owners typed
            # their own at sign-up). Compared by the last 9 digits, and only an
            # unambiguous match counts — two old rows sharing those digits
            # still sign in by their exact spelling only. Stored spaces and
            # dashes ("024 123-4567") don't matter: digits are compared.
            matches = list(filter_by_phone(BusinessOwner.objects.all(), "login_phone", identifier)[:2])
            if len(matches) == 1:
                account = matches[0]
        password_hash = account.password_hash if account else DUMMY_PASSWORD_HASH
        password_valid = check_password(attrs["password"], password_hash)
        if account is None or not password_valid:
            raise serializers.ValidationError("Invalid credentials")
        if account.is_suspended:
            raise serializers.ValidationError(SUSPENDED_LOGIN_MESSAGE)
        self.account = account
        return attrs


class StaffLoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField()

    def validate(self, attrs):
        account = StaffUser.objects.filter(email=attrs["identifier"]).first()
        password_hash = account.password_hash if account else DUMMY_PASSWORD_HASH
        password_valid = check_password(attrs["password"], password_hash)
        # Read by StaffLoginView for the sign-in history; never sent to the client.
        self.attempted_account = account
        self.refusal = ""
        if account is None or not password_valid:
            self.refusal = "Wrong password or unknown address"
            raise serializers.ValidationError("Invalid credentials")
        # Only surfaced after valid credentials — never leaks account state to
        # someone who couldn't otherwise sign in (punch-list item 10). Both a
        # temporary suspension and a "no longer works here" deactivation stop
        # login; they carry different copy so the staffer knows which it is.
        if account.is_suspended:
            self.refusal = "Account suspended"
            raise serializers.ValidationError(SUSPENDED_LOGIN_MESSAGE)
        if not account.is_active:
            self.refusal = "Account deactivated"
            raise serializers.ValidationError(DEACTIVATED_LOGIN_MESSAGE)
        self.account = account
        return attrs


class CustomerProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = [
            "id", "full_name", "avatar", "email", "phone",
            "address", "gender", "date_of_birth",
            "secondary_email", "secondary_email_verified",
            "secondary_phone", "secondary_phone_verified",
            "email_notifications_enabled", "sms_notifications_enabled",
        ]
        # email/phone are the account's login identifiers — not editable here
        # (no OTP/verification flow for the primary identifier itself).
        # secondary_email/secondary_phone are likewise read-only on this
        # serializer — set only via CustomerSecondaryEmail/PhoneRequestView
        # below, which owns the verification-code lifecycle.
        read_only_fields = [
            "id", "email", "phone",
            "secondary_email", "secondary_email_verified",
            "secondary_phone", "secondary_phone_verified",
        ]
        extra_kwargs = {"full_name": {"required": False}, "avatar": {"required": False}}


CUSTOMER_VERIFY_CODE_LIFETIME = datetime.timedelta(minutes=10)


class CustomerSecondaryEmailRequestSerializer(serializers.Serializer):
    secondary_email = serializers.EmailField()

    def validate_secondary_email(self, value):
        request = self.context["request"]
        if value == request.user.email:
            raise serializers.ValidationError("This is already your primary email.")
        return value

    def save(self):
        code = get_random_string(6, allowed_chars="0123456789")
        customer = self.context["request"].user
        customer.secondary_email = self.validated_data["secondary_email"]
        customer.secondary_email_verified = False
        customer.secondary_email_verify_code = code
        customer.secondary_email_verify_expires_at = timezone.now() + CUSTOMER_VERIFY_CODE_LIFETIME
        customer.save(update_fields=[
            "secondary_email", "secondary_email_verified",
            "secondary_email_verify_code", "secondary_email_verify_expires_at",
        ])
        return customer


class CustomerSecondaryEmailConfirmSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=6)

    def validate(self, attrs):
        customer = self.context["request"].user
        if not customer.secondary_email_verify_code:
            raise serializers.ValidationError("No verification in progress. Request a new code.")
        if customer.secondary_email_verify_expires_at < timezone.now():
            raise serializers.ValidationError("This code has expired. Request a new one.")
        if attrs["code"] != customer.secondary_email_verify_code:
            raise serializers.ValidationError("Incorrect code.")
        return attrs

    def save(self):
        customer = self.context["request"].user
        customer.secondary_email_verified = True
        customer.secondary_email_verify_code = None
        customer.secondary_email_verify_expires_at = None
        customer.save(update_fields=[
            "secondary_email_verified", "secondary_email_verify_code", "secondary_email_verify_expires_at",
        ])
        return customer


class CustomerSecondaryPhoneRequestSerializer(serializers.Serializer):
    secondary_phone = serializers.CharField(max_length=20)

    def validate_secondary_phone(self, value):
        request = self.context["request"]
        if value == request.user.phone:
            raise serializers.ValidationError("This is already your primary phone number.")
        return value

    def save(self):
        code = get_random_string(6, allowed_chars="0123456789")
        customer = self.context["request"].user
        customer.secondary_phone = self.validated_data["secondary_phone"]
        customer.secondary_phone_verified = False
        customer.secondary_phone_verify_code = code
        customer.secondary_phone_verify_expires_at = timezone.now() + CUSTOMER_VERIFY_CODE_LIFETIME
        customer.save(update_fields=[
            "secondary_phone", "secondary_phone_verified",
            "secondary_phone_verify_code", "secondary_phone_verify_expires_at",
        ])
        return customer


class CustomerSecondaryPhoneConfirmSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=6)

    def validate(self, attrs):
        customer = self.context["request"].user
        if not customer.secondary_phone_verify_code:
            raise serializers.ValidationError("No verification in progress. Request a new code.")
        if customer.secondary_phone_verify_expires_at < timezone.now():
            raise serializers.ValidationError("This code has expired. Request a new one.")
        if attrs["code"] != customer.secondary_phone_verify_code:
            raise serializers.ValidationError("Incorrect code.")
        return attrs

    def save(self):
        customer = self.context["request"].user
        customer.secondary_phone_verified = True
        customer.secondary_phone_verify_code = None
        customer.secondary_phone_verify_expires_at = None
        customer.save(update_fields=[
            "secondary_phone_verified", "secondary_phone_verify_code", "secondary_phone_verify_expires_at",
        ])
        return customer


def _sent_in_this_patch(serializer, field):
    """True only when this request is a PATCH whose body carried `field`: the
    response may then echo back the value the client just sent, nothing more."""
    request = serializer.context.get("request")
    sent = getattr(serializer, "initial_data", None)
    return bool(request and request.method == "PATCH" and isinstance(sent, dict) and field in sent)


def _mask_email_or_none(email):
    from .claims import mask_email
    return (mask_email(email) or None) if email else None


class CustomerListSerializer(serializers.ModelSerializer):
    """Staff list: the phone and email are masked. The full phone is a
    sudo-gated, audited POST (marketplace/customers/<id>/reveal-phone/)."""

    class Meta:
        model = Customer
        fields = ["id", "full_name", "phone", "email", "is_suspended", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["phone"] = mask_phone(instance.phone) if instance.phone else None
        data["email"] = _mask_email_or_none(instance.email)
        return data


class BusinessOwnerListSerializer(serializers.ModelSerializer):
    # The business's name — the profile's, or the owner's own when none is set
    # (BusinessOwner.display_name). The Fraud cases business picker shows it
    # (staff phase 2A).
    business_name = serializers.CharField(source="display_name", read_only=True)

    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "business_name", "login_phone", "email", "kyc_status",
            "is_suspended", "created_at",
        ]

    def to_representation(self, instance):
        # Masked: the full sign-in phone is the sudo-gated, audited
        # portfolio/businesses/<id>/reveal-phone/.
        data = super().to_representation(instance)
        data["login_phone"] = mask_phone(instance.login_phone) if instance.login_phone else None
        data["email"] = _mask_email_or_none(instance.email)
        return data


# ── Staff user-management (staff user-management tools) ─────────────────────
# Detail + edit shapes for the admin Users tab. Reading them needs users.view;
# PATCH (and suspend/unsuspend) needs users.manage, and so does seeing a
# business owner's payout and tax (TIN) details — a view-only session's
# business-owner detail omits those keys entirely (see
# StaffBusinessOwnerDetailSerializer.RESTRICTED_PROFILE_KEYS). Staff
# may correct core identity fields (a mistyped name/phone/email) but never
# touch password_hash, suspension state (set via the dedicated suspend/
# unsuspend actions), or KYC state (its own moderation flow). is_suspended/
# suspension_reason are read-only here — surfaced for display, mutated only
# through the suspend/unsuspend endpoints.
class StaffCustomerDetailSerializer(serializers.ModelSerializer):
    # Real payment history (punch-list item 9). NOTE: there is deliberately no
    # "payment type" or "last 5 digits of their card" here — no payment-method/
    # card/wallet model exists anywhere in this codebase (payments are
    # simulated, CheckoutSession stores no instrument). So the honest answer to
    # "what did they pay with" is their actual payment history: what they
    # bought, how much, and whether it succeeded. Sourced from CheckoutSession
    # in a SerializerMethodField rather than invented.
    payment_history = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = [
            "id", "full_name", "phone", "email", "address", "gender", "date_of_birth",
            "is_suspended", "suspension_reason", "payment_history", "created_at",
        ]
        read_only_fields = ["id", "is_suspended", "suspension_reason", "payment_history", "created_at"]
        extra_kwargs = {
            "full_name": {"required": False},
            "phone": {"required": False},
            "email": {"required": False},
            "address": {"required": False},
            "gender": {"required": False},
            "date_of_birth": {"required": False},
        }

    def to_representation(self, instance):
        # The phone is masked on every read; it is echoed in full only when this
        # PATCH just sent it. Otherwise the full phone is the sudo-gated reveal.
        data = super().to_representation(instance)
        if instance.phone and not _sent_in_this_patch(self, "phone"):
            data["phone"] = mask_phone(instance.phone)
        return data

    def validate_phone(self, value):
        if value and "*" in value:
            raise serializers.ValidationError("That is the masked number; type the full phone or leave it unchanged.")
        return value

    def get_payment_history(self, obj):
        # Last 10 payment attempts, newest first. Only what the backend
        # actually records — kind/purpose/amount/status/date.
        sessions = obj.checkout_sessions.all().order_by("-created_at")[:10]
        return [
            {
                "kind": s.kind,
                "purpose": s.purpose,
                "amount": str(s.amount),
                "status": s.status,
                "created_at": s.created_at,
            }
            for s in sessions
        ]


class StaffBusinessOwnerDetailSerializer(serializers.ModelSerializer):
    # Full profile (punch-list item 9) — surfaced read-only for staff review;
    # the editable identity fields stay the three below. `profile` is the
    # OneToOne BusinessOwnerProfile; a business owner mid-registration may not
    # have one yet, so every getter tolerates its absence.
    profile = serializers.SerializerMethodField()

    # Payout + tax details are users.manage-only. A session without it (a
    # users.view-only role such as support/scout) gets a profile WITHOUT these
    # keys — absent, not nulled — so they never leave the server for it. The
    # view passes `can_see_payout` in the serializer context from the
    # session's effective permissions; it defaults to False (fail closed).
    # The KYC review (BusinessOwnerProfileKYCDetailSerializer) still shows the
    # TIN to kyc.approve on purpose — see the note there.
    RESTRICTED_PROFILE_KEYS = (
        "tin",
        "default_payout_method", "payout_verification_status", "payout_bank_name",
        "payout_bank_account_name", "payout_bank_account_number_masked",
        "payout_momo_network", "payout_momo_name", "payout_momo_number_masked",
    )

    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "login_phone", "email", "kyc_status", "kyc_rejection_reason",
            "is_suspended", "suspension_reason", "profile", "created_at",
        ]
        read_only_fields = [
            "id", "kyc_status", "kyc_rejection_reason",
            "is_suspended", "suspension_reason", "profile", "created_at",
        ]
        extra_kwargs = {
            "full_name": {"required": False},
            "login_phone": {"required": False},
            "email": {"required": False},
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.login_phone and not _sent_in_this_patch(self, "login_phone"):
            data["login_phone"] = mask_phone(instance.login_phone)
        profile = data.get("profile")
        if profile and profile.get("business_contact_phone"):
            profile["business_contact_phone"] = mask_phone(profile["business_contact_phone"])
        return data

    def validate_login_phone(self, value):
        if value and "*" in value:
            raise serializers.ValidationError("That is the masked number; type the full phone or leave it unchanged.")
        return value

    def get_profile(self, obj):
        profile = getattr(obj, "profile", None)
        if profile is None:
            return None
        if not self.context.get("can_see_payout", False):
            return {
                key: value for key, value in self._full_profile(profile).items()
                if key not in self.RESTRICTED_PROFILE_KEYS
            }
        return self._full_profile(profile)

    def _full_profile(self, profile):
        return {
            "business_contact_phone": profile.business_contact_phone,
            "business_kind": profile.business_kind,
            "gps_address": profile.gps_address,
            "is_formal": profile.is_formal,
            "tin": profile.tin,
            "address_verified": profile.address_verified,
            "address_verified_by_name": (
                profile.address_verified_by.full_name if profile.address_verified_by else None
            ),
            "address_verified_at": profile.address_verified_at,
            # Payout details — the ONLY place these leave the server, and
            # masked to the last 5 (the numbers are stored unmasked). Names are
            # not sensitive and shown in full; the account/momo numbers are
            # masked; the network/bank/method labels are not numbers.
            "default_payout_method": profile.default_payout_method,
            "payout_verification_status": profile.payout_verification_status,
            "payout_bank_name": profile.payout_bank_name,
            "payout_bank_account_name": profile.payout_bank_account_name,
            "payout_bank_account_number_masked": mask_but_last(profile.payout_bank_account_number),
            "payout_momo_network": profile.payout_momo_network,
            "payout_momo_name": profile.payout_momo_name,
            "payout_momo_number_masked": mask_but_last(profile.payout_momo_number),
        }


class StaffListSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source="role.name", read_only=True)
    manager = serializers.IntegerField(source="manager_id", read_only=True, allow_null=True)
    manager_name = serializers.CharField(source="manager.full_name", read_only=True, default=None)
    status = serializers.SerializerMethodField()
    # Effective permissions, so the panel's per-staffer permission editor
    # (item 9) can show what's currently allowed without a second request.
    permissions = serializers.SerializerMethodField()
    # The role's own permission set, so the editor can compute grant/revoke
    # as a diff against it — a permission that's effective but NOT in this set
    # is an individual grant that must be preserved, which an "effective set
    # only" view can't tell apart. Not sensitive: a role's permissions are
    # already derivable from the role.
    role_permissions = serializers.SerializerMethodField()
    # From the session table (F9) — this replaces the missing last_login.
    last_sign_in_at = serializers.DateTimeField(read_only=True)
    areas = serializers.SerializerMethodField()
    invite_state = serializers.SerializerMethodField()

    class Meta:
        model = StaffUser
        fields = [
            "id", "full_name", "email", "phone", "role", "manager", "manager_name", "status",
            "is_suspended", "suspension_reason", "is_active",
            "permissions", "role_permissions", "created_at", "last_sign_in_at",
            "start_date", "areas", "invite_state", "invite_sent_at", "invite_expires_at", "invite_opened_at", "activated_at",
        ]

    def get_areas(self, obj):
        return sorted(z.name for z in obj.areas.all())

    def get_invite_state(self, obj):
        """not_opened | opened | expired for an invite still waiting, else None."""
        return invite_state(obj)

    def get_status(self, obj):
        # Deactivation and suspension take priority over invite state — a
        # deactivated staffer is deactivated whether or not their invite ever
        # completed. Order matters: deactivated is the more terminal of the two.
        if not obj.is_active:
            return "deactivated"
        if obj.is_suspended:
            return "suspended"
        if obj.invite_token is None:
            return "active"
        if obj.invite_expires_at and obj.invite_expires_at < timezone.now():
            return "invite_expired"
        return "invited"

    def get_permissions(self, obj):
        return sorted(obj.effective_permission_codenames())

    def get_role_permissions(self, obj):
        return sorted(obj.role.permissions.values_list("codename", flat=True))


class ScoutAssignmentSerializer(serializers.ModelSerializer):
    """Read shape for both the admin's assignment list and the scout's own
    queue (item 11). Surfaces the business's KYC/address details a scout needs
    in the field without a second request.
    """

    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True)
    business_login_phone = serializers.CharField(source="business_owner.login_phone", read_only=True)
    scout_name = serializers.CharField(source="scout.full_name", read_only=True)
    assigned_by_name = serializers.CharField(source="assigned_by.full_name", read_only=True, default=None)
    gps_address = serializers.SerializerMethodField()
    business_kind = serializers.SerializerMethodField()

    class Meta:
        model = ScoutAssignment
        fields = [
            "id", "business_owner", "business_owner_name", "business_login_phone",
            "scout", "scout_name", "assigned_by_name", "status",
            "gps_address", "business_kind",
            "address_confirmed", "corrected_address", "business_legitimate",
            "details_correct", "notes", "visited_at", "created_at",
        ]
        read_only_fields = fields

    def _profile(self, obj):
        return getattr(obj.business_owner, "profile", None)

    def get_gps_address(self, obj):
        profile = self._profile(obj)
        return profile.gps_address if profile else None

    def get_business_kind(self, obj):
        profile = self._profile(obj)
        return profile.business_kind if profile else None


def staff_brief(staff):
    """The compact staff shape shared by serializers. None in, None out."""
    if staff is None:
        return None
    return {"id": staff.id, "full_name": staff.full_name, "role": staff.role.name}


class StaffSessionSerializer(serializers.ModelSerializer):
    ends_at = serializers.SerializerMethodField()
    idle_ends_at = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()
    staff = serializers.SerializerMethodField()

    class Meta:
        model = StaffSession
        fields = [
            "id", "device_label", "ip", "created_at", "last_seen_at", "ends_at", "idle_ends_at",
            "revoked_at", "revoked_reason", "is_active", "is_current", "two_factor", "staff",
        ]

    def get_ends_at(self, obj):
        return obj.created_at + sessions.ABSOLUTE_LIMIT

    def get_idle_ends_at(self, obj):
        return obj.last_seen_at + sessions.IDLE_LIMIT

    def get_is_active(self, obj):
        return sessions.end_reason_if_invalid(obj) is None

    def get_is_current(self, obj):
        current = self.context.get("current_session")
        return bool(current and current.pk == obj.pk)

    def get_staff(self, obj):
        return staff_brief(obj.staff)
