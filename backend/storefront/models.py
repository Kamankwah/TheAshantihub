from django.db import models


class OpeningTime(models.Model):
    """When the marketplace opens to shoppers. Append-only: the latest row (by -created_at, -id) governs, so a
    delay is a new row and the history of who moved it, when and why is kept."""

    opens_at = models.DateTimeField()
    set_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    reason = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"opens {self.opens_at.isoformat()}"


class TestAccount(models.Model):
    """A named customer a Super Admin lets buy before opening (to test the shop). Not a Django test case."""

    __test__ = False

    customer = models.OneToOneField("accounts.Customer", on_delete=models.CASCADE, related_name="+")
    added_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
