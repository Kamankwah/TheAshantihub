"""GET/PUT /api/accounts/business-owners/me/categories/: an owner reads and changes the categories that describe
their business. Categories never touch KYC, identity, subscription or listings."""
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.categories import set_categories
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff, staff_token
from listings.models import Category, Listing, Zone

URL = "/api/accounts/business-owners/me/categories/"


def make_category(slug, kind="product"):
    return Category.objects.create(slug=f"bca-{slug}", icon="🧵", label=slug.title(), color="#7c3aed", kind=kind)


def make_owner(phone="+233205550001", kind="product", **owner_extra):
    owner = BusinessOwner.objects.create(
        full_name="Ama Seller", login_phone=phone, email=f"{phone[-4:]}@example.com", password_hash="x", **owner_extra,
    )
    profile = BusinessOwnerProfile.objects.create(business_owner=owner, business_kind=kind)
    return owner, profile


class CategoriesApiTests(TestCase):
    def setUp(self):
        self.a = make_category("fabrics")
        self.b = make_category("shoes")
        self.c = make_category("bags")
        self.service = make_category("tailoring", kind="service")
        self.owner, self.profile = make_owner()
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def row(self, category):
        return {"id": category.pk, "label": category.label, "kind": category.kind}

    def test_get_returns_kind_limits_and_ordered_categories(self):
        set_categories(self.profile, [self.b.pk, self.a.pk])
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json(),
            {"business_kind": "product", "min": 1, "max": 10, "categories": [self.row(self.b), self.row(self.a)]},
        )

    def test_get_with_no_categories_and_no_kind(self):
        owner, _ = make_owner(phone="+233205550002", kind=None)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        self.assertEqual(
            client.get(URL).json(), {"business_kind": None, "min": 1, "max": 10, "categories": []},
        )

    def test_put_replaces_the_list_and_the_main(self):
        set_categories(self.profile, [self.a.pk, self.b.pk])
        response = self.client.put(URL, {"categories": [self.c.pk, self.a.pk]}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["categories"], [self.row(self.c), self.row(self.a)])
        self.assertEqual(response.json()["business_kind"], "product")
        self.assertEqual(self.client.get(URL).json()["categories"], [self.row(self.c), self.row(self.a)])
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.business_category_id, self.c.pk)

    def test_put_works_after_kyc_is_verified_and_with_live_listings(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.VERIFIED)
        set_categories(self.profile, [self.a.pk])
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.a, zone=Zone.objects.first() or Zone.objects.create(name="Manhyia"),
            name="Kente", description="D.", contact_phone="+233207000000", price_amount="10.00",
            status=Listing.PUBLISHED,
        )
        response = self.client.put(URL, {"categories": [self.b.pk]}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual((listing.category_id, listing.status), (self.a.pk, Listing.PUBLISHED))

    def test_put_does_not_touch_kyc_identity_or_subscription(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.VERIFIED)
        BusinessOwnerProfile.objects.filter(pk=self.profile.pk).update(
            identity_status=BusinessOwnerProfile.IDENTITY_VERIFIED,
        )

        def snapshot():
            owner = BusinessOwner.objects.get(pk=self.owner.pk)
            profile = BusinessOwnerProfile.objects.get(pk=self.profile.pk)
            return (
                owner.kyc_status, owner.kyc_rejection_reason, owner.reviewed_at, owner.reviewed_by_id,
                profile.identity_status, profile.identity_reviewed_at, profile.identity_rejection_reason,
                profile.business_kind, getattr(owner, "subscription", None),
            )

        before = snapshot()
        self.assertEqual(self.client.put(URL, {"categories": [self.b.pk, self.c.pk]}, format="json").status_code, 200)
        self.assertEqual(snapshot(), before)

    def test_put_cannot_empty_the_list(self):
        set_categories(self.profile, [self.a.pk])
        for body in ({"categories": []}, {"categories": "nope"}, {}, {"categories": None}, [1, 2], "x"):
            response = self.client.put(URL, body, format="json")
            self.assertEqual(response.status_code, 400, body)
            self.assertEqual(response.json(), {"detail": "Choose at least one category."}, body)
        self.assertEqual([c["id"] for c in self.client.get(URL).json()["categories"]], [self.a.pk])

    def test_put_without_a_kind_says_choose_products_or_services_first(self):
        owner, _ = make_owner(phone="+233205550003", kind=None)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        response = client.put(URL, {"categories": [self.a.pk]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Choose products or services first."})

    def test_invalid_ids_answer_400_with_plain_detail(self):
        cases = [
            ([self.a.pk, self.a.pk], "Pick each category once."),
            ([self.service.pk], "Choose categories for a product business."),
            ([999999999], "That category doesn't exist."),
            (["abc"], "That category doesn't exist."),
            (["9" * 5000], "That category doesn't exist."),
            ([True], "That category doesn't exist."),
            ([self.a.pk] * 11, "Pick each category once."),
        ]
        many = [make_category(f"extra-{i}").pk for i in range(11)]
        cases.append((many, "Choose at most 10 categories."))
        for ids, message in cases:
            response = self.client.put(URL, {"categories": ids}, format="json")
            self.assertEqual(response.status_code, 400, ids)
            self.assertEqual(response.json(), {"detail": message}, ids)

    def test_put_response_reflects_the_new_list_not_a_stale_one(self):
        set_categories(self.profile, [self.a.pk])
        self.client.get(URL)
        response = self.client.put(URL, {"categories": [self.b.pk]}, format="json")
        self.assertEqual(response.json()["categories"], [self.row(self.b)])

    def test_customer_and_staff_get_403(self):
        customer = Customer.objects.create(full_name="Kofi", email="kofi@example.com", password_hash="x")
        staff = make_staff("super_admin", "boss@example.com")
        for token in (issue_token(customer, "customer"), staff_token(staff)):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            self.assertEqual(client.get(URL).status_code, 403)
            self.assertEqual(client.put(URL, {"categories": [self.a.pk]}, format="json").status_code, 403)

    def test_unauthenticated_is_401(self):
        client = APIClient()
        self.assertEqual(client.get(URL).status_code, 401)
        self.assertEqual(client.put(URL, {"categories": [self.a.pk]}, format="json").status_code, 401)
