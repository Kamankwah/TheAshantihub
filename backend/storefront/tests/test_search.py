from datetime import timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from events.models import Event, EventTicketType
from listings.models import Category, Listing, Zone

URL = "/api/storefront/search/"
ROW_KEYS = {"id", "kind", "name", "price", "photo", "category_label"}


class SearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = BusinessOwner.objects.create(full_name="Search Owner", login_phone="+233207552001", password_hash="x")
        self.dept = Category.objects.create(slug="zz-dept", label="ZZ Department", icon="x", color="#000", kind=Category.PRODUCT)
        self.sub = Category.objects.create(slug="zz-sub", label="ZZ Sub", icon="x", color="#000", kind=Category.PRODUCT, parent=self.dept)
        self.other = Category.objects.create(slug="zz-other", label="ZZ Other", icon="x", color="#000", kind=Category.PRODUCT)
        self.svc = Category.objects.create(slug="zz-svc", label="ZZ Service", icon="x", color="#000", kind=Category.SERVICE)
        self.stay = Category.objects.create(slug="zz-stay", label="ZZ Stay", icon="x", color="#000", kind=Category.SERVICE, is_accommodation=True)
        self.evc = Category.objects.create(slug="zz-ev", label="ZZ Event", icon="x", color="#000", kind=Category.EVENT)

    def listing(self, category, name, **extra):
        fields = dict(business_owner=self.owner, category=category, zone=self.zone, name=name, description="D.",
                      contact_phone="+233207552999", price_amount="25.00", status=Listing.PUBLISHED)
        fields.update(extra)
        return Listing.objects.create(**fields)

    def event(self, name, **extra):
        now = timezone.now()
        fields = dict(category=self.evc, zone=self.zone, submitted_by_business=self.owner, name=name, description="D.",
                      address="Bantama", event_date=now + timedelta(days=20), visibility_days=14, status=Event.APPROVED,
                      paid_at=now, expires_at=now + timedelta(days=14))
        fields.update(extra)
        return Event.objects.create(**fields)

    def search(self, query):
        response = self.client.get(URL + query)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_finds_each_of_the_four_kinds_by_name(self):
        self.listing(self.sub, "Zorbo blender")
        self.listing(self.svc, "Zorbo plumbing")
        self.listing(self.stay, "Zorbo lodge")
        self.event("Zorbo festival")
        body = self.search("?q=zorbo")
        self.assertEqual([r["name"] for r in body["products"]], ["Zorbo blender"])
        self.assertEqual([r["name"] for r in body["services"]], ["Zorbo plumbing"])
        self.assertEqual([r["name"] for r in body["stays"]], ["Zorbo lodge"])
        self.assertEqual([r["name"] for r in body["events"]], ["Zorbo festival"])
        self.assertEqual(body["products"][0]["kind"], "product")
        self.assertEqual(body["products"][0]["price"], "25.00")
        self.assertEqual(body["products"][0]["category_label"], "ZZ Sub")

    def test_category_picker_limits_to_department_and_children(self):
        self.listing(self.dept, "Quux direct")
        self.listing(self.sub, "Quux child")
        self.listing(self.other, "Quux elsewhere")
        by_slug = self.search("?q=quux&category=zz-dept")
        self.assertEqual({r["name"] for r in by_slug["products"]}, {"Quux direct", "Quux child"})
        by_id = self.search(f"?q=quux&category={self.sub.pk}")
        self.assertEqual([r["name"] for r in by_id["products"]], ["Quux child"])
        unknown = self.search("?q=quux&category=no-such")
        self.assertEqual(unknown, {"products": [], "services": [], "stays": [], "events": []})

    def test_unpublished_hidden_and_pending_event_excluded(self):
        self.listing(self.sub, "Vexa draft", status=Listing.DRAFT)
        hidden_owner = BusinessOwner.objects.create(full_name="Hidden", login_phone="+233207552002", password_hash="x", is_suspended=True)
        self.listing(self.sub, "Vexa suspended", business_owner=hidden_owner)
        self.event("Vexa pending", status=Event.PENDING)
        self.event("Vexa unpaid", paid_at=None, expires_at=None)
        self.event("Vexa expired", expires_at=timezone.now() - timedelta(days=1))
        self.listing(self.sub, "Vexa visible")
        body = self.search("?q=vexa")
        self.assertEqual([r["name"] for r in body["products"]], ["Vexa visible"])
        self.assertEqual(body["events"], [])

    @override_settings(SOLD_OUT_HIDDEN_ENABLED=True)
    def test_sold_out_hidden_when_switch_on(self):
        self.listing(self.sub, "Wibb gone", stock_quantity=0)
        self.listing(self.sub, "Wibb here", stock_quantity=3)
        self.assertEqual([r["name"] for r in self.search("?q=wibb")["products"]], ["Wibb here"])

    def test_short_query_returns_empty(self):
        self.listing(self.sub, "Yo yo")
        empty = {"products": [], "services": [], "stays": [], "events": []}
        self.assertEqual(self.search("?q=y"), empty)
        self.assertEqual(self.search(""), empty)

    def test_rows_have_no_contact_fields(self):
        self.listing(self.sub, "Kapp item")
        self.listing(self.svc, "Kapp service")
        self.listing(self.stay, "Kapp stay")
        self.event("Kapp event")
        body = self.search("?q=kapp")
        for group in body.values():
            self.assertEqual(len(group), 1)
            self.assertEqual(set(group[0]), ROW_KEYS)
        self.assertNotIn("+233207552999", str(body))

    def test_case_insensitive_and_description_match(self):
        self.listing(self.sub, "Plain thing", description="Hand-woven Bonwire cloth")
        self.assertEqual([r["name"] for r in self.search("?q=BONWIRE")["products"]], ["Plain thing"])

    def test_event_price_is_lowest_active_ticket_or_null(self):
        event = self.event("Tikk gala")
        self.assertIsNone(self.search("?q=tikk")["events"][0]["price"])
        EventTicketType.objects.create(event=event, name="VIP", price="80.00", quantity_total=10)
        EventTicketType.objects.create(event=event, name="Std", price="30.00", quantity_total=10)
        self.assertEqual(self.search("?q=tikk")["events"][0]["price"], "30.00")

    def test_kind_filter_and_unknown_kind(self):
        self.listing(self.sub, "Moop blender")
        self.listing(self.svc, "Moop plumbing")
        body = self.search("?q=moop&kind=services")
        self.assertEqual(body["products"], [])
        self.assertEqual(len(body["services"]), 1)
        self.assertEqual(len(self.search("?q=moop&kind=service")["services"]), 1)
        self.assertEqual(self.client.get(URL + "?q=moop&kind=bogus").status_code, 400)

    def test_limit_capped_at_twenty_and_newest_first(self):
        for i in range(25):
            self.listing(self.sub, f"Lim item {i}")
        self.assertEqual(len(self.search("?q=lim&limit=500")["products"]), 20)
        self.assertEqual(len(self.search("?q=lim&limit=3")["products"]), 3)
        self.assertEqual(len(self.search("?q=lim&limit=abc")["products"]), 20)
