from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, Role, StaffUser
from accounts.testing import make_staff, staff_token


class UsersListTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        Customer.objects.create(
            full_name="Ama Owusu", phone="+233241234567", email="ama@example.com",
            password_hash=make_password("x"),
        )
        BusinessOwner.objects.create(
            full_name="Kwame Business", login_phone="+233201112233", email="kwame@example.com",
            password_hash=make_password("x"),
        )

    def _staff(self, role_name, suffix):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person", email=f"{role_name}-{suffix}@example.com",
            password_hash="x", role=Role.objects.get(name=role_name),
        )
        return issue_token(staff, "staff")

    def test_admin_can_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('operations', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["full_name"], "Ama Owusu")
        self.assertNotIn("password_hash", data["results"][0])

    def test_support_can_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('support', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 200)

    def test_marketing_cannot_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_list_business_owners(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('operations', 2)}")
        response = self.client.get("/api/accounts/business-owners/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["full_name"], "Kwame Business")
        self.assertEqual(data["results"][0]["kyc_status"], "pending")
        self.assertNotIn("password_hash", data["results"][0])

    def test_marketing_cannot_list_business_owners(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 2)}")
        response = self.client.get("/api/accounts/business-owners/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 401)


class BusinessOwnerSearchTests(TestCase):
    """GET /api/accounts/business-owners/?search= — the Fraud cases "Raise a
    case" business picker (staff phase 2A Task 14). users.view, as before."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.adwoa = self._business("Adwoa Frimpong", "0244000118", "Adwoa Fabrics")
        self.suame = self._business("Kojo Mensah", "+233 24 400 3390", "Suame Spare Parts Centre")
        self.bare = BusinessOwner.objects.create(
            full_name="Yaw Bare", login_phone="+233201110000", password_hash=make_password("x"),
        )
        support = make_staff("support", "esi@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(support)}")

    @staticmethod
    def _business(name, phone, business_name):
        owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash=make_password("x"))
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name=business_name, business_contact_phone=phone,
        )
        return owner

    def _ids(self, term):
        response = self.client.get("/api/accounts/business-owners/", {"search": term})
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()["results"]]

    def test_matches_the_business_name_and_the_owner_name(self):
        self.assertEqual(self._ids("spare parts"), [self.suame.pk])
        self.assertEqual(self._ids("FRIMPONG"), [self.adwoa.pk])

    def test_matches_the_sign_in_phone_however_either_was_written(self):
        self.assertEqual(self._ids("+233 24 400 0118"), [self.adwoa.pk])
        self.assertEqual(self._ids("0244003390"), [self.suame.pk])

    def test_each_row_carries_the_business_name(self):
        row = self.client.get("/api/accounts/business-owners/", {"search": "adwoa"}).json()["results"][0]
        self.assertEqual((row["id"], row["business_name"]), (self.adwoa.pk, "Adwoa Fabrics"))
        bare = self.client.get("/api/accounts/business-owners/", {"search": "Yaw Bare"}).json()["results"][0]
        self.assertEqual(bare["business_name"], "Yaw Bare")  # no profile yet: the owner's own name

    def test_no_search_still_lists_everyone(self):
        self.assertEqual(set(self._ids("")), {self.adwoa.pk, self.suame.pk, self.bare.pk})

    def test_marketing_still_cannot_search(self):
        marketing = make_staff("marketing", "abena@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(marketing)}")
        self.assertEqual(self.client.get("/api/accounts/business-owners/", {"search": "adwoa"}).status_code, 403)
