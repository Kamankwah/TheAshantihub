"""One-time codes (spec §9). Nothing secret is stored in clear: a code is kept as a salted HMAC, a trusted-device
token and a step-up token as a SHA-256. Every row names its account by (account_type, account_id) because the
three account kinds are separate tables; account_type is one of accounts.authentication.ACCOUNT_MODELS' keys."""
from django.db import models
from django.utils import timezone

SMS = "sms"
EMAIL = "email"
AUTHENTICATOR = "authenticator"
CHANNEL_CHOICES = [(SMS, "Text message"), (EMAIL, "Email"), (AUTHENTICATOR, "Authenticator app")]
ACCOUNT_TYPE_CHOICES = [("customer", "Customer"), ("business_owner", "Business owner"), ("staff", "Staff")]

SIGN_IN = "sign_in"
SIGN_UP = "sign_up"
STEP_UP = "step_up"
RECOVERY = "recovery"
PURPOSE_CHOICES = [
    (SIGN_IN, "Signing in"), (SIGN_UP, "Confirming a contact"), (STEP_UP, "Confirming a sensitive change"),
    (RECOVERY, "Staff-assisted recovery"),
]


class OtpChallenge(models.Model):
    """One code in flight. `ticket` binds it to one sign-in attempt (the signed mfa_token's nonce) or, for a step-up,
    to the access token's jti, so a code sent for one attempt never completes another. A resend rotates the code
    and keeps `attempts`, so resending never buys more guesses (otp.service)."""

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.PositiveIntegerField()
    purpose = models.CharField(max_length=10, choices=PURPOSE_CHOICES)
    action = models.CharField(max_length=30, blank=True, default="")
    ticket = models.CharField(max_length=64, blank=True, default="")
    channel = models.CharField(max_length=15, choices=CHANNEL_CHOICES)
    destination = models.CharField(max_length=254)
    salt = models.CharField(max_length=32)
    code_hash = models.CharField(max_length=64)
    sends = models.PositiveSmallIntegerField(default=1)
    attempts = models.PositiveSmallIntegerField(default=0)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_sent_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["account_type", "account_id", "purpose", "ticket"])]

    def __str__(self):
        return f"{self.purpose} code for {self.account_type} {self.account_id}"


class OtpEvent(models.Model):
    """The OTP audit trail: codes sent, refused, accepted or wrong, locks, step-up tokens issued and used, trusted
    devices, authenticator changes, recoveries and SMS-spend alerts. Never holds a code or a token. Append-only in
    practice (no endpoint edits or removes a row; otp.retention drops rows after 400 days). The lock and the hourly
    send limits are counted from it, so they hold across every server process."""

    SENT = "sent"
    SEND_FAILED = "send_failed"
    SEND_REFUSED = "send_refused"
    VERIFIED = "verified"
    FAILED = "failed"
    LOCKED = "locked"
    STEP_UP_ISSUED = "step_up_issued"
    STEP_UP_USED = "step_up_used"
    DEVICE_TRUSTED = "device_trusted"
    DEVICE_REVOKED = "device_revoked"
    AUTHENTICATOR_ON = "authenticator_on"
    AUTHENTICATOR_OFF = "authenticator_off"
    RECOVERED = "recovered"
    SMS_ALERT = "sms_alert"
    KIND_CHOICES = [
        (SENT, "Code sent"), (SEND_FAILED, "Code could not be sent"), (SEND_REFUSED, "Code refused (limit or lock)"),
        (VERIFIED, "Code accepted"), (FAILED, "Wrong code"), (LOCKED, "Locked after wrong codes"),
        (STEP_UP_ISSUED, "Step-up given"), (STEP_UP_USED, "Step-up used"),
        (DEVICE_TRUSTED, "Device trusted"), (DEVICE_REVOKED, "Trusted device ended"),
        (AUTHENTICATOR_ON, "Authenticator turned on"), (AUTHENTICATOR_OFF, "Authenticator turned off"),
        (RECOVERED, "Recovered by staff"), (SMS_ALERT, "Text spend alert"),
    ]

    at = models.DateTimeField(default=timezone.now)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    account_type = models.CharField(max_length=20, blank=True, default="")
    account_id = models.PositiveIntegerField(null=True, blank=True)
    purpose = models.CharField(max_length=10, blank=True, default="")
    action = models.CharField(max_length=30, blank=True, default="")
    channel = models.CharField(max_length=15, blank=True, default="")
    destination = models.CharField(max_length=254, blank=True, default="")
    provider = models.CharField(max_length=20, blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["account_type", "account_id", "kind", "at"]),
            models.Index(fields=["destination", "kind", "at"]),
            models.Index(fields=["ip", "kind", "at"]),
            models.Index(fields=["kind", "at"]),
        ]

    def __str__(self):
        return f"{self.at:%Y-%m-%d %H:%M} {self.kind}"


