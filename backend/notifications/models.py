from django.db import models

from accounts.models import BusinessOwner, Customer, StaffUser


class Notification(models.Model):
    """A single in-app notification for one recipient.

    Recipient identity is a nullable-FK trio — exactly one of
    `customer`/`business_owner`/`staff` is set per row, enforced by the
    CheckConstraint below. Same "exactly one of N nullable FKs" shape as
    messaging.Conversation's customer/business_owner/guest_token trio and
    billing.Transaction's business_owner/customer pair. A staff row targets
    a specific StaffUser (fan-out to a role's members is done one-row-per-
    staffer by notifications.services.notify_staff_role — the model itself
    never targets a whole role).

    Delivery is in-app only: rows are read back via GET /api/notifications/.
    There is no email/SMS/push transport (same "the preference/record is
    real, the transport is future work" caveat as accounts.emails and the
    Customer.*_notifications_enabled flags).
    """

    # `kind` is a free-form slug with documented choices — not DB-enforced
    # (choices never are), just a stable vocabulary the frontend can branch
    # on if it ever needs to. New triggers may add new kinds freely.
    KYC_APPROVED = "kyc_approved"
    KYC_REJECTED = "kyc_rejected"
    KYC_NEEDS_APPROVAL = "kyc_needs_approval"
    LISTING_APPROVED = "listing_approved"
    LISTING_REJECTED = "listing_rejected"
    LISTING_NEEDS_MODERATION = "listing_needs_moderation"
    EVENT_APPROVED = "event_approved"
    EVENT_REJECTED = "event_rejected"
    EVENT_NEEDS_APPROVAL = "event_needs_approval"
    HERO_APPROVED = "hero_approved"
    HERO_REJECTED = "hero_rejected"
    HERO_NEEDS_APPROVAL = "hero_needs_approval"
    ORDER_STATUS = "order_status"
    SUPPORT_REPLY = "support_reply"
    NEW_MESSAGE = "new_message"
    CONTACT_MESSAGE = "contact_message"
    KIND_CHOICES = [
        (KYC_APPROVED, "KYC approved"),
        (KYC_REJECTED, "KYC rejected"),
        (KYC_NEEDS_APPROVAL, "KYC needs approval"),
        (LISTING_APPROVED, "Listing approved"),
        (LISTING_REJECTED, "Listing rejected"),
        (LISTING_NEEDS_MODERATION, "Listing needs moderation"),
        (EVENT_APPROVED, "Event approved"),
        (EVENT_REJECTED, "Event rejected"),
        (EVENT_NEEDS_APPROVAL, "Event needs approval"),
        (HERO_APPROVED, "Hero submission approved"),
        (HERO_REJECTED, "Hero submission rejected"),
        (HERO_NEEDS_APPROVAL, "Hero submission needs approval"),
        (ORDER_STATUS, "Order status changed"),
        (SUPPORT_REPLY, "Support reply"),
        (NEW_MESSAGE, "New support message"),
        (CONTACT_MESSAGE, "New contact message"),
    ]

    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, null=True, blank=True, related_name="notifications"
    )
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, null=True, blank=True, related_name="notifications"
    )
    staff = models.ForeignKey(
        StaffUser, on_delete=models.CASCADE, null=True, blank=True, related_name="notifications"
    )

    kind = models.CharField(max_length=40, choices=KIND_CHOICES)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    # An in-app path the frontend can route to ("/business-dashboard",
    # "/my-account", "/events") or a staff dashboard tab id ("kyc",
    # "moderation", "events-moderation", ...) for staff-targeted rows.
    link = models.CharField(max_length=200, blank=True)
    icon = models.CharField(max_length=8, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(customer__isnull=False, business_owner__isnull=True, staff__isnull=True)
                    | models.Q(customer__isnull=True, business_owner__isnull=False, staff__isnull=True)
                    | models.Q(customer__isnull=True, business_owner__isnull=True, staff__isnull=False)
                ),
                name="notification_exactly_one_recipient",
            ),
        ]
        indexes = [
            models.Index(fields=["customer", "is_read"]),
            models.Index(fields=["business_owner", "is_read"]),
            models.Index(fields=["staff", "is_read"]),
        ]

    @property
    def recipient_display_name(self):
        if self.customer_id:
            return self.customer.full_name
        if self.business_owner_id:
            return self.business_owner.full_name
        if self.staff_id:
            return self.staff.full_name
        return "?"

    def __str__(self):
        return f"[{self.kind}] {self.title} → {self.recipient_display_name}"
