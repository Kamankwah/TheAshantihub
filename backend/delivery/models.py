"""The delivery domain (Delivery Manager build). One app owns everything a rider and the Delivery
Manager share: the fleet (riders, vehicles, papers, zones), the live record of a shift and a job's
steps, and (later packages) offers, rules, the rate card and cash. ``orders.DeliveryAssignment`` stays
where it is; it gains the step stamps and codes in ``orders`` and its events live here.

A rider is a ``StaffUser`` with the ``dispatch`` role plus one ``Rider`` row. Nothing here moves money:
the rate card is a configuration and cash handovers are an operational count. A third-party rider's
earnings (``RiderEarning``, ``RiderCommissionPosting``; wallets Plan 5) are records the ledger writes
(``ledger.riders``); AshantiHub's own riders have no payout, payroll or ledger model (owner decision,
Super Admin brief)."""
import datetime

from django.conf import settings
from django.db import models

from accounts.validators import validate_document_content_type, validate_image_content_type

from .storage import private_storage

MOTORBIKE, TRICYCLE, CAR, VAN = "motorbike", "tricycle", "car", "van"
VEHICLE_TYPES = [(MOTORBIKE, "Motorbike"), (TRICYCLE, "Tricycle"), (CAR, "Car"), (VAN, "Van")]


class DeliveryZone(models.Model):
    """A delivery zone with an optional drawn boundary. Separate from ``listings.Zone`` (a bare name
    scouts and listings use) so redrawing a delivery boundary never changes a scout's areas."""

    name = models.CharField(max_length=60, unique=True)
    # GeoJSON-style ring of [lng, lat] points (first point need not repeat), or null until drawn.
    boundary = models.JSONField(null=True, blank=True)
    centre_lat = models.FloatField(null=True, blank=True)
    centre_lng = models.FloatField(null=True, blank=True)
    express_offered = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    updated_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Rider(models.Model):
    """The delivery profile of a Dispatch staff member (one row per rider or driver)."""

    MANUAL, DOCUMENTS = "manual", "documents"
    SUSPENSION_SOURCE_CHOICES = [("", "Not suspended"), (MANUAL, "Suspended by a manager"), (DOCUMENTS, "A required paper expired")]
    ASHANTIHUB, THIRD_PARTY = "ashantihub", "third_party"
    EMPLOYMENT_CHOICES = [(ASHANTIHUB, "AshantiHub's own rider"), (THIRD_PARTY, "Third-party rider (from a rider company)")]

    staff = models.OneToOneField("accounts.StaffUser", on_delete=models.CASCADE, related_name="rider")
    vehicle_type = models.CharField(max_length=10, choices=VEHICLE_TYPES, default=MOTORBIKE)
    vehicle = models.ForeignKey("delivery.Vehicle", null=True, blank=True, on_delete=models.SET_NULL, related_name="current_riders")
    home_zone = models.ForeignKey(DeliveryZone, null=True, blank=True, on_delete=models.SET_NULL, related_name="riders")
    first_shift_date = models.DateField(null=True, blank=True)
    invite_note = models.CharField(max_length=500, blank=True)
    # "Stop new jobs for this rider" (a dispute case decision). Keeps the rider signed in; offers and
    # assignments from the engine skip them; a manager can still assign by hand.
    job_hold = models.BooleanField(default=False)
    job_hold_reason = models.CharField(max_length=300, blank=True)
    suspension_source = models.CharField(max_length=10, choices=SUSPENSION_SOURCE_CHOICES, blank=True, default="")
    # Who the rider works for (spec §1 rows 4-5, §7; wallets Plan 5). Changed only through the delivery.rider_employment
    # approval (delivery.employment). A third-party rider is paid the delivery fee of each order they deliver inside
    # an employment period (RiderEmploymentPeriod), at release, into a wallet (ledger.riders); AshantiHub's own riders have no wallet.
    employment = models.CharField(max_length=12, choices=EMPLOYMENT_CHOICES, default=ASHANTIHUB)
    company_name = models.CharField(max_length=120, blank=True, default="")
    third_party_since = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["staff__full_name"]

    def __str__(self):
        return f"Rider {self.staff.full_name}"


