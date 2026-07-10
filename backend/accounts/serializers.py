import datetime

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import serializers

from .models import BusinessOwner, BusinessOwnerProfile, Customer, Role, StaffUser
from .validators import validate_document_content_type, validate_image_content_type


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
        return StaffUser.objects.create(**validated_data)


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


class BusinessOwnerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    ghana_card_number = serializers.CharField()
    ghana_card_front_image = serializers.ImageField(validators=[validate_image_content_type])
    ghana_card_back_image = serializers.ImageField(validators=[validate_image_content_type])
    gps_address = serializers.CharField()
    business_contact_phone = serializers.CharField()
    is_formal = serializers.BooleanField(default=False)
    business_reg_certificate = serializers.FileField(
        required=False, allow_null=True, validators=[validate_document_content_type]
    )
    tin = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_bank_name = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_bank_account_number = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_bank_account_name = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_momo_network = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_momo_number = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_momo_name = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    default_payout_method = serializers.ChoiceField(choices=BusinessOwnerProfile.PAYOUT_METHOD_CHOICES)
    kyc_status = serializers.CharField(read_only=True)

    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "login_phone", "email", "password", "kyc_status",
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "gps_address", "business_contact_phone", "is_formal",
            "business_reg_certificate", "tin",
            "payout_bank_name", "payout_bank_account_number", "payout_bank_account_name",
            "payout_momo_network", "payout_momo_number", "payout_momo_name",
            "default_payout_method",
        ]

    def validate(self, data):
        if data.get("is_formal"):
            if not data.get("business_reg_certificate"):
                raise serializers.ValidationError(
                    {"business_reg_certificate": "Required for formally registered businesses."}
                )
            if not data.get("tin"):
                raise serializers.ValidationError({"tin": "Required for formally registered businesses."})

        method = data.get("default_payout_method")
        if method == BusinessOwnerProfile.BANK and not data.get("payout_bank_account_number"):
            raise serializers.ValidationError(
                {"default_payout_method": "Bank details must be provided to set bank as the default payout method."}
            )
        if method == BusinessOwnerProfile.MOMO and not data.get("payout_momo_number"):
            raise serializers.ValidationError(
                {"default_payout_method": "Mobile money details must be provided to set momo as the default payout method."}
            )
        return data

    def create(self, validated_data):
        password = validated_data.pop("password")
        profile_fields = {
            "ghana_card_number": validated_data.pop("ghana_card_number"),
            "ghana_card_front_image": validated_data.pop("ghana_card_front_image"),
            "ghana_card_back_image": validated_data.pop("ghana_card_back_image"),
            "gps_address": validated_data.pop("gps_address"),
            "business_contact_phone": validated_data.pop("business_contact_phone"),
            "is_formal": validated_data.pop("is_formal"),
            "business_reg_certificate": validated_data.pop("business_reg_certificate", None),
            "tin": validated_data.pop("tin", None),
            "payout_bank_name": validated_data.pop("payout_bank_name", None),
            "payout_bank_account_number": validated_data.pop("payout_bank_account_number", None),
            "payout_bank_account_name": validated_data.pop("payout_bank_account_name", None),
            "payout_momo_network": validated_data.pop("payout_momo_network", None),
            "payout_momo_number": validated_data.pop("payout_momo_number", None),
            "payout_momo_name": validated_data.pop("payout_momo_name", None),
            "default_payout_method": validated_data.pop("default_payout_method"),
        }
        validated_data["password_hash"] = make_password(password)
        owner = BusinessOwner.objects.create(**validated_data)
        BusinessOwnerProfile.objects.create(business_owner=owner, **profile_fields)
        return owner

    def to_representation(self, instance):
        return {
            "id": instance.id,
            "full_name": instance.full_name,
            "login_phone": instance.login_phone,
            "kyc_status": instance.kyc_status,
        }


class BusinessOwnerKYCSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "login_phone", "kyc_status", "created_at"]


class BusinessOwnerProfileKYCDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "gps_address", "business_contact_phone", "is_formal",
            "business_reg_certificate", "tin",
        ]


class BusinessOwnerKYCDetailSerializer(serializers.ModelSerializer):
    profile = BusinessOwnerProfileKYCDetailSerializer(read_only=True)

    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "login_phone", "email", "kyc_status", "kyc_rejection_reason", "created_at", "profile"]


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
            "business_reg_certificate", "tin",
        ]
        extra_kwargs = {field: {"required": False} for field in fields}

    def validate(self, data):
        owner = self.instance.business_owner
        if owner.kyc_status == BusinessOwner.VERIFIED:
            raise serializers.ValidationError(
                {"kyc_status": "Cannot edit a verified KYC profile."}
            )

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
