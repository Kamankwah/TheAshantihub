"""Payout destinations, withdrawals and reconciliation runs (spec §8, §2.2 step 5, §2). Account numbers are stored
unmasked, like the business payout details, and only ever leave the server through accounts.serializers.mask_but_last."""
from django.db import models


class PayoutDestination(models.Model):
    """A MoMo number or bank account a customer or business owner may withdraw to. Accepted only when the name the
    network or bank returns matches the holder's verified name and the holder confirmed it with a step-up code; it can
    receive money from `usable_from` (the cooling period). Never edited: a change is a removal plus a new one."""

    MOMO, BANK = "momo", "bank"
    RAIL_CHOICES = [(MOMO, "Mobile money"), (BANK, "Bank account")]

    holder_type = models.CharField(max_length=20)            # "customer", "business_owner" or "staff" (a third-party rider; otp.identity.ref)
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


def _withdrawal_reference():
    from django.utils.crypto import get_random_string

    return f"AH-WD-{get_random_string(10).upper()}"


class Withdrawal(models.Model):
    """Money leaving a holder's balance for one of their payout destinations (spec §2.2 step 5). The amount is held in
    withdrawal in transit at once (journal withdrawal-hold-<reference>), sent to the provider, then settled
    (withdrawal-paid-<reference>: in transit to provider clearing) or returned (withdrawal-reversed-<reference>). The
    holder bears the provider's charge: `net_pesewas` = `amount_pesewas` − `charge_pesewas` reaches the destination. A
    final status never changes (wallets.payouts.apply_result)."""

    PENDING, PROCESSING, SUCCEEDED, FAILED, CANCELLED = "pending", "processing", "succeeded", "failed", "cancelled"
    STATUS_CHOICES = [
        (PENDING, "Held, not sent yet"), (PROCESSING, "Sent, waiting for the provider"), (SUCCEEDED, "Paid"),
        (FAILED, "Failed, money returned"), (CANCELLED, "Cancelled, money returned"),
    ]
    OPEN = (PENDING, PROCESSING)
    FINAL = (SUCCEEDED, FAILED, CANCELLED)
    COUNTED = (PENDING, PROCESSING, SUCCEEDED)  # what counts against the daily limit

    reference = models.CharField(max_length=20, unique=True, default=_withdrawal_reference)
    holder_type = models.CharField(max_length=20)            # "customer", "business_owner" or "staff" (a third-party rider; otp.identity.ref)
    holder_id = models.PositiveBigIntegerField()
    source_kind = models.CharField(max_length=32)            # the ledger account it came from: customer_wallet, vendor_available or rider_balance
    destination = models.ForeignKey(PayoutDestination, on_delete=models.PROTECT, related_name="withdrawals")
    request_id = models.CharField(max_length=64)             # the client's idempotency key, unique per holder
    amount_pesewas = models.BigIntegerField()
    charge_pesewas = models.BigIntegerField(default=0)
    net_pesewas = models.BigIntegerField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    provider = models.CharField(max_length=20)
    provider_reference = models.CharField(max_length=128, blank=True, default="")
    failure_reason = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    settled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["holder_type", "holder_id", "created_at"]),
            models.Index(fields=["status", "submitted_at"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["holder_type", "holder_id", "request_id"], name="wallets_one_withdrawal_per_request"),
            models.CheckConstraint(condition=models.Q(net_pesewas__gt=0, charge_pesewas__gte=0), name="wallets_withdrawal_amounts_positive"),
            models.CheckConstraint(
                condition=models.Q(amount_pesewas=models.F("net_pesewas") + models.F("charge_pesewas")),
                name="wallets_withdrawal_amount_is_net_plus_charge",
            ),
        ]

    def __str__(self):
        return f"Withdrawal {self.reference}"


