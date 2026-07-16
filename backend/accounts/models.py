from django.db import models

from .mixins import AuthenticatableAccountMixin
from .validators import validate_document_content_type, validate_image_content_type


class Permission(models.Model):
    codename = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255)

    def __str__(self):
        return self.codename


class Role(models.Model):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    ACCOUNTANT = "accountant"
    MARKETING = "marketing"
    SUPPORT = "support"

    NAME_CHOICES = [
        (SUPER_ADMIN, "Super Admin"),
        (ADMIN, "Admin"),
        (ACCOUNTANT, "Accountant"),
        (MARKETING, "Marketing"),
        (SUPPORT, "Support"),
    ]

    name = models.CharField(max_length=20, choices=NAME_CHOICES, unique=True)
    permissions = models.ManyToManyField(Permission, related_name="roles", blank=True)

    def __str__(self):
        return self.name


class Customer(AuthenticatableAccountMixin, models.Model):
    FEMALE = "female"
    MALE = "male"
    OTHER = "other"
    PREFER_NOT_TO_SAY = "prefer_not_to_say"
    GENDER_CHOICES = [
        (FEMALE, "Female"),
        (MALE, "Male"),
        (OTHER, "Other"),
        (PREFER_NOT_TO_SAY, "Prefer not to say"),
    ]

    full_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20, unique=True, null=True, blank=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    avatar = models.ImageField(
        upload_to="customer_avatars/", null=True, blank=True,
        validators=[validate_image_content_type],
    )

    # Profile fields (user_account_dashboard work). `address` is a plain
    # free-text field — distinct from BusinessOwnerProfile.gps_address, which
    # stores a short Ghana Post digital-address code, not a full address.
    address = models.CharField(max_length=255, null=True, blank=True)
    gender = models.CharField(max_length=20, choices=GENDER_CHOICES, null=True, blank=True)
    # Date of birth rather than a raw "age" field — age drifts out of date,
    # DOB is the stable source of truth (the frontend computes/display age
    # from it).
    date_of_birth = models.DateField(null=True, blank=True)

    # Secondary/recovery email + phone, each independently verified via a
    # 6-digit code + expiry — same generate/validate/clear shape as
    # StaffUser.invite_token/invite_expires_at below, adapted to a short
    # numeric code since this is a type-in-a-code flow, not a click-a-link
    # one. There is no real email/SMS transport anywhere in this codebase
    # (Hubtel payments and AI messaging are likewise documented as
    # simulated/future work) — the issuing view returns the code directly in
    # its response rather than pretending to send it silently.
    secondary_email = models.EmailField(null=True, blank=True)
    secondary_email_verified = models.BooleanField(default=False)
    secondary_email_verify_code = models.CharField(max_length=6, null=True, blank=True)
    secondary_email_verify_expires_at = models.DateTimeField(null=True, blank=True)
    secondary_phone = models.CharField(max_length=20, null=True, blank=True)
    secondary_phone_verified = models.BooleanField(default=False)
    secondary_phone_verify_code = models.CharField(max_length=6, null=True, blank=True)
    secondary_phone_verify_expires_at = models.DateTimeField(null=True, blank=True)

    # Notification preferences — real, persisted opt-in flags (no delivery
    # mechanism exists yet to honor them, same caveat as everywhere else in
    # this file, but the preference itself is real and saved).
    email_notifications_enabled = models.BooleanField(default=True)
    sms_notifications_enabled = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.full_name


class StaffUser(AuthenticatableAccountMixin, models.Model):
    full_name = models.CharField(max_length=150)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="staff_members")
    invited_by = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="invited"
    )
    invite_token = models.CharField(max_length=64, unique=True, null=True, blank=True)
    invite_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.full_name} ({self.role.name})"


