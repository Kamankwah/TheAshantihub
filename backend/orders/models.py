from django.db import models

from accounts.models import Customer, StaffUser
from listings.models import Listing


class Order(models.Model):
    PENDING = "pending"
    PAID = "paid"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (PAID, "Paid"),
        (CANCELLED, "Cancelled"),
    ]

    PROCESSING = "processing"
    SHIPPED = "shipped"
    OUT_FOR_DELIVERY = "out_for_delivery"
    DELIVERED = "delivered"
    DELIVERY_STATUS_CHOICES = [
        (PROCESSING, "Processing"),
        (SHIPPED, "Shipped"),
        (OUT_FOR_DELIVERY, "Out for Delivery"),
        (DELIVERED, "Delivered"),
    ]

    # How the customer wants the order fulfilled, chosen at checkout (Wave F,
    # the fulfilment spine item 11's Delivery Manager is built around).
    # store_pickup is the default and needs no address; door_to_door requires
    # a delivery address + phone (enforced in OrderCheckoutView).
    DOOR_TO_DOOR = "door_to_door"
    STORE_PICKUP = "store_pickup"
    DELIVERY_METHOD_CHOICES = [
        (DOOR_TO_DOOR, "Door-to-door delivery"),
        (STORE_PICKUP, "Store pickup"),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="orders")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    delivery_status = models.CharField(
        max_length=20, choices=DELIVERY_STATUS_CHOICES, default=PROCESSING
    )
    delivery_method = models.CharField(
        max_length=20, choices=DELIVERY_METHOD_CHOICES, default=STORE_PICKUP
    )
    # Only meaningful for door_to_door. A free-text address (customer addresses
    # are free text platform-wide), a contact phone for the delivery, and
    # optional coordinates. lat/lng are optional because a free-text address
    # can't be geocoded reliably — item 11's dispatch map falls back to a
    # manual pin/address when they're absent (there is no geocoding service).
    delivery_address = models.CharField(max_length=500, blank=True)
    delivery_phone = models.CharField(max_length=20, blank=True)
    # Ghana Post digital address (normalised, e.g. AK-039-5028) and a landmark for the rider; blank on store pickup and
    # on orders placed before they were asked for.
    delivery_gps_address = models.CharField(max_length=20, blank=True)
    delivery_landmark = models.CharField(max_length=200, blank=True)
    delivery_lat = models.FloatField(null=True, blank=True)
    delivery_lng = models.FloatField(null=True, blank=True)
    # total_amount is NET: what the customer pays after any coupon. discount_amount is the
    # coupon discount already taken off (AshantiHub pays it, never the seller); it is 0 and
    # coupon is empty on every order placed while checkout promotions are off.
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    coupon = models.ForeignKey("marketing.Coupon", on_delete=models.PROTECT, null=True, blank=True, related_name="orders")
    placed_at = models.DateTimeField(auto_now_add=True)
    # Delivery fee, fixed at checkout from the rate card in force (delivery.RateCard) and only when
    # settings.DELIVERY_FEE_ENABLED is on (default off): null means no fee was charged.
    delivery_fee = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    delivery_fee_breakdown = models.JSONField(null=True, blank=True)
    rate_card = models.ForeignKey("delivery.RateCard", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    # The pickup route planned at checkout (delivery.stops.plan_for_lines): businesses in collection order, road km and the
    # detour against the limit in force. Null for store pickup and for orders placed before multi-stop delivery.
    route_plan = models.JSONField(null=True, blank=True)
    # Set at checkout when a vendor was closed: the latest next opening among the order's vendors (accounts.hours.next_open).
    # Null means ready now. Fixed on the order, so a vendor editing their hours later never moves it. Delivery is not
    # dispatched before this time, and the store-pickup window and the delivery promise clock both start from it.
    ready_not_before = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-placed_at"]

    def __str__(self):
        return f"Order {self.id} — {self.customer.full_name} ({self.status})"


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    # PROTECT: an order line is a historical record of what was bought — a
    # listing referenced by a past order should not be hard-deletable out
    # from under that history. (Nothing in the codebase currently hard-deletes
    # a Listing anyway; moderation/removal is done via `status`.)
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT, related_name="order_items")
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    # Set when unit_price is a flash-sale price (the sellers pay for that discount).
    flash_sale = models.ForeignKey("marketing.FlashSale", on_delete=models.PROTECT, null=True, blank=True, related_name="order_items")
    # The variant bought and its label at checkout (the label stays even if the variant is later renamed or switched off).
    variant = models.ForeignKey("listings.ListingVariant", on_delete=models.PROTECT, null=True, blank=True, related_name="order_items")
    variant_label = models.CharField(max_length=100, blank=True)

    @property
    def line_name(self):
        """What to pack or check: the listing name, plus the variant bought."""
        if self.variant_label:
            return f"{self.listing.name} ({self.variant_label})"
        return self.listing.name

    def __str__(self):
        return f"{self.quantity} x {self.listing.name} (Order {self.order_id})"


