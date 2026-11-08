from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings import visits
from listings.department_seed import sub_slug
from listings.models import Category, CategoryVisit, Listing, Zone

URL = "/api/storefront/home/"


class HomeFeedTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = BusinessOwner.objects.create(full_name="Home Owner", login_phone="+233207553001", password_hash="x")

    def listing(self, slug, **extra):
        fields = dict(business_owner=self.owner, category=Category.objects.get(slug=slug), zone=self.zone, name="Thing",
                      description="D.", contact_phone="+233207553999", price_amount="10.00", status=Listing.PUBLISHED)
        fields.update(extra)
        return Listing.objects.create(**fields)

    def test_home_feed_most_visited_shape(self):
        self.listing("books")
        self.listing(sub_slug("electronics", "Headphones"))  # a sub-category's listing fills its department
        CategoryVisit.objects.create(category=Category.objects.get(slug="electronics"), day=timezone.localdate(),
                                     count=visits.MIN_VISITS_FOR_RANKING)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()["most_visited"]
        self.assertEqual([r["slug"] for r in rows[:2]], ["electronics", "books"])
        for row in rows:
            self.assertEqual(set(row), {"id", "slug", "label", "icon", "color", "image", "image_variants", "children"})
        self.assertEqual(rows[0]["label"], Category.objects.get(slug="electronics").label)

    def test_departments_carry_up_to_four_open_sub_categories_with_pictures(self):
        subs = ["Headphones", "Home Audio", "Camera & Photo", "Television & Video", "Wearable Technology"]
        for name in subs:
            self.listing(sub_slug("electronics", name))
        row = next(r for r in self.client.get(URL).json()["most_visited"] if r["slug"] == "electronics")
        self.assertLessEqual(len(row["children"]), 4)
        self.assertGreaterEqual(len(row["children"]), 1)
        for child in row["children"]:
            self.assertEqual(set(child), {"id", "slug", "label", "icon", "image", "image_variants"})
            self.assertIsNone(child["image"])
            self.assertIsNone(child["image_variants"])

    def test_home_feed_lists_only_departments_a_shopper_can_open(self):
        # Seed order alone would name eight empty departments; a shopper sees only those with something in them.
        response = self.client.get(URL)
        slugs = [r["slug"] for r in response.json()["most_visited"]]
        self.assertNotIn("baby", slugs)
        self.listing("baby")
        slugs = [r["slug"] for r in self.client.get(URL).json()["most_visited"]]
        self.assertIn("baby", slugs)

    def test_an_empty_department_with_a_picture_is_listed(self):
        # Staff uploaded its picture, so it shows even before anything is live in it.
        department = Category.objects.get(slug="toys-games")
        self.assertNotIn("toys-games", [r["slug"] for r in self.client.get(URL).json()["most_visited"]])
        department.image = "category_images/toys.jpg"
        department.save(update_fields=["image"])
        rows = self.client.get(URL).json()["most_visited"]
        self.assertIn("toys-games", [r["slug"] for r in rows])
        self.assertTrue(next(r for r in rows if r["slug"] == "toys-games")["image"])

    def test_a_department_with_items_is_never_cut_by_pictured_empty_ones(self):
        # Production bug: the feed kept 24 departments in visit order, and a department staff had pictured but left empty
        # took a slot ahead of a newly stocked one, so the stocked department fell off the end.
        product_departments = list(Category.objects.filter(parent__isnull=True, kind=Category.PRODUCT).order_by("sort_order", "id"))
        self.assertGreater(len(product_departments), 24)
        for department in product_departments[:-1]:
            department.image = "category_images/x.jpg"
            department.save(update_fields=["image"])
        last = product_departments[-1]
        self.listing(last.slug)
        rows = self.client.get(URL).json()["most_visited"]
        slugs = [r["slug"] for r in rows]
        self.assertIn(last.slug, slugs)
        # Departments with something live come first, then the pictured empty ones.
        self.assertEqual(slugs[0], last.slug)

    def test_ranked_true_when_ordered_by_visits(self):
        self.listing("books")
        CategoryVisit.objects.create(category=Category.objects.get(slug="books"), day=timezone.localdate(),
                                     count=visits.MIN_VISITS_FOR_RANKING)
        self.assertIs(self.client.get(URL).json()["ranked"], True)

    def test_ranked_false_when_fallen_back_to_seed_order(self):
        self.listing("books")
        CategoryVisit.objects.create(category=Category.objects.get(slug="books"), day=timezone.localdate(),
                                     count=visits.MIN_VISITS_FOR_RANKING - 1)
        body = self.client.get(URL).json()
        self.assertIs(body["ranked"], False)
        self.assertIn("books", [r["slug"] for r in body["most_visited"]])

    def test_home_feed_is_public(self):
        self.assertEqual(self.client.get(URL).status_code, 200)


class BrowseByDepartmentTests(TestCase):
    """The home's department links open /business?category=<department>; the browse list must then include the
    department's sub-categories, or a department whose listings all sit in sub-categories would look empty."""

    def test_public_list_category_filter_includes_sub_categories(self):
        zone = Zone.objects.get(name="Manhyia")
        owner = BusinessOwner.objects.create(full_name="Dept Owner", login_phone="+233207553002", password_hash="x")
        Listing.objects.create(business_owner=owner, category=Category.objects.get(slug=sub_slug("electronics", "Headphones")),
                               zone=zone, name="Studio cans", description="D.", contact_phone="+233207553998",
                               price_amount="10.00", status=Listing.PUBLISHED)
        response = APIClient().get("/api/listings/?category=electronics")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertIn("Studio cans", [r["name"] for r in rows])