class Vehicle(models.Model):
    RIDER, ASHANTIHUB = "rider", "ashantihub"
    OWNER_CHOICES = [(RIDER, "Rider's own"), (ASHANTIHUB, "AshantiHub's")]
    ACTIVE, RETIRED = "active", "retired"
    STATUS_CHOICES = [(ACTIVE, "In use"), (RETIRED, "Retired")]

    plate = models.CharField(max_length=20, unique=True)
    vehicle_type = models.CharField(max_length=10, choices=VEHICLE_TYPES, default=MOTORBIKE)
    description = models.CharField(max_length=120, blank=True)
    owner_kind = models.CharField(max_length=12, choices=OWNER_CHOICES, default=RIDER)
    registration_expires = models.DateField(null=True, blank=True)
    roadworthy_expires = models.DateField(null=True, blank=True)
    insurance_expires = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["plate"]

    def __str__(self):
        return self.plate


class VehicleHandover(models.Model):
    """Who held a vehicle and when it moved (recorded for every reassignment)."""

    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="handovers")
    from_rider = models.ForeignKey(Rider, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    to_rider = models.ForeignKey(Rider, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=300, blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-at", "-id"]


class RiderDocument(models.Model):
    GHANA_CARD, LICENCE, VEHICLE_REG, ROADWORTHY, INSURANCE, OKADA_LICENCE = (
        "ghana_card", "licence", "vehicle_reg", "roadworthy", "insurance", "okada_licence",
    )
    KIND_CHOICES = [
        (GHANA_CARD, "Ghana Card"), (LICENCE, "Driving licence"), (VEHICLE_REG, "Vehicle registration"),
        (ROADWORTHY, "Roadworthy certificate"), (INSURANCE, "Insurance"), (OKADA_LICENCE, "Commercial (okada) licence"),
    ]
    UPLOADED, APPROVED, REJECTED, EXPIRED = "uploaded", "approved", "rejected", "expired"
    STATUS_CHOICES = [(UPLOADED, "Waiting for a check"), (APPROVED, "Approved"), (REJECTED, "Sent back"), (EXPIRED, "Expired")]

    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="documents")
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    file = models.FileField(upload_to="documents/", storage=private_storage, validators=[validate_document_content_type])
    # The number printed on the paper. Stored as typed; it leaves the server only through
    # ``delivery.serializers.mask_number`` (last four characters), never whole.
    number = models.CharField(max_length=40, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=UPLOADED)
    uploaded_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.CharField(max_length=300, blank=True)
    # Reminder days already sent for this paper (30, 14, 7), so the daily job never repeats one.
    reminders_sent = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]
        indexes = [models.Index(fields=["rider", "kind", "status"])]


