from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, ScoutAssignment, StaffUser


class ScoutTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-scout@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.scout = StaffUser.objects.create(
            full_name="Scout Kofi", email="scout@example.com", password_hash="x",
            role=Role.objects.get(name="scout"),
        )
        self.other_scout = StaffUser.objects.create(
            full_name="Scout Ama", email="scout2@example.com", password_hash="x",
            role=Role.objects.get(name="scout"),
        )
        self.support = StaffUser.objects.create(
            full_name="Support Person", email="support-scout@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233207881100", password_hash="x",
            kyc_status=BusinessOwner.PENDING,
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner, business_kind="product", gps_address="AK-039-5028",
            business_contact_phone="+233207881100",
        )

    def _auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")


class ScoutAssignmentTests(ScoutTestsBase):
    def test_admin_assigns_a_scout(self):
        self._auth(self.admin)
        response = self.client.post(
            "/api/accounts/scout-assignments/",
            {"business_owner": self.owner.id, "scout": self.scout.id}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(ScoutAssignment.objects.filter(business_owner=self.owner, scout=self.scout).exists())

    def test_assigning_requires_scouts_assign(self):
        self._auth(self.support)
        response = self.client.post(
            "/api/accounts/scout-assignments/",
            {"business_owner": self.owner.id, "scout": self.scout.id}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_cannot_assign_a_non_scout(self):
        self._auth(self.admin)
        response = self.client.post(
            "/api/accounts/scout-assignments/",
            {"business_owner": self.owner.id, "scout": self.support.id}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_double_assignment_is_rejected(self):
        ScoutAssignment.objects.create(business_owner=self.owner, scout=self.scout)
        self._auth(self.admin)
        response = self.client.post(
            "/api/accounts/scout-assignments/",
            {"business_owner": self.owner.id, "scout": self.scout.id}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_scout_list_returns_only_scouts(self):
        self._auth(self.admin)
        names = [s["full_name"] for s in self.client.get("/api/accounts/scouts/").json()]
        self.assertIn("Scout Kofi", names)
        self.assertNotIn("Support Person", names)

    def test_scout_sees_only_their_own_queue(self):
        ScoutAssignment.objects.create(business_owner=self.owner, scout=self.scout)
        self._auth(self.other_scout)
        self.assertEqual(len(self.client.get("/api/accounts/scout-assignments/mine/").json()), 0)
        self._auth(self.scout)
        self.assertEqual(len(self.client.get("/api/accounts/scout-assignments/mine/").json()), 1)


class ScoutVerifyTests(ScoutTestsBase):
    def setUp(self):
        super().setUp()
        self.assignment = ScoutAssignment.objects.create(
            business_owner=self.owner, scout=self.scout, assigned_by=self.admin,
        )

    def test_scout_confirms_the_address_and_it_satisfies_the_kyc_gate(self):
        self._auth(self.scout)
        response = self.client.post(
            f"/api/accounts/scout-assignments/{self.assignment.id}/verify/",
            {"address_confirmed": True, "business_legitimate": True, "details_correct": True,
             "notes": "All checks out"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assignment.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(self.assignment.status, ScoutAssignment.VISITED)
        # The KYC gate reads address_verified_at — the scout's visit sets it.
        self.assertTrue(self.profile.address_verified)
        self.assertIsNotNone(self.profile.address_verified_at)
        self.assertEqual(self.profile.address_verified_by, self.scout)

    def test_scout_corrects_a_wrong_address(self):
        self._auth(self.scout)
        response = self.client.post(
            f"/api/accounts/scout-assignments/{self.assignment.id}/verify/",
            {"address_confirmed": False, "corrected_address": "AK-100-9999",
             "business_legitimate": True, "details_correct": True}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.profile.refresh_from_db()
        # A "wrong" decision still records that a decision was made (gate opens).
        self.assertFalse(self.profile.address_verified)
        self.assertIsNotNone(self.profile.address_verified_at)
        # The correction is written onto the profile's Ghana Post address.
        self.assertEqual(self.profile.gps_address, "AK-100-9999")

    def test_verify_requires_an_address_decision(self):
        self._auth(self.scout)
        response = self.client.post(
            f"/api/accounts/scout-assignments/{self.assignment.id}/verify/",
            {"business_legitimate": True}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_a_scout_cannot_verify_another_scouts_assignment(self):
        self._auth(self.other_scout)
        response = self.client.post(
            f"/api/accounts/scout-assignments/{self.assignment.id}/verify/",
            {"address_confirmed": True}, format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_verify_requires_scouts_verify_permission(self):
        self._auth(self.support)
        response = self.client.post(
            f"/api/accounts/scout-assignments/{self.assignment.id}/verify/",
            {"address_confirmed": True}, format="json",
        )
        self.assertEqual(response.status_code, 403)