class BusinessOwner(AuthenticatableAccountMixin, models.Model):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"
    KYC_STATUS_CHOICES = [
        (PENDING, "Pending"),
        (VERIFIED, "Verified"),
        (REJECTED, "Rejected"),
    ]

    full_name = models.CharField(max_length=150)
    login_phone = models.CharField(max_length=20, unique=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    kyc_status = models.CharField(max_length=10, choices=KYC_STATUS_CHOICES, default=PENDING)
    kyc_rejection_reason = models.CharField(max_length=500, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.full_name

    def compute_registration_step(self):
        if self.kyc_status in (self.VERIFIED, self.REJECTED):
            return "complete"
        try:
            profile = self.profile
        except BusinessOwnerProfile.DoesNotExist:
            return "business_info"
        if not (profile.ghana_card_number and profile.gps_address
                and profile.business_contact_phone
                and profile.ghana_card_front_image
                and profile.ghana_card_back_image):
            return "business_info"
        if profile.is_formal and not (profile.business_reg_certificate and profile.tin):
            return "business_info"
        if not profile.business_kind or getattr(self, "subscription", None) is None:
            return "plan_selection"
        if not profile.default_payout_method:
            return "payment_info"
        if (profile.default_payout_method == BusinessOwnerProfile.MOMO
                and not profile.payout_momo_number):
            return "payment_info"
        if (profile.default_payout_method == BusinessOwnerProfile.BANK
                and not profile.payout_bank_account_number):
            return "payment_info"
        if not profile.terms_accepted_at:
            return "terms"
        return "complete"


class BusinessOwnerProfile(models.Model):
    BANK = "bank"
    MOMO = "momo"
    PAYOUT_METHOD_CHOICES = [(BANK, "Bank"), (MOMO, "Mobile Money")]

    business_owner = models.OneToOneField(
        BusinessOwner, on_delete=models.CASCADE, related_name="profile"
    )
    ghana_card_number = models.CharField(max_length=30, unique=True, null=True, blank=True)
    ghana_card_front_image = models.ImageField(
        upload_to="ghana_cards/", validators=[validate_image_content_type], null=True, blank=True
    )
    ghana_card_back_image = models.ImageField(
        upload_to="ghana_cards/", validators=[validate_image_content_type], null=True, blank=True
    )
    gps_address = models.CharField(max_length=20, null=True, blank=True)
    business_contact_phone = models.CharField(max_length=20, null=True, blank=True)

    # Same string values as listings.Category.kind ("product"/"service") —
    # a one-time choice captured at registration determining which of the
    # billing.SubscriptionPlan tiers (product_basic/product_unlimited vs
    # service) this business owner can pick.
    PRODUCT = "product"
    SERVICE = "service"
    BUSINESS_KIND_CHOICES = [(PRODUCT, "Product"), (SERVICE, "Service")]
    business_kind = models.CharField(
        max_length=10, choices=BUSINESS_KIND_CHOICES, null=True, blank=True
    )

    is_formal = models.BooleanField(default=False)
    business_reg_certificate = models.FileField(
        upload_to="business_reg_certificates/", null=True, blank=True,
        validators=[validate_document_content_type],
    )
    tin = models.CharField(max_length=30, null=True, blank=True)

    payout_bank_name = models.CharField(max_length=100, null=True, blank=True)
    payout_bank_account_number = models.CharField(max_length=50, null=True, blank=True)
    payout_bank_account_name = models.CharField(max_length=150, null=True, blank=True)
    payout_momo_network = models.CharField(max_length=20, null=True, blank=True)
    payout_momo_number = models.CharField(max_length=20, null=True, blank=True)
    payout_momo_name = models.CharField(max_length=150, null=True, blank=True)
    default_payout_method = models.CharField(
        max_length=10, choices=PAYOUT_METHOD_CHOICES, null=True, blank=True
    )
    payout_verification_status = models.CharField(
        max_length=10,
        choices=[("pending", "Pending"), ("verified", "Verified")],
        default="pending",
    )
    terms_accepted_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Profile for {self.business_owner.full_name}"
