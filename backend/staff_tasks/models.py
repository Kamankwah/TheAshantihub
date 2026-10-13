from django.db import models


class Task(models.Model):
    OPEN = "open"
    DONE = "done"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [(OPEN, "Open"), (DONE, "Done"), (CANCELLED, "Cancelled")]

    SUBSCRIPTION_OVERDUE = "subscription_overdue"
    DELIVERY_PROBLEM = "delivery_problem"
    RETURNED_APPROVAL = "returned_approval"
    CALL_FOLLOW_UP = "call_follow_up"
    PROSPECT_FOLLOW_UP = "prospect_follow_up"
    OPS_FOLLOW_UP = "ops_follow_up"
    MANUAL = "manual"
    # Support desk kinds (Package B creates these; the label map lives in
    # staff_tasks.services.KIND_LABELS).
    SNOOZE_WAKE = "snooze_wake"
    HANDOVER = "handover"
    ESCALATION_FOLLOW_UP = "escalation_follow_up"
    LEAD_ASSIGNED = "lead_assigned"
    KIND_CHOICES = [
        (SUBSCRIPTION_OVERDUE, "Subscription overdue"),
        (DELIVERY_PROBLEM, "Delivery problem"),
        (RETURNED_APPROVAL, "Returned approval"),
        (CALL_FOLLOW_UP, "Call follow-up"),
        (PROSPECT_FOLLOW_UP, "Prospect follow-up"),
        (OPS_FOLLOW_UP, "Follow-up from a lead"),
        (MANUAL, "Added by hand"),
        (SNOOZE_WAKE, "Snoozed conversation wakes"),
        (HANDOVER, "Handed over to you"),
        (ESCALATION_FOLLOW_UP, "Escalation to follow up"),
        (LEAD_ASSIGNED, "Lead assigned to you"),
    ]

    owner = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True, default="")
    due_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OPEN)
    done_at = models.DateTimeField(null=True, blank=True)
    kind = models.CharField(max_length=24, choices=KIND_CHOICES, default=MANUAL)
    # The business this task is about, when there is one (null for a prospect or a plain reminder).
    business_owner = models.ForeignKey(
        "accounts.BusinessOwner", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
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
