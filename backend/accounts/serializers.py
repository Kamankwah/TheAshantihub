import datetime

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import serializers

from .authentication import ACCOUNT_MODELS
from .emails import send_password_reset_email, send_staff_invite_email
from .gps import validate_ashanti_gps
from .models import (
    BusinessOwner,
    BusinessOwnerProfile,
    Customer,
    PasswordResetToken,
    Role,
    ScoutAssignment,
    StaffUser,
)

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


class CustomerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = Customer
        fields = ["id", "full_name", "phone", "email", "password"]

    def validate(self, attrs):
        phone = attrs.get("phone")
        email = attrs.get("email")
        if not phone and not email:
            raise serializers.ValidationError(
                "At least one of phone or email is required."
            )
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["password_hash"] = make_password(password)
        return Customer.objects.create(**validated_data)


INVITE_TOKEN_LIFETIME = datetime.timedelta(days=7)


class StaffInviteSerializer(serializers.ModelSerializer):
    role = serializers.SlugRelatedField(slug_field="name", queryset=Role.objects.all())

    class Meta:
        model = StaffUser
        fields = ["id", "full_name", "email", "phone", "role"]

    def validate_role(self, value):
        requester = self.context["request"].user
        if value.name == Role.SUPER_ADMIN and requester.role.name != Role.SUPER_ADMIN:
            raise serializers.ValidationError("Only a super_admin can invite another super_admin.")
        return value

    def create(self, validated_data):
        # password_hash stays unusable until /staff/activate/ sets a real password.
        validated_data["password_hash"] = make_password(get_random_string(32))
        validated_data["invited_by"] = self.context["request"].user
        validated_data["invite_token"] = get_random_string(43)
        validated_data["invite_expires_at"] = timezone.now() + INVITE_TOKEN_LIFETIME
        staff = StaffUser.objects.create(**validated_data)
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
        self.staff.save(update_fields=["password_hash", "invite_token", "invite_expires_at"])
        return self.staff


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
        self.account.password_hash = make_password(self.validated_data["password"])
        self.account.save(update_fields=["password_hash"])
        self.reset_token.used_at = timezone.now()
        self.reset_token.save(update_fields=["used_at"])
        return self.account


class BusinessOwnerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    kyc_status = serializers.CharField(read_only=True)

    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "login_phone", "email", "password", "kyc_status"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["password_hash"] = make_password(password)
        owner = BusinessOwner.objects.create(**validated_data)
        BusinessOwnerProfile.objects.create(business_owner=owner)
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

    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "login_phone", "kyc_status", "kyc_rejection_reason",
            "created_at", "reviewed_by_name", "reviewed_at",
        ]


class BusinessOwnerProfileKYCDetailSerializer(serializers.ModelSerializer):
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
        ]


class BusinessOwnerKYCDetailSerializer(serializers.ModelSerializer):
    profile = BusinessOwnerProfileKYCDetailSerializer(read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True, default=None)

    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "login_phone", "email", "kyc_status", "kyc_rejection_reason",
            "created_at", "reviewed_by_name", "reviewed_at", "profile",
        ]


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
        instance.save()
        return instance


class BusinessOwnerProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "gps_address", "business_contact_phone", "is_formal",
            "business_reg_certificate", "tin", "business_kind",
        ]
        extra_kwargs = {field: {"required": False} for field in fields}
        # business_kind is set at trial-start (billing.StartTrialSerializer) and
        # drives listing-category / subscription-plan gating on the frontend; it
        # is exposed here read-only so the owner's dashboard can read it, but
        # this KYC-edit endpoint must never let it be switched.
        extra_kwargs["business_kind"] = {"read_only": True}

    def validate(self, data):
        owner = self.instance.business_owner
        if owner.kyc_status == BusinessOwner.VERIFIED:
            raise serializers.ValidationError(
                {"kyc_status": "Cannot edit a verified KYC profile."}
            )

        # Ghana Card number and a Ghana Post GPS address are mandatory for a
        # business, and the GPS address must be in the Ashanti Region. Checked
        # against the effective (post-update) values so a partial edit of an
        # already-complete profile still passes.
        ghana_card = data.get("ghana_card_number", self.instance.ghana_card_number)
        if not (ghana_card or "").strip():
            raise serializers.ValidationError(
                {"ghana_card_number": "Your Ghana Card number is required."}
            )
        gps = data.get("gps_address", self.instance.gps_address)
        try:
            validate_ashanti_gps(gps)
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({"gps_address": exc.detail})

        is_formal = data.get("is_formal", self.instance.is_formal)
        if is_formal:
            cert = data.get("business_reg_certificate", self.instance.business_reg_certificate)
            tin = data.get("tin", self.instance.tin)
            if not cert:
                raise serializers.ValidationError(
                    {"business_reg_certificate": "Required for formally registered businesses."}
                )
            if not tin:
                raise serializers.ValidationError({"tin": "Required for formally registered businesses."})
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
        account = BusinessOwner.objects.filter(
            Q(login_phone=attrs["identifier"]) | Q(email=attrs["identifier"])
        ).first()
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
        if account is None or not password_valid:
            raise serializers.ValidationError("Invalid credentials")
        # Only surfaced after valid credentials — never leaks account state to
        # someone who couldn't otherwise sign in (punch-list item 10). Both a
        # temporary suspension and a "no longer works here" deactivation stop
        # login; they carry different copy so the staffer knows which it is.
        if account.is_suspended:
            raise serializers.ValidationError(SUSPENDED_LOGIN_MESSAGE)
        if not account.is_active:
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


class CustomerListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "full_name", "phone", "email", "is_suspended", "created_at"]


class BusinessOwnerListSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "login_phone", "email", "kyc_status",
            "is_suspended", "created_at",
        ]


# ── Staff user-management (staff user-management tools) ─────────────────────
# Detail + edit shapes for the admin Users tab, gated by users.manage. Staff
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

    def get_profile(self, obj):
        profile = getattr(obj, "profile", None)
        if profile is None:
            return None
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

    class Meta:
        model = StaffUser
        fields = [
            "id", "full_name", "email", "phone", "role", "status",
            "is_suspended", "suspension_reason", "is_active",
            "permissions", "role_permissions", "created_at",
        ]

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
