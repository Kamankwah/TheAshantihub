from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser
from listings.models import Category, Listing, Zone


class ListingCategoryMoveTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Move Owner", login_phone="+233207552001", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="books"), zone=Zone.objects.get(name="Manhyia"),
            name="Atlas", description="D.", contact_phone="+233207552999", price_amount="10.00", status=Listing.PUBLISHED,
        )
        self.other_product = Category.objects.filter(kind=Category.PRODUCT, is_accommodation=False).exclude(pk=self.listing.category_id).first()
        self.service = Category.objects.filter(kind=Category.SERVICE, is_accommodation=False).first()

    def url(self):
        return f"/api/listings/{self.listing.pk}/category/"

    def as_staff(self, role_name):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Mover", email=f"{role_name}-move@example.com", password_hash="x", role=Role.objects.get(name=role_name),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def test_marketing_operations_and_super_admin_can_move_it_at_once(self):
        for role in ("marketing", "operations", "super_admin"):
            self.listing.refresh_from_db()
            target = Category.objects.filter(kind=Category.PRODUCT, is_accommodation=False, is_food=False).exclude(pk=self.listing.category_id).first()
            self.as_staff(role)
            response = self.client.post(self.url(), {"category": target.pk}, format="json")
            self.assertEqual(response.status_code, 200, response.content)
            self.listing.refresh_from_db()
            self.assertEqual(self.listing.category_id, target.pk)
            self.assertEqual(self.listing.status, Listing.PUBLISHED)

    def test_other_staff_roles_and_owners_are_refused(self):
        self.as_staff("support")
        self.assertEqual(self.client.post(self.url(), {"category": self.other_product.pk}, format="json").status_code, 403)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        self.assertIn(self.client.post(self.url(), {"category": self.other_product.pk}, format="json").status_code, (401, 403))
        self.client.credentials()
        self.assertEqual(self.client.post(self.url(), {"category": self.other_product.pk}, format="json").status_code, 401)

    def test_a_different_kind_is_refused(self):
        self.as_staff("operations")
        response = self.client.post(self.url(), {"category": self.service.pk}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("same kind", response.json()["category"])

    def test_same_category_and_unknown_category_are_refused(self):
        self.as_staff("operations")
        self.assertEqual(self.client.post(self.url(), {"category": self.listing.category_id}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.url(), {"category": 999999}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.url(), {}, format="json").status_code, 400)

    def test_a_business_registered_for_another_kind_is_refused(self):
        BusinessOwnerProfile.objects.create(business_owner=self.owner, business_name="Move Co", business_kind="service")
        self.as_staff("operations")
        response = self.client.post(self.url(), {"category": self.other_product.pk}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("registered", response.json()["category"])

    def test_the_move_is_recorded(self):
        from activity.models import ActivityEvent

        self.as_staff("operations")
        self.client.post(self.url(), {"category": self.other_product.pk}, format="json")
        self.assertTrue(ActivityEvent.objects.filter(verb="listing-category-move", target_id=str(self.listing.pk)).exists())
