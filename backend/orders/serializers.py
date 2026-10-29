import re

from django.utils import timezone
from rest_framework import serializers

from disputes.models import Dispute

from .models import DeliveryAssignment, Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    listing_name = serializers.CharField(source="listing.name", read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "listing", "listing_name", "variant", "variant_label", "quantity", "unit_price", "line_total"]


DELIVERY_FIELDS = [
    "delivery_method", "delivery_address", "delivery_phone", "delivery_lat", "delivery_lng",
]
# A business owner gets the customer's name and address but never their phone:
# AshantiHub's delivery team runs door-to-door fulfilment, and a phone number
# would open the direct business-to-customer channel the platform forbids.
OWNER_DELIVERY_FIELDS = [f for f in DELIVERY_FIELDS if f != "delivery_phone"]

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# Seven or more digits with spaces, dashes, dots, plus signs or brackets between them: a phone number in any common
# format ("+233 24 123 4567", "024-123-4567", "0241234567"). Four-digit codes, times and short numbers stay.
_LONG_NUMBER = re.compile(r"[+(]*\d(?:[\s().+-]*\d){6,}")


def scrub_for_shop(text):
    """Free text written by staff (a rider's note) as a shop may see it: no email address and no phone-length number.
    Businesses must never get a contact detail through AshantiHub; the manager's copy keeps the note as written."""
    return _LONG_NUMBER.sub("[number removed]", _EMAIL.sub("[email removed]", text or ""))


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    # The courier assignment's status (item 11), so the customer's order card
    # can show progress and reveal the "confirm receipt" button once it's
    # been delivered. SerializerMethodField, not a nested serializer, to avoid
    # a circular reference (DeliveryAssignmentSerializer is defined below) and
    # because the customer only needs the status string, not the courier's id.
    delivery_assignment_status = serializers.SerializerMethodField()
    # The four-digit code the customer reads to the rider at the door. Shown only while a rider holds
    # the job and has not yet delivered it; it is the customer's, never the business's or a manager's.
    delivery_code = serializers.SerializerMethodField()
    # For a delivery from several shops: how many there are and how many are done (counts only, never a shop's
    # name, place or code); null for one shop or no rider yet.
    delivery_stops = serializers.SerializerMethodField()
    # A store-pickup order's one-time six-digit code the customer reads to the pickup desk, and the time to collect it by;
    # null unless the code applies. This serializer is used only for the customer's own orders (list, detail, checkout):
    # no owner, staff or queue serializer carries either field.
    collection_code = serializers.SerializerMethodField()
    collect_by = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id", "status", "delivery_status", "total_amount", "placed_at", "items",
            "delivery_assignment_status", "delivery_code", "delivery_stops", "collection_code", "collect_by", "delivery_fee", "ready_not_before", *DELIVERY_FIELDS,
        ]

    def get_delivery_assignment_status(self, obj):
        assignment = getattr(obj, "delivery_assignment", None)
        return assignment.status if assignment else None

    def get_delivery_code(self, obj):
        assignment = getattr(obj, "delivery_assignment", None)
        if assignment is None or assignment.status not in DeliveryAssignment.ACTIVE_STATUSES:
            return None
        return assignment.drop_code or None

    def _collection_code(self, obj):
        """Worked out once per order, however many fields read it."""
        from ledger import verification

        if not hasattr(obj, "_collection_code_value"):
            obj._collection_code_value = verification.collection_code(obj)
        return obj._collection_code_value

    def get_collection_code(self, obj):
        return self._collection_code(obj)

    def get_collect_by(self, obj):
        from ledger import verification

        if self._collection_code(obj) is None:
            return None
        if not hasattr(self, "_pickup_window"):  # one read for the whole list: the child serializer is shared by every order
            self._pickup_window = verification._pickup_window(timezone.now())
        return verification.collect_by(obj, timezone.now(), self._pickup_window)

    def get_delivery_stops(self, obj):
        """How many shops the rider collects from and how many are done, for a delivery from several shops (counts only)."""
        from delivery import stops

        assignment = getattr(obj, "delivery_assignment", None)
        if assignment is None:
            return None
        p = stops.progress(assignment)
        return {"total": p["total"], "done": p["done"], "skipped": p["skipped"]} if p["total"] > 1 else None

    def to_representation(self, obj):
        data = super().to_representation(obj)
        # Only an order that used a coupon carries these, so every other response is unchanged.
        if obj.coupon_id:
            data["discount_amount"] = str(obj.discount_amount)
            data["coupon_code"] = obj.coupon.code
        # An open re-delivery at the customer's request (Plan 7F-E Task 7): the fee to pay and the state, so the order
        # card can offer the payment. Only such an order carries it (no staff names, no reason).
        from delivery import redelivery

        if obj.delivery_method == Order.DOOR_TO_DOOR:
            prefetched = getattr(obj, "open_redeliveries", None)      # orders.views._open_redeliveries
            open_request = (prefetched[0] if prefetched else None) if prefetched is not None else redelivery.open_row(obj)
            if open_request is not None:
                data["redelivery"] = redelivery.customer_row(open_request)
        return data


class StaffOrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "customer", "customer_name", "status", "delivery_status",
            "total_amount", "placed_at", "items", *DELIVERY_FIELDS,
        ]


class OwnerOrderSerializer(serializers.ModelSerializer):
    """A business owner's view of an order that contains their listings (Wave
    F). Exposes ONLY the caller's own line items (a shared order may span
    multiple businesses) and an owner_subtotal over just those lines — not the
    order's full total, which would include other businesses' items. Carries
    the delivery info the owner needs to fulfil or hand off — name and
    address only, never the customer's phone (see OWNER_DELIVERY_FIELDS).

    Delivery fields describe this owner's own stop only (a delivery may collect from several shops): its code, its
    status, when the rider should arrive, and what the rider reported at this shop. Never another shop's stop, code or
    report, and never the rider's name, phone or position. Every field reads the delivery's SAVED stops, so a job made
    before multi-stop delivery keeps its one stop at its first item's business.
    """

    items = serializers.SerializerMethodField()
    owner_subtotal = serializers.SerializerMethodField()
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    # The four-digit code the rider asks this business for at the counter: this owner's own stop's code, while that stop
    # is still open (pending or the rider is there) and the delivery is still collecting. Never another shop's.
    pickup_code = serializers.SerializerMethodField()
    # True while this owner's own stop is the stop being worked and this is the job the rider is on (same gate as the
    # owner tracking endpoint). Tells the owner nothing the tracking endpoint would not.
    rider_heading_here = serializers.SerializerMethodField()
    # When the rider should reach this owner's stop ("rider arrives about HH:MM"), while it is still pending.
    pickup_eta = serializers.SerializerMethodField()
    # True when that time has already passed and the rider has not arrived: the rider is running late, so a screen must
    # not show pickup_eta as an upcoming arrival.
    pickup_eta_late = serializers.SerializerMethodField()
    # This owner's stop status (pending/arrived/collected/skipped), or null when the owner has no stop.
    pickup_status = serializers.SerializerMethodField()
    # {"at", "text"} when the rider skipped this owner's stop at the shop; else null.
    rider_report = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id", "customer_name", "status", "delivery_status", "placed_at",
            "items", "owner_subtotal", "pickup_code", "rider_heading_here", "pickup_eta", "pickup_eta_late", "pickup_status",
            "rider_report",
            *OWNER_DELIVERY_FIELDS,
        ]

    def _stop(self, obj):
        """(assignment or None, this owner's saved stop or None). Read once per order: every delivery field asks."""
        from delivery import stops

        cache = self.__dict__.setdefault("_stops", {})
        if obj.pk not in cache:
            assignment = getattr(obj, "delivery_assignment", None)
            cache[obj.pk] = (assignment, stops.stop_for_owner(assignment, self.context["owner"].id) if assignment is not None else None)
        return cache[obj.pk]

    def _own_stop(self, obj):
        """(assignment, this owner's stop) while the delivery is still collecting; else (assignment or None, None)."""
        assignment, stop = self._stop(obj)
        if assignment is None or assignment.status not in (DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED, DeliveryAssignment.AT_PICKUP):
            return assignment, None
        return assignment, stop

    def _rider_job_id(self, dispatch):
        """The pk of the job the rider is on now, asked once per rider per page."""
        from delivery import services

        jobs = self.__dict__.setdefault("_rider_jobs", {})
        if dispatch.pk not in jobs:
            job = services.current_job(dispatch)
            jobs[dispatch.pk] = job.pk if job is not None else None
        return jobs[dispatch.pk]

    def get_pickup_code(self, obj):
        from delivery.models import PickupStop

        _, stop = self._own_stop(obj)
        return (stop.code or None) if stop is not None and stop.status in PickupStop.OPEN else None

    def get_rider_heading_here(self, obj):
        # Only while this shop is the stop being worked and this is the job the rider is on; a rider at another shop
        # or finishing another delivery is not heading here, and the vendor must not be shown their position.
        from delivery import stops
        from delivery.models import PickupStop

        assignment, stop = self._own_stop(obj)
        if stop is None or stop.status not in PickupStop.OPEN or assignment.dispatch_id is None:
            return False
        current = stops.current_stop(assignment)
        if current is None or current.business_owner_id != stop.business_owner_id:
            return False
        return self._rider_job_id(assignment.dispatch) == assignment.pk

    def get_pickup_eta(self, obj):
        from delivery.models import PickupStop

        _, stop = self._own_stop(obj)
        return stop.planned_arrival if stop is not None and stop.status == PickupStop.PENDING else None

    def get_pickup_eta_late(self, obj):
        from delivery import stops

        _, stop = self._own_stop(obj)
        return stop is not None and stops.arrival_late(stop)

    def get_pickup_status(self, obj):
        _, stop = self._stop(obj)
        return stop.status if stop is not None else None

    def get_rider_report(self, obj):
        """What the rider reported at THIS shop when it could not hand over: the time and their note, and nothing about the
        rider (no name, phone or position). Only this owner's own stop, only while it is skipped, and only when the skip
        that left it skipped was the rider's, made at the shop (a skip measured far from the shop, or not measured, goes
        to the manager, not here; a manager's skip is not a report; a stop reopened for a new rider shows no old report).
        The note is scrubbed of phone numbers and emails (scrub_for_shop); the manager sees it as written."""
        from django.utils import timezone

        from delivery import stops
        from delivery.models import PickupStop

        assignment, stop = self._stop(obj)
        if assignment is None or stop is None or stop.pk is None or stop.status != PickupStop.SKIPPED:
            return None
        mine = [h for h in stops.skip_history(assignment) if h["stop_id"] == stop.pk]
        last = mine[-1] if mine else None  # the skip that left this stop skipped now
        if last is None or last["by"] != "rider" or not last["at_shop"]:
            return None
        return {"at": last["at"], "text": f"Rider reported at your shop at {timezone.localtime(last['at']).strftime('%H:%M')}: {scrub_for_shop(last['note'])}"}

    def _own_items(self, obj):
        owner = self.context["owner"]
        return [i for i in obj.items.all() if i.listing.business_owner_id == owner.id]

    def get_items(self, obj):
        return OrderItemSerializer(self._own_items(obj), many=True).data

    def get_owner_subtotal(self, obj):
        return str(sum((i.line_total for i in self._own_items(obj)), 0))


class OrderDeliveryStatusUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = ["delivery_status"]


class OrderDisputeCreateSerializer(serializers.Serializer):
    """Input shape for POST /api/orders/{id}/dispute/ — shape validation
    only, same convention as ReviewSubmitSerializer/ContactMessageSubmitSerializer.
    The view creates the disputes.Dispute row directly (order/raised_by/
    status aren't caller-supplied)."""

    reason = serializers.ChoiceField(choices=Dispute.REASON_CHOICES)
    description = serializers.CharField()


class DeliveryAssignmentSerializer(serializers.ModelSerializer):
    dispatch_name = serializers.CharField(source="dispatch.full_name", read_only=True, default=None)

    class Meta:
        model = DeliveryAssignment
        fields = [
            "id", "dispatch", "dispatch_name", "status", "notes",
            "assigned_at", "picked_up_at", "delivered_at", "confirmed_at",
        ]
        read_only_fields = fields


class DeliveryOrderSerializer(serializers.ModelSerializer):
    """The Delivery Manager's view of a paid door-to-door order (item 11):
    what was bought, the customer's delivery details, and the current
    assignment (if any). The Delivery Manager assigns a dispatch to unassigned
    ones.
    """

    items = OrderItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    delivery_assignment = DeliveryAssignmentSerializer(read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "customer_name", "status", "delivery_status", "placed_at",
            "items", "total_amount", "delivery_assignment", "ready_not_before", *DELIVERY_FIELDS,
        ]
        read_only_fields = fields


class DispatchDeliverySerializer(serializers.ModelSerializer):
    """A Dispatch's view of their assigned delivery (item 11) — the order's
    items plus BOTH the business pickup location(s) and the customer's delivery
    location/phone, which is what a courier needs to run the job.
    """

    order_id = serializers.IntegerField(source="order.id", read_only=True)
    customer_name = serializers.CharField(source="order.customer.full_name", read_only=True)
    delivery_address = serializers.CharField(source="order.delivery_address", read_only=True)
    delivery_phone = serializers.CharField(source="order.delivery_phone", read_only=True)
    delivery_lat = serializers.FloatField(source="order.delivery_lat", read_only=True, default=None)
    delivery_lng = serializers.FloatField(source="order.delivery_lng", read_only=True, default=None)
    pickups = serializers.SerializerMethodField()

    class Meta:
        model = DeliveryAssignment
        fields = [
            "id", "order_id", "status", "customer_name",
            "delivery_address", "delivery_phone", "delivery_lat", "delivery_lng",
            "pickups", "assigned_at", "picked_up_at", "delivered_at", "confirmed_at",
        ]
        read_only_fields = fields

    def get_pickups(self, obj):
        """One pickup point per distinct business in the order — the courier
        collects each business's items from its location.
        """
        seen = {}
        for item in obj.order.items.all():
            owner = item.listing.business_owner
            if owner.id not in seen:
                seen[owner.id] = {
                    "business_name": owner.full_name,
                    "phone": item.listing.contact_phone,
                    "lat": float(item.listing.lat) if item.listing.lat is not None else None,
                    "lng": float(item.listing.lng) if item.listing.lng is not None else None,
                    "items": [],
                }
            seen[owner.id]["items"].append(f"{item.listing.name} × {item.quantity}")
        return list(seen.values())
