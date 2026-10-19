from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from events.models import Event
from listings import visits
from listings.department_seed import DEPARTMENTS, OLD_TO_DEPARTMENT, sub_slug
from listings.models import Category, CategoryVisit, Listing, Zone

TREE = "/api/listings/categories/tree/"
EXCLUDED = {"Prime Video", "Amazon Music", "Kindle E-readers & Books", "Amazon Appstore"}


def flat(nodes):
    for node in nodes:
        yield node
        yield from flat(node["children"])


def slugs(nodes):
    return {n["slug"] for n in flat(nodes)}


class Base(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = BusinessOwner.objects.create(full_name="Tree Owner", login_phone="+233207551001", password_hash="x")

    def listing(self, category_slug, owner=None, **extra):
        fields = dict(
            business_owner=owner or self.owner, category=Category.objects.get(slug=category_slug), zone=self.zone,
            name="Thing", description="D.", contact_phone="+233207551999", price_amount="10.00",
            status=Listing.PUBLISHED,
        )
        fields.update(extra)
        return Listing.objects.create(**fields)

    def auth(self, user, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(user, kind)}")

    def tree(self, query=""):
        response = self.client.get(TREE + query)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()


class SeedTests(Base):
    def test_seed_contains_amazon_departments_and_excludes_digital(self):
        labels = set(Category.objects.filter(parent__isnull=True, kind="product").values_list("label", flat=True))
        self.assertFalse(labels & EXCLUDED)
        self.assertTrue({"Electronics", "Home & Kitchen", "Beauty & Personal Care"} <= labels)
        self.assertFalse(set(Category.objects.values_list("label", flat=True)) & EXCLUDED)

    def test_seed_slugs_are_unique_and_fit(self):
        seeded = [d[0] for d in DEPARTMENTS] + [sub_slug(d[0], s) for d in DEPARTMENTS for s in d[4]]
        self.assertEqual(len(seeded), len(set(seeded)))
        self.assertTrue(all(len(s) <= 50 for s in seeded))
        self.assertEqual(Category.objects.filter(slug__in=seeded).count(), len(seeded))

    def test_existing_service_stay_event_categories_survive(self):
        for slug, kind in [("hotels", "service"), ("tours", "service"), ("festivals", "event"), ("concerts", "event")]:
            category = Category.objects.get(slug=slug)
            self.assertEqual(category.kind, kind)
            self.assertIsNone(category.parent_id)

    def test_every_old_product_category_has_a_mapping_and_listing_is_repointed(self):
        old = {"shops", "pharmacy", "grocery", "beverages", "petrol"}
        self.assertEqual(set(OLD_TO_DEPARTMENT), old)
        seeded = {d[0] for d in DEPARTMENTS} | {sub_slug(d[0], s) for d in DEPARTMENTS for s in d[4]}
        unmapped = set(Category.objects.filter(kind="product").values_list("slug", flat=True)) - seeded - set(OLD_TO_DEPARTMENT)
        self.assertEqual(unmapped, set())
        for slug, department in OLD_TO_DEPARTMENT.items():
            self.assertEqual(Category.objects.get(slug=slug).parent.slug, department)
        listing = self.listing("shops")
        listing.refresh_from_db()
        self.assertEqual(listing.category.slug, "shops")  # not rewritten, never uncategorised
        self.assertEqual(listing.category.parent.slug, "home-kitchen")
        self.assertTrue(listing.category.parent.is_department)


class ShopperTreeTests(Base):
    def test_shopper_tree_hides_empty_departments(self):
        self.assertEqual(self.tree(), [])
        self.listing("pharmacy")
        nodes = self.tree()
        self.assertEqual([n["slug"] for n in nodes], ["health-household"])
        self.assertEqual([c["slug"] for c in nodes[0]["children"]], ["pharmacy"])
        self.assertEqual(nodes[0]["kind"], "product")
        self.assertEqual(set(nodes[0]), {"id", "slug", "label", "icon", "color", "kind", "is_accommodation", "children"})

    def test_service_stay_and_event_nodes_show_when_populated(self):
        self.listing("tours")
        stay = Category.objects.create(slug="lodges", icon="x", label="Lodges", color="#000", kind="service", is_accommodation=True)
        self.listing("lodges")
        now = timezone.now()
        Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone, submitted_by_business=self.owner,
            name="Fest", description="D.", address="Kumasi", event_date=now + timedelta(days=9), visibility_days=14,
            status=Event.APPROVED, paid_at=now, expires_at=now + timedelta(days=14),
        )
        nodes = {n["slug"]: n for n in self.tree()}
        self.assertEqual(set(nodes), {"tours", "lodges", "festivals"})
        self.assertTrue(nodes["lodges"]["is_accommodation"])
        self.assertEqual(nodes["festivals"]["kind"], "event")
        self.assertFalse(stay.pk is None)

    @override_settings(SOLD_OUT_HIDDEN_ENABLED=True)
    def test_shopper_tree_ignores_suspended_business_and_sold_out(self):
        suspended = BusinessOwner.objects.create(
            full_name="S", login_phone="+233207551002", password_hash="x", is_suspended=True,
        )
        self.listing("pharmacy", owner=suspended)
        self.listing("grocery", stock_quantity=0)
        self.listing("petrol", status=Listing.PENDING_REVIEW)
        self.assertEqual(self.tree(), [])
        self.listing("shops", stock_quantity=3)
        self.assertEqual({n["slug"] for n in self.tree()}, {"home-kitchen"})

    def test_full_tree_requires_business_or_staff(self):
        self.assertEqual(self.client.get(TREE + "?full=1").status_code, 403)
        customer = Customer.objects.create(full_name="C", phone="+233200771309", password_hash="x")
        self.auth(customer, "customer")
        self.assertEqual(self.client.get(TREE + "?full=1").status_code, 403)
        self.assertEqual(self.client.get(TREE).status_code, 200)  # the shopper view stays public

    def test_business_full_tree_includes_empty(self):
        self.auth(self.owner, "business_owner")
        nodes = self.tree("?full=1")
        self.assertIn("electronics", slugs(nodes))
        self.assertIn(sub_slug("electronics", "Headphones"), slugs(nodes))
        self.assertTrue({"hotels", "festivals"} <= slugs(nodes))
        electronics = next(n for n in nodes if n["slug"] == "electronics")
        self.assertTrue(electronics["children"])
        staff = StaffUser.objects.create(
            full_name="S", email="tree-staff@example.com", password_hash="x", role=Role.objects.get(name="support"),
        )
        self.auth(staff, "staff")
        self.assertIn("electronics", slugs(self.tree("?full=1")))

    def test_flat_category_list_is_unchanged(self):
        data = self.client.get("/api/listings/categories/").json()
        self.assertTrue(all("children" not in c for c in data))


