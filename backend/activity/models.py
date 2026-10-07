from django.db import models


class ActivityEvent(models.Model):
    """One staff (or system) action. Append-only: Postgres triggers refuse
    UPDATE and DELETE (migration 0002), and each row carries the SHA-256 of
    the previous row's hash plus its own canonical JSON (activity.services)."""

    STAFF = "staff"
    CUSTOMER = "customer"
    BUSINESS_OWNER = "business_owner"
    SYSTEM = "system"
    ACTOR_TYPE_CHOICES = [
        (STAFF, "Staff"),
        (CUSTOMER, "Customer"),
        (BUSINESS_OWNER, "Business owner"),
        (SYSTEM, "System"),
    ]

    id = models.BigAutoField(primary_key=True)
    occurred_at = models.DateTimeField()
    actor_type = models.CharField(max_length=20, choices=ACTOR_TYPE_CHOICES)
    actor_id = models.PositiveBigIntegerField(null=True, blank=True)
    actor_role = models.CharField(max_length=20, blank=True, default="")
    actor_label = models.CharField(max_length=150, blank=True, default="")
    on_behalf_of_id = models.PositiveBigIntegerField(null=True, blank=True)
    verb = models.CharField(max_length=100)
    method = models.CharField(max_length=8, blank=True, default="")
    target_type = models.CharField(max_length=50, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")
    target_label = models.CharField(max_length=200, blank=True, default="")
    summary = models.CharField(max_length=300, blank=True, default="")
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    request_id = models.CharField(max_length=64, blank=True, default="")
    prev_hash = models.CharField(max_length=64)
    hash = models.CharField(max_length=64, unique=True)

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["actor_type", "actor_id", "-occurred_at"]),
            models.Index(fields=["actor_role", "-occurred_at"]),
            models.Index(fields=["verb"]),
            models.Index(fields=["target_type", "target_id"]),
        ]

    def __str__(self):
        return f"#{self.id} {self.actor_label} {self.verb}"
