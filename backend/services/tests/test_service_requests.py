from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, Zone
from services.models import ServiceRequest


class ServiceRequestTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Services", login_phone="+233207884400", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Services", login_phone="+233207884499", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Yaa Buyer", phone="+233200884400", password_hash="x",
        )
        # A service category/listing (kind=service).
        self.category = Category.objects.filter(kind="service").first() or Category.objects.create(
            slug="cleaning", label="Cleaning", kind="service",
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=Zone.objects.get(name="Manhyia"),
            name="Home Cleaning", description="A clean.", contact_phone="+233207884400",
            price_amount="200.00", status=Listing.PUBLISHED,
        )

    def _auth(self, account, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")

    def _open_request(self):
        self._auth(self.customer, "customer")
        return self.client.post(
            "/api/services/requests/",
            {"listing": self.listing.id, "message": "Please clean my 3-bed house", "budget": "150.00"},
            format="json",
        )


class ServiceRequestLifecycleTests(ServiceRequestTestsBase):
    def test_customer_opens_a_request(self):
        response = self._open_request()
        self.assertEqual(response.status_code, 201, response.content)
        sr = ServiceRequest.objects.get()
        self.assertEqual(sr.status, ServiceRequest.REQUESTED)
        self.assertEqual(sr.business_owner, self.owner)

    def test_cannot_request_a_product_listing(self):
        product_cat = Category.objects.filter(kind="product").first()
        product = Listing.objects.create(
            business_owner=self.owner, category=product_cat, zone=Zone.objects.get(name="Manhyia"),
            name="A Product", description="D.", contact_phone="+233207884400",
            price_amount="10.00", status=Listing.PUBLISHED,
        )
        self._auth(self.customer, "customer")
        response = self.client.post(
            "/api/services/requests/", {"listing": product.id, "message": "hi"}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_owner_accepts_with_a_price_then_customer_pays_then_owner_completes(self):
        self._open_request()
        sr = ServiceRequest.objects.get()

        # Owner accepts with a quote.
        self._auth(self.owner, "business_owner")
        accept = self.client.post(
            f"/api/services/requests/{sr.id}/respond/", {"action": "accept", "price": "180.00"}, format="json",
        )
        self.assertEqual(accept.status_code, 200, accept.content)
        sr.refresh_from_db()
        self.assertEqual(sr.status, ServiceRequest.ACCEPTED)
        self.assertEqual(str(sr.agreed_price), "180.00")

        # Customer pays → in_progress (simulated payment finalizes synchronously).
        self._auth(self.customer, "customer")
        pay = self.client.post(f"/api/services/requests/{sr.id}/pay/")
        self.assertEqual(pay.status_code, 200, pay.content)
        sr.refresh_from_db()
        self.assertEqual(sr.status, ServiceRequest.IN_PROGRESS)
        self.assertIsNotNone(sr.paid_at)

        # Owner updates progress, then completes.
        self._auth(self.owner, "business_owner")
        prog = self.client.post(f"/api/services/requests/{sr.id}/progress/", {"note": "Halfway done"}, format="json")
        self.assertEqual(prog.status_code, 200, prog.content)
        complete = self.client.post(f"/api/services/requests/{sr.id}/complete/")
        self.assertEqual(complete.status_code, 200, complete.content)
        sr.refresh_from_db()
        self.assertEqual(sr.status, ServiceRequest.COMPLETED)
        self.assertEqual(sr.progress_note, "Halfway done")

    def test_owner_declines_with_a_reason(self):
        self._open_request()
        sr = ServiceRequest.objects.get()
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            f"/api/services/requests/{sr.id}/respond/", {"action": "decline", "reason": "Fully booked"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        sr.refresh_from_db()
        self.assertEqual(sr.status, ServiceRequest.DECLINED)
        self.assertEqual(sr.decline_reason, "Fully booked")

    def test_accept_requires_a_price(self):
        self._open_request()
        sr = ServiceRequest.objects.get()
        self._auth(self.owner, "business_owner")
        response = self.client.post(f"/api/services/requests/{sr.id}/respond/", {"action": "accept"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_cannot_pay_before_acceptance(self):
        self._open_request()
        sr = ServiceRequest.objects.get()
        self._auth(self.customer, "customer")
        response = self.client.post(f"/api/services/requests/{sr.id}/pay/")
        self.assertEqual(response.status_code, 400)

    def test_cannot_complete_before_payment(self):
        self._open_request()
        sr = ServiceRequest.objects.get()
        self._auth(self.owner, "business_owner")
        self.client.post(f"/api/services/requests/{sr.id}/respond/", {"action": "accept", "price": "180.00"}, format="json")
        response = self.client.post(f"/api/services/requests/{sr.id}/complete/")
        self.assertEqual(response.status_code, 400)


class ServiceRequestScopingTests(ServiceRequestTestsBase):
    def test_owner_sees_only_their_incoming(self):
        self._open_request()
        self._auth(self.other_owner, "business_owner")
        self.assertEqual(len(self.client.get("/api/services/requests/incoming/").json()), 0)
        self._auth(self.owner, "business_owner")
        self.assertEqual(len(self.client.get("/api/services/requests/incoming/").json()), 1)

    def test_customer_sees_only_their_own(self):
        self._open_request()
        stranger = Customer.objects.create(full_name="Kojo", phone="+233200884499", password_hash="x")
        self._auth(stranger, "customer")
        self.assertEqual(len(self.client.get("/api/services/requests/mine/").json()), 0)

    def test_another_owner_cannot_respond(self):
        self._open_request()
        sr = ServiceRequest.objects.get()
        self._auth(self.other_owner, "business_owner")
        response = self.client.post(
            f"/api/services/requests/{sr.id}/respond/", {"action": "accept", "price": "1.00"}, format="json",
        )
        self.assertEqual(response.status_code, 404)