class ReconciliationRun(models.Model):
    """One night's comparison of the ledger with the provider's statement for `day` (wallets.reconciliation). A report
    only: it never changes a balance. Re-running a day replaces its row. The totals cover the movements compared: the
    statement lines the ledger was asked to record, what the ledger booked for them (whatever day), and the day's
    provider-clearing journals no statement holds; so a matched day shows equal totals."""

    MATCHED, MISMATCHED, UNAVAILABLE = "matched", "mismatched", "unavailable"
    STATUS_CHOICES = [(MATCHED, "Matches"), (MISMATCHED, "Differences found"), (UNAVAILABLE, "No statement from the provider")]

    day = models.DateField(unique=True)
    provider = models.CharField(max_length=20)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES)
    ledger_in_pesewas = models.BigIntegerField(default=0)
    statement_in_pesewas = models.BigIntegerField(default=0)
    ledger_out_pesewas = models.BigIntegerField(default=0)
    statement_out_pesewas = models.BigIntegerField(default=0)
    in_transit_pesewas = models.BigIntegerField(default=0)  # a snapshot at run time, not as of `day`
    unavailable = models.JSONField(default=list, blank=True)  # provider checks it could not make: statement, find, pending_payouts
    differences = models.JSONField(default=list, blank=True)
    flag = models.ForeignKey("fraud.FraudFlag", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    ran_at = models.DateTimeField()

    class Meta:
        ordering = ["-day"]

    def __str__(self):
        return f"Reconciliation {self.day}: {self.status}"


class VendorText(models.Model):
    """A text to a business about its money (spec §6; vendor plan 4): one per paid order and business, one per release
    and business, one daily digest. Queued in the transaction that moved the money (so it exists only if that committed),
    sent after commit through otp.senders and retried by wallets.tasks.send_due_vendor_texts. Holds no customer's name,
    phone or address and never the business's whole number (`to_hint` is masked). `notification` is the in-app copy,
    kept even when the text could not be sent."""

    ORDER_PAID, ORDER_RELEASED, DAILY_DIGEST = "order_paid", "order_released", "daily_digest"
    REFUND, WITHDRAWAL, BALANCE_NEGATIVE, BALANCE_LOW = "refund", "withdrawal", "balance_negative", "balance_low"
    KIND_CHOICES = [
        (ORDER_PAID, "Order paid"), (ORDER_RELEASED, "Order released"), (DAILY_DIGEST, "Daily digest"), (REFUND, "Refund"),
        (WITHDRAWAL, "Withdrawal"), (BALANCE_NEGATIVE, "Balance below zero"), (BALANCE_LOW, "Balance low"),
    ]
    QUEUED, SENT, FAILED, NO_PHONE = "queued", "sent", "failed", "no_phone"
    STATUS_CHOICES = [(QUEUED, "Waiting to send"), (SENT, "Sent"), (FAILED, "Could not be sent"), (NO_PHONE, "No number to text")]

    key = models.CharField(max_length=80, unique=True)       # paid-<order>-<owner>, released-<order>-<owner>, digest-<owner>-<day>
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.CASCADE, related_name="vendor_texts")
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    day = models.DateField(null=True, blank=True)
    body = models.CharField(max_length=320)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=QUEUED)
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    provider = models.CharField(max_length=20, blank=True, default="")
    provider_ref = models.CharField(max_length=64, blank=True, default="")
    to_hint = models.CharField(max_length=20, blank=True, default="")   # "020 *** 0001": never the whole number
    notification = models.ForeignKey("notifications.Notification", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"]),
            models.Index(fields=["business_owner", "created_at"]),
            models.Index(fields=["status", "sent_at"]),
        ]

    def __str__(self):
        return f"{self.kind} text to business {self.business_owner_id}: {self.status}"


class VendorPreference(models.Model):
    """What a business chose about its money texts. Order and release texts always go (spec §6: "SMS on every paid
    order"); the daily digest is optional and off until the business turns it on."""

    business_owner = models.OneToOneField("accounts.BusinessOwner", on_delete=models.CASCADE, related_name="vendor_preference")
    daily_digest = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Texts for business {self.business_owner_id}: digest {'on' if self.daily_digest else 'off'}"
