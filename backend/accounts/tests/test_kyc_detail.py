from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.categories import set_categories
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser
from listings.models import Category


class KYCDetailViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-detail@example.com", password_hash="x",
            role=Role.objects.get(name="operations"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Kwabena Trader", login_phone="+233207001122", password_hash="x",
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner,
            ghana_card_number="GHA-123123123-1",
            gps_address="AK-039-5040",
            business_contact_phone="+233207001122",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233207001122",
            payout_momo_name="Kwabena Trader",
        )

    def test_admin_can_view_kyc_detail(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["id"], self.owner.id)
        self.assertEqual(body["profile"]["ghana_card_number"], "GHA-123123123-1")
        self.assertEqual(body["profile"]["gps_address"], "AK-039-5040")
        self.assertFalse(body["profile"]["is_formal"])
        self.assertIsNone(body["profile"]["business_reg_certificate"])
        self.assertNotIn("password_hash", body)
        self.assertNotIn("payout_bank_account_number", body["profile"])

    def test_accountant_cannot_view_kyc_detail(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Detail", email="acc-detail@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        token = issue_token(accountant, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.status_code, 403)

    def test_detail_reflects_rejection_reason_after_reject(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        self.client.post(
            f"/api/accounts/kyc/{self.owner.id}/reject/",
            {"reason": "Ghana Card image is blurry"},
            format="json",
        )
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.json()["kyc_rejection_reason"], "Ghana Card image is blurry")

    def test_kyc_review_shows_tin_to_a_reviewer_without_users_manage(self):
        # Deliberate (user decision, 2026-10-04): the TIN is users.manage-only
        # on the business-owner detail, but KYC review keeps it, because a
        # reviewer checks a formally registered business against its TIN.
        # Only reachable through an individual kyc.approve grant: by role,
        # every kyc.approve holder (admin, super_admin) has users.manage too.
        from accounts.models import Permission

        self.profile.is_formal = True
        self.profile.tin = "C0009876543"
        self.profile.save()
        support = StaffUser.objects.create(
            full_name="Support Reviewer", email="support-kyc@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        support.extra_permissions.add(Permission.objects.get(codename="kyc.approve"))
        self.assertNotIn("users.manage", support.effective_permission_codenames())
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(support, 'staff')}")

        kyc = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(kyc.status_code, 200, kyc.content)
        self.assertEqual(kyc.json()["profile"]["tin"], "C0009876543")

        detail = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertNotIn("tin", detail.json()["profile"])


class KYCDetailCategoriesTests(TestCase):
    """The KYC detail lists every category name (main first) and costs no query per business."""

    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-cats@example.com", password_hash="x",
            role=Role.objects.get(name="operations"),
        )
        self.admin_token = issue_token(self.admin, "staff")
        self.owner = BusinessOwner.objects.create(full_name="Kwabena Trader", login_phone="+233207001122", password_hash="x")
        self.profile = BusinessOwnerProfile.objects.create(business_owner=self.owner, gps_address="AK-039-5040")

    def make_cats(self, *names):
        return [
            Category.objects.create(slug=f"kd-{name}", icon="🧵", label=name.title(), color="#336699", kind="product")
            for name in names
        ]

    def auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")

    def test_kyc_detail_lists_every_category_name(self):
        fabrics, shoes, bags = self.make_cats("fabrics", "shoes", "bags")
        self.profile.business_kind = "product"
        self.profile.save()
        set_categories(self.profile, [shoes.pk, bags.pk, fabrics.pk])
        self.auth()
        body = self.client.get(f"/api/accounts/kyc/{self.owner.id}/").json()
        self.assertEqual(body["business_category_names"], ["Shoes", "Bags", "Fabrics"])
        self.assertEqual(body["business_category_name"], "Shoes")

    def test_business_with_no_categories_gets_an_empty_list(self):
        self.auth()
        body = self.client.get(f"/api/accounts/kyc/{self.owner.id}/").json()
        self.assertEqual((body["business_category_name"], body["business_category_names"]), (None, []))

    def test_an_owner_without_a_profile_gets_an_empty_list(self):
        bare = BusinessOwner.objects.create(full_name="No Profile", login_phone="+233207009900", password_hash="x")
        self.auth()
        body = self.client.get(f"/api/accounts/kyc/{bare.id}/").json()
        self.assertEqual(body["business_category_names"], [])

    def test_list_endpoints_do_not_query_per_business(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from accounts import kyc
        from accounts.serializers import BusinessOwnerKYCDetailSerializer

        cats = self.make_cats("a", "b", "c")
        serializer = BusinessOwnerKYCDetailSerializer()
        self.auth()
        self.client.get("/api/accounts/kyc/pending/")  # warm-up: the first request also stamps the session's last_seen_at

        def add(n):
            for _ in range(n):
                owner = BusinessOwner.objects.create(
                    full_name="Bulk", login_phone=f"+2332070{BusinessOwner.objects.count():05d}", password_hash="x",
                )
                profile = BusinessOwnerProfile.objects.create(business_owner=owner, business_kind="product")
                set_categories(profile, [c.pk for c in cats])

        def category_queries():
            # Loading the owners the way the queue and the detail do, then reading each one's category names.
            with CaptureQueriesContext(connection) as ctx:
                names = [serializer.get_business_category_names(owner) for owner in kyc.with_review_data(BusinessOwner.objects.all())]
            self.assertEqual(names.count(["A", "B", "C"]), len(names) - 1)  # all but the setUp owner, who has none
            return len(ctx)

        def queue_queries():
            with CaptureQueriesContext(connection) as ctx:
                self.assertEqual(self.client.get("/api/accounts/kyc/pending/").status_code, 200)
            return len(ctx)

        add(1)
        one, queue_one = category_queries(), queue_queries()
        add(4)
        five, queue_five = category_queries(), queue_queries()
        self.assertEqual(one, five)
        self.assertEqual(queue_one, queue_five)
