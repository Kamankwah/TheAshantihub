from django.db import models

COMMON_PURPOSES = [("other", "Other")]
PURPOSES_BY_ROLE = {
    # The values stay (history stays valid); the labels are the scout canvas's words.
    "scout": [
        ("subscription_payment", "Subscription reminder"), ("onboarding", "Onboarding help"),
        ("photos_listings", "Photos & listings"), ("delivery_follow_up", "Delivery follow-up"),
        ("info_update", "Info update"), ("prospecting", "Prospecting"),
    ],
    "support": [
        ("order_question", "Order question"), ("delivery", "Delivery"), ("payment", "Payment"),
        ("complaint", "Complaint"), ("refund_return", "Refund or return"), ("account_help", "Account help"),
        ("business_question", "Business question"),
    ],
    "operations": [
        ("escalation", "Escalation"), ("fraud_check", "Fraud check"), ("kyc_follow_up", "KYC follow-up"),
        ("business_issue", "Business issue"), ("staff_follow_up", "Staff follow-up"),
    ],
}


def purposes_for(role_name):
    if role_name == "super_admin":
        merged = {value: label for options in PURPOSES_BY_ROLE.values() for value, label in options}
        return sorted(merged.items(), key=lambda item: item[1]) + COMMON_PURPOSES
    return PURPOSES_BY_ROLE.get(role_name, []) + COMMON_PURPOSES


class CallLog(models.Model):
    DIRECTION_CHOICES = [("in", "Inbound"), ("out", "Outbound")]
    CHANNEL_CHOICES = [("phone", "Phone"), ("whatsapp", "WhatsApp"), ("sms", "SMS"), ("visit", "Visit")]
    COUNTERPART_CHOICES = [
        ("customer", "Customer"), ("business_owner", "Business owner"), ("prospect", "Prospect"),
        ("guest", "Guest"), ("other", "Other"),
    ]
    OUTCOME_CHOICES = [
        ("connected", "Connected"), ("no_answer", "No answer"), ("busy", "Busy"), ("voicemail", "Voicemail"),
        ("wrong_number", "Wrong number"), ("promised_to_pay", "Promised to pay"),
        ("callback_requested", "Callback requested"),
    ]
    SENTIMENT_CHOICES = [("positive", "Positive"), ("neutral", "Neutral"), ("negative", "Negative")]

    staff = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="call_logs")
    direction = models.CharField(max_length=3, choices=DIRECTION_CHOICES)
    channel = models.CharField(max_length=10, choices=CHANNEL_CHOICES, default="phone")
    counterpart_type = models.CharField(max_length=20, choices=COUNTERPART_CHOICES)
    counterpart_id = models.PositiveBigIntegerField(null=True, blank=True)
    counterpart_name = models.CharField(max_length=150, blank=True, default="")
    counterpart_phone = models.CharField(max_length=20, blank=True, default="")
    related_type = models.CharField(max_length=50, blank=True, default="")
    related_id = models.CharField(max_length=64, blank=True, default="")
    related_label = models.CharField(max_length=200, blank=True, default="")
    purpose = models.CharField(max_length=40)
    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES)
    sentiment = models.CharField(max_length=10, choices=SENTIMENT_CHOICES, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    started_at = models.DateTimeField()
    duration_seconds = models.PositiveIntegerField(default=0)
    follow_up_at = models.DateTimeField(null=True, blank=True)
    follow_up_task = models.OneToOneField(
        "staff_tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="call_log"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        indexes = [models.Index(fields=["staff", "-started_at"]), models.Index(fields=["related_type", "related_id"])]