class TrustedDevice(models.Model):
    """A browser a customer chose to trust after a code (otp.devices). The raw token lives only on the device; the
    row keeps its SHA-256. It skips the sign-in code only while it is not revoked, its password fingerprint matches
    the account's current password (any password change ends it), and its last code is newer than the customer gap
    (staffsecurity.policy.otp_customer_gap_days)."""

    PASSWORD_RESET = "password_reset"
    REMOVED = "removed"
    REMOVED_ALL = "removed_all"
    STAFF_RECOVERY = "staff_recovery"
    REASON_CHOICES = [
        (PASSWORD_RESET, "Password reset"), (REMOVED, "Removed by the account holder"),
        (REMOVED_ALL, "All devices removed by the account holder"), (STAFF_RECOVERY, "Ended by a staff-assisted recovery"),
    ]

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.PositiveIntegerField()
    token_hash = models.CharField(max_length=64, unique=True)
    label = models.CharField(max_length=120, blank=True, default="")
    password_fingerprint = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)
    verified_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=20, blank=True, default="", choices=REASON_CHOICES)

    class Meta:
        indexes = [models.Index(fields=["account_type", "account_id", "revoked_at"])]

    def __str__(self):
        return f"{self.label or 'Device'} of {self.account_type} {self.account_id}"


class StepUpToken(models.Model):
    """A single-use, 5-minute permission for one sensitive action, bound to the access token (jti) it was issued
    to (otp.step_up). Only the SHA-256 of the token is kept."""

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.PositiveIntegerField()
    action = models.CharField(max_length=30)
    token_hash = models.CharField(max_length=64, unique=True)
    jti = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.action} step-up for {self.account_type} {self.account_id}"


class VerifiedContact(models.Model):
    """A phone or email this account proved it receives (a code sent to it was accepted). Matched on the normalised
    destination, so a changed phone or email is unverified until a code to it is accepted."""

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.PositiveIntegerField()
    channel = models.CharField(max_length=15, choices=CHANNEL_CHOICES)
    destination = models.CharField(max_length=254)
    verified_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["account_type", "account_id", "channel", "destination"], name="otp_unique_verified_contact"),
        ]

    def __str__(self):
        return f"{self.channel} of {self.account_type} {self.account_id}"


class AccountAuthenticator(models.Model):
    """An authenticator app (TOTP) for a customer or a business owner (spec §9: optional for anyone). Staff keep
    accounts.StaffTwoFactor. Same storage as the staff one: the secret Fernet-encrypted with STAFF_SECRETS_KEY, a
    pending secret until its first code, the last 30-second step used (no code works twice) and HMAC-hashed
    single-use recovery codes."""

    account_type = models.CharField(max_length=20, choices=[("customer", "Customer"), ("business_owner", "Business owner")])
    account_id = models.PositiveIntegerField()
    secret_encrypted = models.TextField(blank=True, default="")
    pending_secret_encrypted = models.TextField(blank=True, default="")
    confirmed_at = models.DateTimeField(null=True, blank=True)
    last_used_step = models.BigIntegerField(default=0)
    recovery_code_hashes = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["account_type", "account_id"], name="otp_one_authenticator_per_account"),
        ]

    def __str__(self):
        return f"Authenticator for {self.account_type} {self.account_id}"