# ── Shifts, location and a job's steps ──────────────────────────────────────────────────────────
class ShiftSession(models.Model):
    """A rider's actual time on shift (written by the rider app). At most one is open per rider.
    The last fix is cached here so the live map never scans pings."""

    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="sessions")
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_reason = models.CharField(max_length=20, blank=True)  # rider, manager, signed_out, suspended, idle
    zone = models.ForeignKey(DeliveryZone, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    vehicle = models.ForeignKey(Vehicle, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    on_break = models.BooleanField(default=False)
    break_started_at = models.DateTimeField(null=True, blank=True)
    last_lat = models.FloatField(null=True, blank=True)
    last_lng = models.FloatField(null=True, blank=True)
    last_accuracy_m = models.FloatField(null=True, blank=True)
    last_fix_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        constraints = [
            models.UniqueConstraint(fields=["rider"], condition=models.Q(ended_at__isnull=True), name="one_open_shift_per_rider"),
        ]


class LocationPing(models.Model):
    """One location fix from a rider's phone while the shift screen is open. Kept 48 hours
    (``delivery.tasks.purge_old_pings``) and never written to the activity log."""

    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="pings")
    at = models.DateTimeField(db_index=True)
    lat = models.FloatField()
    lng = models.FloatField()
    accuracy_m = models.FloatField(null=True, blank=True)
    speed_mps = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["-at"]
        indexes = [models.Index(fields=["rider", "-at"])]


class DeliveryEvent(models.Model):
    """One stamped step of a job: when, where, and how far from the stop it was. Append-only."""

    ASSIGNED, ACCEPTED, ARRIVED_PICKUP, PICKED_UP, ARRIVED_DROP, DELIVERED, CANT_DELIVER = (
        "assigned", "accepted", "arrived_pickup", "picked_up", "arrived_drop", "delivered", "cant_deliver",
    )
    COLLECTED_STOP, SKIPPED_STOP = "collected_stop", "skipped_stop"
    STEP_CHOICES = [
        (ASSIGNED, "Assigned"), (ACCEPTED, "Accepted"), (ARRIVED_PICKUP, "Arrived at pickup"), (PICKED_UP, "Picked up"),
        (ARRIVED_DROP, "Arrived at customer"), (DELIVERED, "Delivered"), (CANT_DELIVER, "Can't deliver"),
        (COLLECTED_STOP, "Collected at a shop"), (SKIPPED_STOP, "Shop skipped"),
    ]
    assignment = models.ForeignKey("orders.DeliveryAssignment", on_delete=models.CASCADE, related_name="events")
    stop = models.ForeignKey("delivery.PickupStop", null=True, blank=True, on_delete=models.SET_NULL, related_name="events")
    step = models.CharField(max_length=16, choices=STEP_CHOICES)
    at = models.DateTimeField()
    by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    accuracy_m = models.FloatField(null=True, blank=True)
    # Metres from the stop this step belongs to; null when the stop has no coordinates (not measurable).
    distance_m = models.FloatField(null=True, blank=True)
    flagged = models.BooleanField(default=False)
    note = models.CharField(max_length=300, blank=True)
    # A `skipped_stop` event's refund case. Kept here because the stop's own link is cleared when every shop was skipped
    # and the order is re-dispatched: this one survives, so a skip's case is never mistaken for another kind of case.
    dispute = models.ForeignKey("disputes.Dispute", null=True, blank=True, on_delete=models.SET_NULL, related_name="skip_events")

    class Meta:
        ordering = ["at", "id"]
        indexes = [models.Index(fields=["assignment", "at"])]


class PickupStop(models.Model):
    """One business a delivery collects from (spec 2026-10-14). Made once per assignment in the planned order, which
    never changes after. Each stop has its own four-digit code (the business reads it to the rider) and its own wrong-try
    count; stop 1's are mirrored into DeliveryAssignment.pickup_code / pickup_code_attempts until those are removed.
    lat/lng are a snapshot of where the rider was sent (null when the business had no location)."""

    PENDING, ARRIVED, COLLECTED, SKIPPED = "pending", "arrived", "collected", "skipped"
    STATUS_CHOICES = [(PENDING, "Waiting"), (ARRIVED, "Rider at the shop"), (COLLECTED, "Collected"), (SKIPPED, "Skipped")]
    OPEN = (PENDING, ARRIVED)

    assignment = models.ForeignKey("orders.DeliveryAssignment", on_delete=models.CASCADE, related_name="stops")
    sequence = models.PositiveSmallIntegerField()
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, related_name="pickup_stops")
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    code = models.CharField(max_length=4, blank=True)
    code_attempts = models.PositiveSmallIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    planned_arrival = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    collected_at = models.DateTimeField(null=True, blank=True)
    # The rider on the job when this stop was collected (Plan 7F-E Task 6); cleared with collected_at when the stop reopens.
    collected_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    skip_note = models.CharField(max_length=500, blank=True)
    skipped_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    dispute = models.OneToOneField("disputes.Dispute", null=True, blank=True, on_delete=models.SET_NULL, related_name="pickup_stop")

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(fields=["assignment", "sequence"], name="one_stop_per_sequence"),
            models.UniqueConstraint(fields=["assignment", "business_owner"], name="one_stop_per_business"),
        ]


class DeliveryPhoto(models.Model):
    PICKUP, DROP, EVIDENCE = "pickup", "drop", "evidence"
    KIND_CHOICES = [(PICKUP, "Package at pickup"), (DROP, "At the door"), (EVIDENCE, "Evidence")]

    assignment = models.ForeignKey("orders.DeliveryAssignment", on_delete=models.CASCADE, related_name="photos")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=PICKUP)
    image = models.ImageField(upload_to="photos/", storage=private_storage, validators=[validate_image_content_type])
    uploaded_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["at", "id"]


