"""Payout destinations, withdrawals and reconciliation runs (spec §8, §2.2 step 5, §2). Account numbers are stored
unmasked, like the business payout details, and only ever leave the server through accounts.serializers.mask_but_last."""
from django.db import models


class PayoutDestination(models.Model):
    """A MoMo number or bank account a customer or business owner may withdraw to. Accepted only when the name the
    network or bank returns matches the holder's verified name and the holder confirmed it with a step-up code; it can
    receive money from `usable_from` (the cooling period). Never edited: a change is a removal plus a new one."""

    MOMO, BANK = "momo", "bank"
    RAIL_CHOICES = [(MOMO, "Mobile money"), (BANK, "Bank account")]

    holder_type = models.CharField(max_length=20)            # "customer" or "business_owner" (otp.identity.ref)
    holder_id = models.PositiveBigIntegerField()
    rail = models.CharField(max_length=4, choices=RAIL_CHOICES)
    institution = models.CharField(max_length=60)            # the MoMo network or the bank
    account_number = models.CharField(max_length=30)         # unmasked; shown only through mask_but_last
    account_name = models.CharField(max_length=150)          # what the network or bank answered
    matched_name = models.CharField(max_length=150)          # the verified name it matched
    name_source = models.CharField(max_length=20)            # the provider that answered ("simulated" says so)
    usable_from = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    removed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["holder_type", "holder_id", "removed_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["holder_type", "holder_id", "rail", "account_number"], condition=models.Q(removed_at__isnull=True),
                name="wallets_one_live_destination_per_account",
            ),
        ]

    def __str__(self):
        return f"{self.get_rail_display()} ({self.institution}) of {self.holder_type} {self.holder_id}"  # never the number
