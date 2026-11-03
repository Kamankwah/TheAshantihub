from accounts.categories import set_categories
from accounts.models import BusinessOwner, BusinessOwnerProfile
from listings.models import Category
from marketing import audience, consent
from marketing.tests.base import MarketingBase


def make_business(n, categories=(), kind="product"):
    owner = BusinessOwner.objects.create(
        full_name=f"Owner {n}", login_phone=f"+23320600{n:04d}", email=f"b{n}@example.com", password_hash="x",
    )
    profile = BusinessOwnerProfile.objects.create(business_owner=owner, business_name=f"Shop {n}", business_kind=kind)
    if categories:
        set_categories(profile, [c.pk for c in categories])
    consent.record_consent(owner, "email", True, "settings")
    return owner


class BusinessAudienceCategoryTests(MarketingBase):
    def setUp(self):
        super().setUp()
        self.fabrics, self.shoes, self.bags = (
            Category.objects.create(slug=f"au-{n}", icon="🧵", label=n.title(), color="#336699", kind="product")
            for n in ("fabrics", "shoes", "bags")
        )

    def count(self, *category_ids):
        return audience.count_for("business_owner", {"categories": list(category_ids)}, "email")["count"]

    def test_audience_matches_a_business_on_any_of_its_categories_once(self):
        make_business(1, [self.fabrics, self.shoes, self.bags])
        make_business(2, [self.bags])
        self.assertEqual(self.count(self.shoes.pk), 1)            # a non-main category matches
        self.assertEqual(self.count(self.fabrics.pk), 1)
        self.assertEqual(self.count(self.fabrics.pk, self.shoes.pk, self.bags.pk), 2)   # once, not once per category
        matched = audience.matching("business_owner", {"categories": [self.fabrics.pk, self.shoes.pk], "zones": [], "activity": "any", "days": 30})
        self.assertEqual(matched.count(), 1)

    def test_audience_count_unchanged_for_single_category_businesses(self):
        make_business(1, [self.fabrics])
        make_business(2, [self.shoes])
        make_business(3)   # no category at all
        self.assertEqual(self.count(self.fabrics.pk), 1)
        self.assertEqual(self.count(self.shoes.pk), 1)
        self.assertEqual(self.count(self.bags.pk), 0)
        self.assertEqual(audience.count_for("business_owner", {}, "email")["count"], 3)

    def test_an_older_business_with_only_a_main_category_still_matches(self):
        owner = make_business(1)
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(business_category=self.bags)
        self.assertEqual(self.count(self.bags.pk), 1)
