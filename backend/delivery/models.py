"""The delivery domain (Delivery Manager build). One app owns everything a rider and the Delivery
Manager share: the fleet (riders, vehicles, papers, zones), the live record of a shift and a job's
steps, and (later packages) offers, rules, the rate card and cash. ``orders.DeliveryAssignment`` stays
where it is; it gains the step stamps and codes in ``orders`` and its events live here.

A rider is a ``StaffUser`` with the ``dispatch`` role plus one ``Rider`` row. Nothing here moves money:
the rate card is a configuration, cash handovers are an operational count, and there is no payout,
payroll or ledger model (owner decision, Super Admin brief)."""
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
    STEP_CHOICES = [
        (ASSIGNED, "Assigned"), (ACCEPTED, "Accepted"), (ARRIVED_PICKUP, "Arrived at pickup"), (PICKED_UP, "Picked up"),
        (ARRIVED_DROP, "Arrived at customer"), (DELIVERED, "Delivered"), (CANT_DELIVER, "Can't deliver"),
    ]
    assignment = models.ForeignKey("orders.DeliveryAssignment", on_delete=models.CASCADE, related_name="events")
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

    class Meta:
        ordering = ["at", "id"]
        indexes = [models.Index(fields=["assignment", "at"])]


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
