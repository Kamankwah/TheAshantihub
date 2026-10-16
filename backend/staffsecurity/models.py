from django.db import models
from django.utils import timezone

from accounts.models import StaffUser


class StaffSignInRecord(models.Model):
    """One line of the sign-in history (Super Admin 11). Written by the login,
    2-step, logout, password re-entry and session-timeout paths from the day this
    shipped on; nothing older exists. Append-only in practice: no endpoint edits
    or removes a line. A password is never stored, and a failed attempt keeps
    only a masked form of what was typed, whether or not an account matched."""

    SIGNED_IN = "signed_in"
    SIGNED_OUT = "signed_out"
    TIMED_OUT = "timed_out"
    SIGN_IN_FAILED = "sign_in_failed"
    TWO_STEP_FAILED = "two_step_failed"
    PASSWORD_REENTERED = "password_reentered"
    PASSWORD_REENTRY_FAILED = "password_reentry_failed"
    KIND_CHOICES = [
        (SIGNED_IN, "Signed in"),
        (SIGNED_OUT, "Signed out"),
        (TIMED_OUT, "Timed out"),
        (SIGN_IN_FAILED, "Sign-in refused"),
        (TWO_STEP_FAILED, "2-step code wrong"),
        (PASSWORD_REENTERED, "Password re-entered"),
        (PASSWORD_REENTRY_FAILED, "Password re-entry failed"),
    ]

    at = models.DateTimeField(default=timezone.now, db_index=True)
    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    # Set when the attempt matched an account (the person is known to Super Admin
    # only); blank for an address nobody holds. The sign-in response itself
    # never differs between the two.
    staff = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    identifier_masked = models.CharField(max_length=120, blank=True, default="")
    two_factor = models.BooleanField(default=False)
    note = models.CharField(max_length=200, blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    device_label = models.CharField(max_length=120, blank=True, default="")
    # Repeated failures from the same masked identifier and address within a few
    # minutes are one line with a count (signin.COALESCE_WINDOW); `at` is the latest.
    attempts = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["kind", "-at"]), models.Index(fields=["staff", "-at"])]

    def __str__(self):
        return f"{self.at:%Y-%m-%d %H:%M} {self.kind}"


class SecurityPolicy(models.Model):
    """The one row of security settings Super Admin can change. A Super Admin
    always needs 2-step sign-in whatever is stored here."""

    two_factor_roles = models.JSONField(default=list, blank=True)
    # One-time codes (otp app, spec §9): a customer's trusted device skips the sign-in code for this many days after
    # their last code, and everyone holding security.manage hears once a day when OTP texts reach the alert count.
    # Defaults and limits: staffsecurity.policy.OTP_DEFAULTS / OTP_LIMITS.
    otp_customer_gap_days = models.PositiveSmallIntegerField(default=30)
    otp_sms_daily_alert = models.PositiveIntegerField(default=500)
    updated_at = models.DateTimeField(null=True, blank=True)
    updated_by = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    def __str__(self):
        return "Security policy"
