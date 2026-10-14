import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer, Role
from accounts.testing import make_staff, staff_token
from delivery.models import Rider, RiderDocument
from delivery.services import REQUIRED_DOCUMENTS
from listings.models import Category, Listing, Zone
from orders.models import DeliveryAssignment, Order, OrderItem

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82"
)
PICKUP = (6.7, -1.62)
DROP = (6.69, -1.62)


class DeliveryCase(TestCase):
    """A manager, a rider whose papers are approved, a paid door-to-door order and helpers to call the API."""

    def setUp(self):
        self._private = tempfile.mkdtemp()
        self._override = override_settings(PRIVATE_MEDIA_ROOT=self._private)
        self._override.enable()
        self.addCleanup(self._override.disable)
        self.addCleanup(shutil.rmtree, self._private, ignore_errors=True)
        self.client = APIClient()
        self.manager = make_staff("delivery_manager", "dm@example.com", phone="+233244000001")
        self.rider_staff = make_staff("dispatch", "rider@example.com", manager=self.manager, phone="+233244000002")
        self.rider = Rider.objects.get(staff=self.rider_staff)
        self.other_staff = make_staff("dispatch", "rider2@example.com", manager=self.manager)
        self.owner = BusinessOwner.objects.create(full_name="Kwame Trader", login_phone="+233207882200", password_hash="x")
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200882200", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"),
            name="Kente Cloth", description="D.", contact_phone="+233207882200", price_amount="100.00", status=Listing.PUBLISHED,
            lat=str(PICKUP[0]), lng=str(PICKUP[1]),
        )

    def as_staff(self, staff, **kw):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, **kw)}")
        return self.client

    def approve_papers(self, rider=None, expires=None):
        rider = rider or self.rider
        for kind in REQUIRED_DOCUMENTS:
            RiderDocument.objects.create(
                rider=rider, kind=kind, file=SimpleUploadedFile(f"{kind}.png", PNG, "image/png"), status=RiderDocument.APPROVED,
                expires_on=expires or timezone.localdate() + timedelta(days=200), reviewed_by=self.manager, reviewed_at=timezone.now(),
            )

    def make_order(self, **kw):
        order = Order.objects.create(
            customer=self.customer, status=Order.PAID, total_amount="100.00", delivery_method=Order.DOOR_TO_DOOR,
            delivery_address="12 Ash Road", delivery_phone="+233200882200", delivery_lat=DROP[0], delivery_lng=DROP[1], **kw,
        )
        OrderItem.objects.create(order=order, listing=self.listing, quantity=1, unit_price="100.00", line_total="100.00")
        return order

    def make_shop(self, name, phone, point=None, *, slug="shops"):
        """A business with one published listing (located at `point`, or with no location)."""
        owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x")
        listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug=slug), zone=Zone.objects.get(name="Manhyia"),
            name=f"{name} item", description="D.", contact_phone=phone, price_amount="10.00", status=Listing.PUBLISHED,
            lat=str(point[0]) if point else None, lng=str(point[1]) if point else None,
        )
        return owner, listing

    def multi_order(self, *listings, **kw):
        """A paid door-to-door order with one line per listing, in the order given."""
        order = Order.objects.create(
            customer=self.customer, status=Order.PAID, total_amount="100.00", delivery_method=Order.DOOR_TO_DOOR,
            delivery_address="12 Ash Road", delivery_phone="+233200882200", delivery_lat=DROP[0], delivery_lng=DROP[1], **kw,
        )
        for listing in listings:
            OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price="10.00", line_total="10.00")
        return order

    def assign(self, order=None, rider_staff=None):
        order = order or self.make_order()
        self.as_staff(self.manager)
        response = self.client.post(f"/api/orders/{order.id}/assign-dispatch/", {"dispatch": (rider_staff or self.rider_staff).id}, format="json")
        assert response.status_code == 200, response.content
        return DeliveryAssignment.objects.get(order=order)

    def at(self, point, accuracy=10):
        return {"lat": point[0], "lng": point[1], "accuracy_m": accuracy}

    def step(self, assignment, name, body=None):
        self.as_staff(self.rider_staff)
        return self.client.post(f"/api/delivery/rider/jobs/{assignment.id}/{name}/", body or {}, format="json")

    def run_to(self, assignment, last):
        """Drive a job through the steps up to and including `last`."""
        near_pickup, near_drop = (PICKUP[0] + 0.0001, PICKUP[1]), (DROP[0] + 0.0001, DROP[1])
        plan = [
            ("accept", {}), ("arrive-pickup", self.at(near_pickup)),
            ("pickup", {**self.at(near_pickup), "code": None}), ("arrive-drop", self.at(near_drop)),
            ("deliver", {**self.at(near_drop), "code": None}),
        ]
        for name, body in plan:
            assignment.refresh_from_db()
            if "code" in body:
                body["code"] = assignment.pickup_code if name == "pickup" else assignment.drop_code
            response = self.step(assignment, name, body)
            assert response.status_code == 200, (name, response.content)
            if name == last:
                break
        assignment.refresh_from_db()
        return assignment