class DeliveryCall(models.Model):
    """A call placed from a job: the rider to the customer's delivery phone, or the manager to the
    rider. A ``tel:`` link cannot report how long it lasted, so only the start (and the outcome the
    caller reports) is recorded, never an invented duration."""

    RIDER_TO_CUSTOMER, MANAGER_TO_RIDER = "rider_to_customer", "manager_to_rider"
    KIND_CHOICES = [(RIDER_TO_CUSTOMER, "Rider to customer"), (MANAGER_TO_RIDER, "Manager to rider")]
    CONNECTED, NO_ANSWER = "connected", "no_answer"
    OUTCOME_CHOICES = [("", "Not reported"), (CONNECTED, "Connected"), (NO_ANSWER, "No answer")]

    assignment = models.ForeignKey("orders.DeliveryAssignment", on_delete=models.CASCADE, related_name="calls")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    caller = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="delivery_calls")
    started_at = models.DateTimeField(auto_now_add=True)
    outcome = models.CharField(max_length=12, choices=OUTCOME_CHOICES, blank=True, default="")

    class Meta:
        ordering = ["started_at", "id"]


class RiderIssue(models.Model):
    """"Report an issue" from the rider app: accident, vehicle, item, customer, app or other."""

    ACCIDENT, VEHICLE, ITEM, CUSTOMER, APP, OTHER = "accident", "vehicle", "item", "customer", "app", "other"
    KIND_CHOICES = [
        (ACCIDENT, "Accident"), (VEHICLE, "Vehicle problem"), (ITEM, "Item missing or damaged"),
        (CUSTOMER, "Customer problem"), (APP, "App problem"), (OTHER, "Something else"),
    ]
    OPEN, RESOLVED = "open", "resolved"
    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="issues")
    assignment = models.ForeignKey("orders.DeliveryAssignment", null=True, blank=True, on_delete=models.SET_NULL, related_name="issues")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    text = models.TextField(blank=True)
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=[(OPEN, "Open"), (RESOLVED, "Resolved")], default=OPEN)
    resolved_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


# ── Offers, queue holds, rules ──────────────────────────────────────────────────────────────────
class DeliverySettings(models.Model):
    """One row (pk=1): the auto-assign switch. Off until the manager turns it on; every change is logged."""

    auto_assign_on = models.BooleanField(default=False)
    updated_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def get(cls):
        return cls.objects.filter(pk=1).first() or cls(pk=1)


class Offer(models.Model):
    """One offer of a waiting order to one rider (45 seconds by default)."""

    OFFERED, ACCEPTED, DECLINED, EXPIRED, WITHDRAWN = "offered", "accepted", "declined", "expired", "withdrawn"
    STATUS_CHOICES = [(OFFERED, "Offered"), (ACCEPTED, "Accepted"), (DECLINED, "Declined"), (EXPIRED, "Timed out"), (WITHDRAWN, "Withdrawn")]
    AUTO, MANAGER = "auto", "manager"

    order = models.ForeignKey("orders.Order", on_delete=models.CASCADE, related_name="offers")
    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="offers")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OFFERED)
    source = models.CharField(max_length=8, default=AUTO)
    offered_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    offered_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    responded_at = models.DateTimeField(null=True, blank=True)
    decline_reason = models.CharField(max_length=120, blank=True)
    # The score breakdown the engine computed when it chose this rider ([] for a manager's pick).
    score = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-offered_at", "-id"]
        indexes = [models.Index(fields=["status", "expires_at"]), models.Index(fields=["rider", "-offered_at"])]
        constraints = [
            models.UniqueConstraint(fields=["order"], condition=models.Q(status="offered"), name="one_live_offer_per_order"),
        ]


class QueueHold(models.Model):
    """"Schedule": keep an order out of the queue (and the engine) until a time."""

    order = models.OneToOneField("orders.Order", on_delete=models.CASCADE, related_name="queue_hold")
    release_at = models.DateTimeField()
    by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)


