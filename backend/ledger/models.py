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


class FeeRuleSet(models.Model):
    """One version of a category's platform-fee tiers. Rows are never edited: the rule set in force
    is the latest whose `effective_from` has passed (the approvals engine creates new ones)."""

    PRODUCT, SERVICE, EVENT = "product", "service", "event"
    CATEGORY_CHOICES = [(PRODUCT, "Products"), (SERVICE, "Services"), (EVENT, "Events")]

    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES)
    effective_from = models.DateTimeField()
    created_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    approval_id = models.PositiveBigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_from", "-id"]
        indexes = [models.Index(fields=["category", "-effective_from"])]

    def __str__(self):
        return f"{self.category} fees from {self.effective_from:%Y-%m-%d %H:%M}"


class FeeBand(models.Model):
    """One tier of a rule set: amounts from `lower_pesewas` to `upper_pesewas` inclusive (None = no upper
    limit) cost `percent_bp` basis points (100 = 1%) or a flat `flat_pesewas`."""

    rule_set = models.ForeignKey(FeeRuleSet, on_delete=models.CASCADE, related_name="bands")
    lower_pesewas = models.BigIntegerField()
    upper_pesewas = models.BigIntegerField(null=True, blank=True)
    percent_bp = models.PositiveIntegerField(null=True, blank=True)
    flat_pesewas = models.BigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["lower_pesewas"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(percent_bp__isnull=False, flat_pesewas__isnull=True)
                    | models.Q(percent_bp__isnull=True, flat_pesewas__isnull=False)
                ),
                name="ledger_band_percent_xor_flat",
            ),
        ]


class OrderFeeSnapshot(models.Model):
    """The fee fixed for one vendor and fee category of one order at payment time. Release reads this,
    so later rule or cap edits never change an order already paid. `reversed_at` frees the cap again
    (refunds, Stage 3)."""

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="fee_snapshots")
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, related_name="fee_snapshots")
    category = models.CharField(max_length=10, choices=FeeRuleSet.CATEGORY_CHOICES)
    rule_set = models.ForeignKey(FeeRuleSet, on_delete=models.PROTECT, related_name="+")
    base_pesewas = models.BigIntegerField()
    computed_pesewas = models.BigIntegerField()
    charged_pesewas = models.BigIntegerField()
    cap_pesewas = models.BigIntegerField(null=True, blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    # What refunds have taken back so far (ledger.refunds; cumulative, pesewas): release pays only base and fee not
    # yet refunded, and the refunded fee no longer counts against the lifetime cap. `reversed_at` is set once the
    # whole base is refunded.
    refunded_base_pesewas = models.BigIntegerField(default=0)
    refunded_fee_pesewas = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "business_owner", "category"], name="ledger_one_snapshot_per_order_vendor_category")]
        indexes = [models.Index(fields=["business_owner", "reversed_at"])]


class MoneySetting(models.Model):
    """One approved value of a money setting from `effective_from` on. Never edited: the value in force
    is the latest row whose time has come. `value=None` is a deliberate blank (for the fee cap, no cap)."""

    key = models.CharField(max_length=50)
    value = models.BigIntegerField(null=True, blank=True)
    effective_from = models.DateTimeField()
    created_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    approval_id = models.PositiveBigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_from", "-id"]
        indexes = [models.Index(fields=["key", "-effective_from"])]

    def __str__(self):
        return f"{self.key}={self.value}"


class FulfilmentCheck(models.Model):
    """What happened to a product order after it was handed over: collected at the AshantiHub office (store pickup),
    the customer's receipt confirmed by phone, and Support's verification call. The vendor's money is released only
    on a positive outcome."""

    MATCHES, DOES_NOT_MATCH, UNREACHABLE = "matches", "does_not_match", "unreachable"
    OUTCOME_CHOICES = [
        ("", "Not verified yet"), (MATCHES, "Matches the description"), (DOES_NOT_MATCH, "Does not match"),
        (UNREACHABLE, "Could not reach the customer"),
    ]

    order = models.OneToOneField("orders.Order", on_delete=models.PROTECT, related_name="fulfilment_check")
    collected_at = models.DateTimeField(null=True, blank=True)
    collected_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    phone_confirmed_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=14, choices=OUTCOME_CHOICES, blank=True, default="")
    outcome_note = models.CharField(max_length=500, blank=True, default="")
    outcome_at = models.DateTimeField(null=True, blank=True)
    outcome_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    dispute = models.ForeignKey("disputes.Dispute", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Order {self.order_id}: {self.outcome or 'awaiting verification'}"


class OrderRefund(models.Model):
    """Money given back to a customer for a paid order, always into their AshantiHub wallet (ledger.refunds). One row
    per (order, source): the source names what asked for it ("cancel", "pickup_expired", "dispute-<id>"), so the same
    request can never refund twice. Pesewas: `amount_pesewas` is order money returned to the customer (items_pesewas +
    delivery_pesewas − subsidy_pesewas); `processing_pesewas` is a collection charge AshantiHub gave back on its own or
    a vendor's error. `allocation` lists what each fee snapshot gave. `journal` is null only when nothing had to move."""

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="refunds")
    source = models.CharField(max_length=60)
    whole = models.BooleanField(default=False)
    amount_pesewas = models.BigIntegerField()
    items_pesewas = models.BigIntegerField(default=0)
    delivery_pesewas = models.BigIntegerField(default=0)
    subsidy_pesewas = models.BigIntegerField(default=0)
    processing_pesewas = models.BigIntegerField(default=0)
    allocation = models.JSONField(default=list, blank=True)
    journal = models.OneToOneField(Journal, null=True, blank=True, on_delete=models.PROTECT, related_name="refund")
    created_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [models.UniqueConstraint(fields=["order", "source"], name="ledger_one_refund_per_order_and_source")]

    def __str__(self):
        return f"Refund {self.source} on order {self.order_id}"
