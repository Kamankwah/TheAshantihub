from django.db import models

from accounts.models import StaffUser


class ContactMessage(models.Model):
    """A public/anonymous submission from the Contact page's contact form.

    Deliberately no `author` FK (unlike reviews.Review.author) — anyone can
    submit this, signed in or not, so name/email/phone are freeform text
    fields rather than a link to an account. Staff triage it via the
    `status` field (new -> read -> resolved), gated by the
    `contact_messages.manage` permission (see
    accounts/migrations/0013_seed_contact_messages_manage_permission.py).
    """

    GENERAL = "general"
    SUPPORT = "support"
    ACCOUNT = "account"
    SALES = "sales"
    CATEGORY_CHOICES = [
        (GENERAL, "General"),
        (SUPPORT, "Support"),
        (ACCOUNT, "Account"),
        (SALES, "Sales"),
    ]

    NEW = "new"
    READ = "read"
    RESOLVED = "resolved"
    STATUS_CHOICES = [
        (NEW, "New"),
        (READ, "Read"),
        (RESOLVED, "Resolved"),
    ]

    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES)
    name = models.CharField(max_length=150)
    email = models.EmailField()
    phone = models.CharField(max_length=30, blank=True)
    subject = models.CharField(max_length=200)
    message = models.TextField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=NEW)
    resolved_by = models.ForeignKey(
        StaffUser, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="resolved_contact_messages",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    # Handed to the Operations lead as a follow-up Task (there is no leads model).
    passed_to_operations_at = models.DateTimeField(null=True, blank=True)
    passed_by = models.ForeignKey(
        StaffUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_category_display()} message from {self.name} ({self.status})"


class ContactReply(models.Model):
    """An email reply a staffer sent to a contact-form sender. The sender has no
    account or chat thread, so email is the only answer path; `email_sent`
    records whether the mail backend accepted it (never a delivery claim)."""

    message = models.ForeignKey(ContactMessage, on_delete=models.CASCADE, related_name="replies")
    staff = models.ForeignKey(StaffUser, null=True, on_delete=models.SET_NULL, related_name="+")
    body = models.TextField()
    email_sent = models.BooleanField(default=False)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sent_at", "id"]