class ConfigVersion(models.Model):
    """A versioned setting set. A change is proposed as a new version, approved by Super Admin (or applied
    at once when a Super Admin proposes it), and the previous live version is superseded, never edited."""

    DRAFT, LIVE, SUPERSEDED = "draft", "live", "superseded"
    STATUS_CHOICES = [(DRAFT, "Waiting for approval"), (LIVE, "In force"), (SUPERSEDED, "Replaced")]

    version = models.PositiveIntegerField(unique=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=LIVE)
    proposed_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approval_id = models.PositiveIntegerField(null=True, blank=True)
    note = models.CharField(max_length=300, blank=True)
    effective_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True
        ordering = ["-version"]


class AutoAssignRules(ConfigVersion):
    w_distance = models.PositiveSmallIntegerField(default=50)
    w_fairness = models.PositiveSmallIntegerField(default=30)
    w_idle = models.PositiveSmallIntegerField(default=20)
    offer_timeout_s = models.PositiveSmallIntegerField(default=45)
    max_declines = models.PositiveSmallIntegerField(default=3)
    force_slack_min = models.PositiveSmallIntegerField(default=10)
    radius_km = models.DecimalField(max_digits=5, decimal_places=2, default=5)
    max_active_jobs = models.PositiveSmallIntegerField(default=2)
    stale_s = models.PositiveSmallIntegerField(default=120)
    batch_radius_km = models.DecimalField(max_digits=5, decimal_places=2, default=2)
    cash_cap = models.DecimalField(max_digits=10, decimal_places=2, default=500)

    class Meta(ConfigVersion.Meta):
        constraints = [models.UniqueConstraint(fields=["status"], condition=models.Q(status="live"), name="one_live_auto_assign_rules")]


class TimeLimits(ConfigVersion):
    promise_standard_min = models.PositiveSmallIntegerField(default=90)
    promise_express_min = models.PositiveSmallIntegerField(default=45)
    opens_at = models.TimeField(default=datetime.time(7, 0))
    closes_at = models.TimeField(default=datetime.time(20, 0))
    assign_within_min = models.PositiveSmallIntegerField(default=10)
    pickup_within_min = models.PositiveSmallIntegerField(default=30)
    first_response_hours = models.PositiveSmallIntegerField(default=2)
    dispute_answer_hours = models.PositiveSmallIntegerField(default=24)

    class Meta(ConfigVersion.Meta):
        constraints = [models.UniqueConstraint(fields=["status"], condition=models.Q(status="live"), name="one_live_time_limits")]


class RateCard(ConfigVersion):
    """What a delivery costs the customer and what a rider is owed per job. A configuration only: nothing is
    charged until DELIVERY_FEE_ENABLED is switched on, and no payout is made from it."""

    customer_base = models.DecimalField(max_digits=8, decimal_places=2)
    customer_per_km = models.DecimalField(max_digits=8, decimal_places=2)
    customer_min_fee = models.DecimalField(max_digits=8, decimal_places=2)
    extra_pickup = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    express_multiplier = models.DecimalField(max_digits=4, decimal_places=2, default=1)
    round_up_to = models.DecimalField(max_digits=4, decimal_places=2, default="0.50")
    vehicle_multipliers = models.JSONField(default=dict, blank=True)
    rider_per_job = models.DecimalField(max_digits=8, decimal_places=2)
    rider_per_km = models.DecimalField(max_digits=8, decimal_places=2)
    wait_after_min = models.PositiveSmallIntegerField(default=10)
    wait_per_min = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    # Multi-stop delivery and the cart guard (spec 2026-10-14). Changed through this card's approval like every other
    # value; with no card in force config.CART_LIMIT_DEFAULTS run, named as built-in defaults.
    max_shops_per_delivery = models.PositiveSmallIntegerField(default=4)
    max_food_shops = models.PositiveSmallIntegerField(default=2)
    near_shop_radius_km = models.DecimalField(max_digits=5, decimal_places=2, default="3.00")
    detour_limit_pct = models.PositiveSmallIntegerField(default=40)

    class Meta(ConfigVersion.Meta):
        constraints = [models.UniqueConstraint(fields=["status"], condition=models.Q(status="live"), name="one_live_rate_card")]


