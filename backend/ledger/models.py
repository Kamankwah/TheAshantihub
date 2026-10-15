"""The ledger: accounts, and journals of balanced lines that are never edited.

A balance lives on `Account.net_credit` (credits minus debits) as a cache that only
`ledger.posting.post` changes, in the same transaction that writes the journal lines."""
from django.db import models


class Account(models.Model):
    CUSTOMER_WALLET = "customer_wallet"
    VENDOR_PENDING = "vendor_pending"
    VENDOR_AVAILABLE = "vendor_available"
    DELIVERY_PAYABLE = "delivery_payable"
    RIDER_BALANCE = "rider_balance"
    RIDER_RESERVE = "rider_reserve"
    PLATFORM_FEE_INCOME = "platform_fee_income"
    PLATFORM_DELIVERY_INCOME = "platform_delivery_income"
    PLATFORM_COMMISSION_INCOME = "platform_commission_income"
    PLATFORM_PROMO_SUBSIDY = "platform_promo_subsidy"
    PROVIDER_CLEARING = "provider_clearing"
    PROVIDER_FEES = "provider_fees"
    WITHDRAWAL_IN_TRANSIT = "withdrawal_in_transit"
    KIND_CHOICES = [
        (CUSTOMER_WALLET, "Customer wallet"),
        (VENDOR_PENDING, "Vendor pending"),
        (VENDOR_AVAILABLE, "Vendor available"),
        (DELIVERY_PAYABLE, "Delivery payable"),
        (RIDER_BALANCE, "Rider balance"),
        (RIDER_RESERVE, "Rider commission reserve"),
        (PLATFORM_FEE_INCOME, "Platform fee income"),
        (PLATFORM_DELIVERY_INCOME, "Platform delivery income"),
        (PLATFORM_COMMISSION_INCOME, "Platform commission income"),
        (PLATFORM_PROMO_SUBSIDY, "Platform promotion subsidy"),
        (PROVIDER_CLEARING, "Provider clearing"),
        (PROVIDER_FEES, "Provider fees"),
        (WITHDRAWAL_IN_TRANSIT, "Withdrawal in transit"),
    ]
    # Asset and expense accounts grow with debits; everything else grows with credits.
    DEBIT_NORMAL = frozenset({PROVIDER_CLEARING, PLATFORM_PROMO_SUBSIDY, PROVIDER_FEES})
    # A late refund may drive a vendor's available balance below zero (recovered from later sales).
    MAY_GO_NEGATIVE = frozenset({VENDOR_AVAILABLE})

    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    owner_type = models.CharField(max_length=40, blank=True, default="")
    owner_id = models.CharField(max_length=40, blank=True, default="")
    net_credit = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["kind", "owner_type", "owner_id"], name="ledger_one_account_per_kind_and_owner")]

    @property
    def balance(self):
        """The balance on the account's normal side, in pesewas."""
        return -self.net_credit if self.kind in self.DEBIT_NORMAL else self.net_credit

    def __str__(self):
        owner = f" {self.owner_type}:{self.owner_id}" if self.owner_id else ""
        return f"{self.kind}{owner}"


class _AppendOnly(models.Model):
    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk is not None and not self._state.adding:
            raise RuntimeError(f"{type(self).__name__} rows are append-only")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError(f"{type(self).__name__} rows are append-only")


class Journal(_AppendOnly):
    key = models.CharField(max_length=120, unique=True)
    kind = models.CharField(max_length=40)
    reference_type = models.CharField(max_length=50, blank=True, default="")
    reference_id = models.CharField(max_length=64, blank=True, default="")
    memo = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["reference_type", "reference_id"])]

    def __str__(self):
        return f"{self.kind} {self.key}"


class JournalLine(_AppendOnly):
    DEBIT = "debit"
    CREDIT = "credit"
    SIDE_CHOICES = [(DEBIT, "Debit"), (CREDIT, "Credit")]

    journal = models.ForeignKey(Journal, on_delete=models.PROTECT, related_name="lines")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="lines")
    side = models.CharField(max_length=6, choices=SIDE_CHOICES)
    amount = models.BigIntegerField()

    class Meta:
        ordering = ["id"]
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name="ledger_line_amount_positive")]