class VisitTests(Base):
    def test_visit_beacon_increments_once_per_call_and_204(self):
        category = Category.objects.get(slug="electronics")
        for _ in range(3):
            self.assertEqual(self.client.post(f"/api/listings/categories/{category.pk}/visit/").status_code, 204)
        visit = CategoryVisit.objects.get(category=category)
        self.assertEqual((visit.day, visit.count), (timezone.localdate(), 3))
        self.assertEqual(self.client.post("/api/listings/categories/999999/visit/").status_code, 404)

    def bump(self, slug, count, days_ago=0):
        CategoryVisit.objects.create(
            category=Category.objects.get(slug=slug), day=timezone.localdate() - timedelta(days=days_ago), count=count,
        )

    def test_most_visited_orders_by_last_30_days_and_ignores_older(self):
        self.bump("books", 40)
        self.bump("baby", 30)
        self.bump("electronics", 1000, days_ago=45)  # outside the window
        self.bump(sub_slug("pet-supplies", "Dogs"), 25)  # a sub-category counts toward its department
        top = [c.slug for c in visits.most_visited()]
        self.assertEqual(top[:3], ["books", "baby", "pet-supplies"])
        self.assertEqual(len(top), 8)
        self.assertEqual(top[3], "electronics")  # unvisited, so back in seed order after the visited ones

    def test_most_visited_falls_back_to_seed_order_below_threshold(self):
        self.bump("books", visits.MIN_VISITS_FOR_RANKING - 1)
        seed = [d[0] for d in DEPARTMENTS][:8]
        self.assertEqual([c.slug for c in visits.most_visited()], seed)
