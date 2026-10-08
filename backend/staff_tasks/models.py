from django.db import models


class Task(models.Model):
    OPEN = "open"
    DONE = "done"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [(OPEN, "Open"), (DONE, "Done"), (CANCELLED, "Cancelled")]

    owner = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True, default="")
    due_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OPEN)
    done_at = models.DateTimeField(null=True, blank=True)
    source_type = models.CharField(max_length=50, blank=True, default="")
    source_id = models.CharField(max_length=64, blank=True, default="")
    created_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )  # null = created by the system
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["due_at", "id"]
        indexes = [models.Index(fields=["owner", "status", "due_at"])]

    def __str__(self):
        return self.title