class CashHandover(models.Model):
    """Cash a rider hands in, counted by a manager. An operational count, not a ledger."""

    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="handovers")
    expected = models.DecimalField(max_digits=10, decimal_places=2)
    counted = models.DecimalField(max_digits=10, decimal_places=2)
    difference = models.DecimalField(max_digits=10, decimal_places=2)
    counted_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    note = models.CharField(max_length=300, blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-at", "-id"]


class Shift(models.Model):
    """A planned shift on the weekly rota (the rider's actual time is a ``ShiftSession``)."""

    DRAFT, PUBLISHED, OPEN, SWAP = "draft", "published", "open", "swap"
    STATUS_CHOICES = [(DRAFT, "Draft"), (PUBLISHED, "Published"), (OPEN, "Open (no rider yet)"), (SWAP, "Swap asked")]

    rider = models.ForeignKey(Rider, null=True, blank=True, on_delete=models.CASCADE, related_name="shifts")
    zone = models.ForeignKey(DeliveryZone, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=DRAFT)
    published_at = models.DateTimeField(null=True, blank=True)
    swap_with = models.ForeignKey(Rider, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["starts_at", "id"]
        indexes = [models.Index(fields=["starts_at"])]


class RiderEmploymentPeriod(models.Model):
    """One stretch during which a rider was a third-party rider (opened when the delivery.rider_employment approval makes
    them one, closed when it switches them back; `ended_at` null while it runs). Who a delivery's money belongs to is
    decided from these periods by the delivery's time, never from the rider's current flag, so a later switch back (or
    forward again) cannot re-label history: payroll still leaves out the days a rider was third-party and the wallet
    still pays them. `Rider.third_party_since` is the start of the open period."""

    rider = models.ForeignKey(Rider, on_delete=models.CASCADE, related_name="employment_periods")
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["started_at"]
        indexes = [models.Index(fields=["rider", "started_at"])]
        constraints = [models.UniqueConstraint(fields=["rider"], condition=models.Q(ended_at__isnull=True), name="one_open_employment_period")]

    def __str__(self):
        return f"{self.rider_id}: {self.started_at:%Y-%m-%d} to {self.ended_at or 'now'}"


# ── Third-party riders' money (wallets Plan 5; written by ledger.riders) ────────────────────────
class RiderCommissionPosting(models.Model):
    """One end-of-day posting of a third-party rider's commission reserve to AshantiHub (spec §2.2 step 6): the deliveries
    of `day` (Accra) it covered and their gross, commission and net, in pesewas. `journal` is null when the commission
    was 0 (a 0% rate). Never edited. A day normally has one row per rider; a delivery credited after that day's run gets a
    row of its own."""

    rider = models.ForeignKey(Rider, on_delete=models.PROTECT, related_name="commission_postings")
    day = models.DateField()
    deliveries = models.PositiveIntegerField()
    gross_pesewas = models.BigIntegerField()
    commission_pesewas = models.BigIntegerField()
    net_pesewas = models.BigIntegerField()
    journal = models.OneToOneField(
        "ledger.Journal", null=True, blank=True, on_delete=models.PROTECT, related_name="rider_commission_posting",
    )
    posted_at = models.DateTimeField()

    class Meta:
        ordering = ["-day", "-id"]
        indexes = [models.Index(fields=["rider", "-day"]), models.Index(fields=["day"])]


class RiderEarning(models.Model):
    """What a third-party rider earned for one order (spec §2.2 step 2(c), §7): the delivery fee AshantiHub took at the
    order's release or, for a whole refund after a pickup, at that refund (`gross_pesewas`: the fee the customer paid plus
    a fee the business covered with its free-delivery promo), split at `commission_bp` (the rate in force when the order was paid) into `reserve_pesewas`, held until the
    end of `earned_on` (Accra), and `net_pesewas`, withdrawable at once. Written in the release's transaction (journal
    order-rider-<order>) or the refund's; afterwards only the end-of-day posting (`commission_posting`) is written to it.
    `reversed_at` and `reversal_journal` are unused historical columns, always null: the delivery fee belongs to the rider
    once a pickup is done, so no refund ever takes it back (Plan 7F-D)."""

    order = models.OneToOneField("orders.Order", on_delete=models.PROTECT, related_name="rider_earning")
    rider = models.ForeignKey(Rider, on_delete=models.PROTECT, related_name="earnings")
    gross_pesewas = models.BigIntegerField()
    commission_bp = models.PositiveIntegerField()
    reserve_pesewas = models.BigIntegerField()
    net_pesewas = models.BigIntegerField()
    earned_at = models.DateTimeField()
    earned_on = models.DateField()
    journal = models.OneToOneField("ledger.Journal", on_delete=models.PROTECT, related_name="rider_earning")
    commission_posting = models.ForeignKey(
        RiderCommissionPosting, null=True, blank=True, on_delete=models.PROTECT, related_name="earnings",
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_journal = models.OneToOneField(
        "ledger.Journal", null=True, blank=True, on_delete=models.PROTECT, related_name="rider_earning_reversal",
    )

    class Meta:
        ordering = ["-earned_at", "-id"]
        indexes = [models.Index(fields=["rider", "earned_on"]), models.Index(fields=["earned_on", "commission_posting"])]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(gross_pesewas__gt=0, reserve_pesewas__gte=0, net_pesewas__gte=0),
                name="delivery_rider_earning_amounts",
            ),
            models.CheckConstraint(
                condition=models.Q(gross_pesewas=models.F("reserve_pesewas") + models.F("net_pesewas")),
                name="delivery_rider_earning_adds_up",
            ),
        ]


# ── Re-delivery at the customer's request (Plan 7F-E Task 7, owner Rulings R4/R5; rules in delivery.redelivery) ─────
class Redelivery(models.Model):
    """The customer was not at the address when the first rider completed the trip (the assignment failed `no_answer`
    after `arrived_drop_at`), the goods came back, and Support or the Pickup Desk asked, at the customer's request, for
    the order to be delivered again. The customer pays `fee_pesewas` (the governed `redelivery_fee_pesewas` copied here
    when it was asked for) before the second trip can be assigned; that money waits in the order's Re-delivery payable
    and becomes platform delivery income when the second trip's rider completes it (`rider`, `completed_at`: what
    AshantiHub owes that in-house rider, paid outside the app). The first rider (`first_rider`, whose leg ended at
    `first_leg_ended_at`) keeps the order's original delivery fee (ledger.riders.fee_rider). Integer pesewas only."""

    AWAITING_PAYMENT, PAID, ASSIGNED, COMPLETED, CANCELLED, REFUNDED = (
        "awaiting_payment", "paid", "assigned", "completed", "cancelled", "refunded",
    )
    STATUS_CHOICES = [
        (AWAITING_PAYMENT, "Waiting for the customer to pay"), (PAID, "Paid, waiting for a rider"),
        (ASSIGNED, "Given to a rider"), (COMPLETED, "Second trip done"), (CANCELLED, "Cancelled"),
        (REFUNDED, "Cancelled, fee returned to the wallet"),
    ]
    OPEN_STATUSES = (AWAITING_PAYMENT, PAID, ASSIGNED)

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="redeliveries")
    attempt = models.PositiveSmallIntegerField()
    first_rider = models.ForeignKey("accounts.StaffUser", null=True, on_delete=models.PROTECT, related_name="+")
    first_leg_ended_at = models.DateTimeField()
    fee_pesewas = models.BigIntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=AWAITING_PAYMENT)
    requested_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="+")
    reason = models.TextField()
    checkout_session = models.ForeignKey(
        "payments.CheckoutSession", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    rider = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    pay_journal = models.ForeignKey("ledger.Journal", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    settle_journal = models.ForeignKey("ledger.Journal", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    refund_journal = models.ForeignKey("ledger.Journal", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["order", "attempt"], name="delivery_redelivery_attempt_unique"),
            models.UniqueConstraint(
                fields=["order"], condition=models.Q(status__in=("awaiting_payment", "paid", "assigned")),
                name="delivery_one_open_redelivery_per_order",
            ),
            models.CheckConstraint(condition=models.Q(fee_pesewas__gte=0), name="delivery_redelivery_fee_not_negative"),
        ]

    def __str__(self):
        return f"Re-delivery {self.attempt} of order #{self.order_id} ({self.status})"