class DeliveryAssignment(models.Model):
    """A door-to-door order's courier assignment (punch-list item 11). The
    Delivery Manager (delivery.manage) assigns a Dispatch to a paid
    door-to-door order; the Dispatch (delivery.dispatch) confirms pickup at the
    business and delivery to the customer; the customer confirms receipt.

    OneToOne with Order — one delivery per order. Only ever created for a paid
    door-to-door order (store-pickup orders are collected, not delivered). Its
    status stays loosely in sync with Order.delivery_status so the customer's
    existing delivery stepper reflects the courier's progress.
    """

    ASSIGNED = "assigned"
    ACCEPTED = "accepted"  # the rider took the job (heading to the pickup)
    AT_PICKUP = "at_pickup"  # arrived at the business
    PICKED_UP = "picked_up"
    AT_CUSTOMER = "at_customer"  # arrived at the customer
    DELIVERED = "delivered"
    CONFIRMED = "confirmed"  # customer confirmed receipt
    FAILED = "failed"  # the rider could not deliver (a dispute is opened)
    STATUS_CHOICES = [
        (ASSIGNED, "Assigned"),
        (ACCEPTED, "Accepted"),
        (AT_PICKUP, "Arrived at pickup"),
        (PICKED_UP, "Picked up"),
        (AT_CUSTOMER, "Arrived at customer"),
        (DELIVERED, "Delivered"),
        (CONFIRMED, "Confirmed by customer"),
        (FAILED, "Could not deliver"),
    ]
    # In flight: assigned to a rider, not yet delivered or failed.
    ACTIVE_STATUSES = (ASSIGNED, ACCEPTED, AT_PICKUP, PICKED_UP, AT_CUSTOMER)
    # How the rider came to hold the job.
    MANUAL, AUTO, FORCED, OFFER = "manual", "auto", "forced", "offer"
    MODE_CHOICES = [(MANUAL, "Chosen by a manager"), (AUTO, "Auto-assigned"), (FORCED, "Force-assigned"), (OFFER, "Offered and accepted")]
    # A manager's decision on a location flag (a tap far from the stop).
    FLAG_CLEARED, FLAG_UPHELD = "cleared", "upheld"
    FLAG_CHOICES = [("", "Undecided"), (FLAG_CLEARED, "Cleared"), (FLAG_UPHELD, "Upheld")]

    order = models.OneToOneField(
        Order, on_delete=models.CASCADE, related_name="delivery_assignment"
    )
    dispatch = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="dispatch_deliveries",
    )
    assigned_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="deliveries_assigned",
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=ASSIGNED)
    notes = models.TextField(blank=True)

    assigned_at = models.DateTimeField(auto_now_add=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)
    # The rider on the job when the pickup was made (Plan 7F-E Task 6). A re-assignment clears both: the first rider's
    # pickup ends with their leg and counts for no one (ledger.riders.pickup_made); it stays in the DeliveryEvent history.
    picked_up_by = models.ForeignKey(StaffUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    delivered_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    # Lifecycle stamps (Delivery Manager build). The where-and-how-far of each is a
    # ``delivery.DeliveryEvent``; these are the times the list screens sort and filter on.
    accepted_at = models.DateTimeField(null=True, blank=True)
    arrived_pickup_at = models.DateTimeField(null=True, blank=True)
    arrived_drop_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    failed_reason = models.CharField(max_length=30, blank=True)
    failed_note = models.CharField(max_length=500, blank=True)
    # Null until a time limit applies (``delivery.TimeLimits``); no deadline is ever made up.
    deadline_at = models.DateTimeField(null=True, blank=True)
    assignment_mode = models.CharField(max_length=10, choices=MODE_CHOICES, default=MANUAL)
    vehicle = models.ForeignKey("delivery.Vehicle", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    # Four-digit codes made when the job is assigned: the business reads the pickup code to the
    # rider, the customer reads the drop code. Wrong tries are counted and capped.
    pickup_code = models.CharField(max_length=4, blank=True)
    drop_code = models.CharField(max_length=4, blank=True)
    pickup_code_attempts = models.PositiveSmallIntegerField(default=0)
    drop_code_attempts = models.PositiveSmallIntegerField(default=0)
    flag_decision = models.CharField(max_length=8, choices=FLAG_CHOICES, blank=True, default="")
    flag_decided_by = models.ForeignKey(StaffUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    flag_decided_at = models.DateTimeField(null=True, blank=True)
    flag_note = models.CharField(max_length=300, blank=True)
    # Waiting pay held back while a flag is looked at. A hold only; there is no pay record yet.
    wait_pay_held = models.BooleanField(default=False)
    rider_note = models.CharField(max_length=500, blank=True)
    # What the rider is owed for this job, worked out from the rate card in force when it was delivered
    # (a record of the sum, not a payment). Null when no rate card was in force.
    rider_pay = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    rider_pay_breakdown = models.JSONField(null=True, blank=True)
    # Cash on delivery is not offered at checkout yet; these stay empty until it is.
    cod_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    cash_collected_at = models.DateTimeField(null=True, blank=True)
    # The plan the stops were made from (the order's route_plan plus owner_ids and stop_ids); fixed once written.
    route_plan = models.JSONField(null=True, blank=True)

    def sync_order(self):
        """Keep Order.delivery_status in step with the courier's progress so the customer's delivery
        stepper reflects reality. A failed delivery leaves the order where it was."""
        mapping = {
            self.ASSIGNED: Order.PROCESSING, self.ACCEPTED: Order.PROCESSING, self.AT_PICKUP: Order.PROCESSING,
            self.PICKED_UP: Order.OUT_FOR_DELIVERY, self.AT_CUSTOMER: Order.OUT_FOR_DELIVERY,
            self.DELIVERED: Order.DELIVERED, self.CONFIRMED: Order.DELIVERED,
        }
        new_status = mapping.get(self.status)
        order = self.order
        if new_status and order.delivery_status != new_status:
            order.delivery_status = new_status
            order.save(update_fields=["delivery_status"])

    def __str__(self):
        return f"Delivery for Order {self.order_id} → dispatch {self.dispatch_id} ({self.status})"


class OrderSupportNote(models.Model):
    """What AshantiHub Support did to an order on the Order status screen:
    marked it running late (with the new expected time as typed text) or
    cancelled it at the customer's request. Append-only; it never changes
    delivery_status, so Support cannot mark an order Delivered through it."""

    RUNNING_LATE = "running_late"
    CANCELLED_BY_CUSTOMER = "cancelled_by_customer"
    KIND_CHOICES = [
        (RUNNING_LATE, "Running late"),
        (CANCELLED_BY_CUSTOMER, "Cancelled by customer"),
    ]

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="support_notes")
    staff = models.ForeignKey(StaffUser, null=True, on_delete=models.SET_NULL, related_name="+")
    kind = models.CharField(max_length=24, choices=KIND_CHOICES)
    reason = models.TextField()
    # Free text ("about 12:15"): nothing here computes or promises a time.
    expected_time = models.CharField(max_length=80, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
