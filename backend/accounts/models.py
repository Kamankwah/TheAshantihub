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
    # Field-work roles (punch-list item 11). max_length=20 fits the longest,
    # "delivery_manager" (16).
    SCOUT = "scout"
    DELIVERY_MANAGER = "delivery_manager"
    DISPATCH = "dispatch"

    NAME_CHOICES = [
        (SUPER_ADMIN, "Super Admin"),
        (ADMIN, "Admin"),
        (ACCOUNTANT, "Accountant"),
        (MARKETING, "Marketing"),
        (SUPPORT, "Support"),
        (SCOUT, "Scout"),
        (DELIVERY_MANAGER, "Delivery Manager"),
        (DISPATCH, "Dispatch"),
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

    # Staff moderation (staff user-management tools) — a suspended account is
    # blocked at login (see CustomerLoginSerializer) and its content is hidden
    # from public browse (see the public listing/event querysets). The token of
    # an already-signed-in account stays valid until expiry — suspension is
    # enforced at the login boundary, not per-request.
    is_suspended = models.BooleanField(default=False)
    suspension_reason = models.CharField(max_length=500, blank=True, default="")

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

    # Two distinct ways to stop a staffer signing in (punch-list item 10),
    # cloned from the Customer/BusinessOwner precedent in migration 0021:
    #
    # - is_suspended: a temporary hold (misconduct, investigation). Carries a
    #   reason, same as the customer/owner fields of the same name.
    # - is_active: cleared when someone leaves the company. No reason field —
    #   "they don't work here" is the whole story.
    #
    # Both are reversible and both reject at login (see StaffLoginSerializer).
    # Kept as two booleans rather than one status enum so a staffer can be
    # suspended *and* later deactivated without one overwriting the other's
    # history.
    is_suspended = models.BooleanField(default=False)
    suspension_reason = models.CharField(max_length=500, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    # Per-staffer permission overrides (punch-list item 9). Permissions
    # otherwise come only from `role`, so "add or take" a permission for one
    # person had nowhere to live — editing Role.permissions would silently
    # re-permission every staffer sharing that role.
    #
    # Effective set = role.permissions + extra_permissions - revoked_permissions
    # (see effective_permission_codenames below). `revoked` wins over `extra`
    # on the assumption that an explicit take-away is the more deliberate act.
    extra_permissions = models.ManyToManyField(
        Permission, related_name="granted_to_staff", blank=True
    )
    revoked_permissions = models.ManyToManyField(
        Permission, related_name="revoked_from_staff", blank=True
    )

    def effective_permission_codenames(self):
        """The single source of truth for what this staffer can do.

        Both HasRolePermission and GET /api/accounts/me/'s `permissions` list
        read this — they must agree, or the UI would gate differently from the
        server and show buttons that 403.
        """
        role_codenames = set(self.role.permissions.values_list("codename", flat=True))
        extra = set(self.extra_permissions.values_list("codename", flat=True))
        revoked = set(self.revoked_permissions.values_list("codename", flat=True))
        return (role_codenames | extra) - revoked

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

    # Approver attribution (staff moderation-queue restructuring) — which staff
    # member approved OR rejected this KYC submission, and when. Set by
    # KYCApproveView/KYCRejectView; cleared by KYCReReviewView when a rejected
    # submission is re-opened back to pending. The canonical `reviewed_by`/
    # `reviewed_at` pair shared by every moderated model (Listing,
    # HeroMediaSubmission) so the Approved/Rejected staff tabs can show who
    # actioned each item.
    reviewed_by = models.ForeignKey(
        "StaffUser", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_business_owners",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    # Staff moderation (staff user-management tools) — same semantics as
    # Customer.is_suspended above: blocks login and hides this owner's
    # listings/events from public browse.
    is_suspended = models.BooleanField(default=False)
    suspension_reason = models.CharField(max_length=500, blank=True, default="")

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

    # Ghana Post address verification (staff moderation-queue restructuring,
    # punch-list item 8) — a staff toggle confirming the business's Ghana Post
    # digital address (gps_address) during KYC review. A precursor to the
    # future Scouts field-verification role; for now just a staff-set flag +
    # attribution. `address_verified_at` being non-null is the "a decision has
    # been made" signal the KYC Approve/Reject gating keys off of (verified ✓
    # or explicitly marked wrong both set it).
    address_verified = models.BooleanField(default=False)
    address_verified_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="address_verified_profiles",
    )
    address_verified_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Profile for {self.business_owner.full_name}"


class ScoutAssignment(models.Model):
    """A scout's field-verification assignment for one business (punch-list
    item 11). An admin (scouts.assign) assigns a scout to a business; the scout
    (scouts.verify) visits, then submits a field report. Completing the report
    writes the same BusinessOwnerProfile.address_verified/_by/_at fields the
    KYC Approve/Reject gate (item 8) reads — so either a scout in the field OR
    a KYC staffer at the desk can satisfy that gate ("either can verify").

    The scout can also correct the Ghana Post address if it was wrong, and
    records whether the business is legitimate and the owner's details match —
    the three things the field visit is for.
    """

    ASSIGNED = "assigned"
    VISITED = "visited"  # report submitted
    STATUS_CHOICES = [
        (ASSIGNED, "Assigned"),
        (VISITED, "Visited"),
    ]

    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="scout_assignments"
    )
    scout = models.ForeignKey(
        StaffUser, on_delete=models.CASCADE, related_name="scout_assignments"
    )
    assigned_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="scout_assignments_made",
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=ASSIGNED)

    # Field report — all null until the scout submits. address_confirmed False
    # means the stated Ghana Post address was wrong; corrected_address then
    # holds the right one (and is written onto the profile's gps_address).
    address_confirmed = models.BooleanField(null=True, blank=True)
    corrected_address = models.CharField(max_length=20, blank=True)
    business_legitimate = models.BooleanField(null=True, blank=True)
    details_correct = models.BooleanField(null=True, blank=True)
    notes = models.TextField(blank=True)
    visited_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # A business only needs one open scout assignment at a time; a
            # scout can't be double-assigned to the same business.
            models.UniqueConstraint(
                fields=["business_owner", "scout"], name="unique_scout_per_business"
            ),
        ]

    def __str__(self):
        return f"Scout {self.scout_id} → {self.business_owner_id} ({self.status})"


class PasswordResetToken(models.Model):
    """Cross-cutting reset-token store shared by all three account types —
    a single model rather than a per-model token field, since none of
    Customer/BusinessOwner/StaffUser carry one today (only StaffUser has the
    analogous invite_token/invite_expires_at pair, which is invite-specific).
    account_type uses the same three string values authentication.issue_token
    / the login serializers already use.
    """

    CUSTOMER = "customer"
    BUSINESS_OWNER = "business_owner"
    STAFF = "staff"
    ACCOUNT_TYPE_CHOICES = [
        (CUSTOMER, "Customer"),
        (BUSINESS_OWNER, "Business Owner"),
        (STAFF, "Staff"),
    ]

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.IntegerField()
    token = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.account_type}:{self.account_id} reset token"
