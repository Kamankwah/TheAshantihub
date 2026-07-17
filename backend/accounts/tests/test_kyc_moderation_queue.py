from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser


class KYCModerationQueueTests(TestCase):
    """Staff moderation-queue restructuring — three-state (?status=) queue,
    approver attribution, re-review, and Ghana Post address verification
    (punch-list items 1 & 8)."""

    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-kycq@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.pending_owner = self._owner("Pending Trader", "+233201000001", BusinessOwner.PENDING)
        self.verified_owner = self._owner("Verified Trader", "+233201000002", BusinessOwner.VERIFIED)
        self.rejected_owner = self._owner(
            "Rejected Trader", "+233201000003", BusinessOwner.REJECTED,
            kyc_rejection_reason="Blurry card",
        )

    def _owner(self, name, phone, kyc_status, kyc_rejection_reason=None):
        owner = BusinessOwner.objects.create(
            full_name=name, login_phone=phone, password_hash="x",
            kyc_status=kyc_status, kyc_rejection_reason=kyc_rejection_reason,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, gps_address="AK-039-5030",
            business_contact_phone=phone,
        )
        return owner

    def _auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")

    # ── Three-state list ────────────────────────────────────────────────────
    def test_default_queue_is_pending(self):
        self._auth()
        response = self.client.get("/api/accounts/kyc/pending/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([o["id"] for o in response.json()], [self.pending_owner.id])

    def test_approved_tab_lists_verified_owners(self):
        self._auth()
        response = self.client.get("/api/accounts/kyc/pending/?status=approved")
        self.assertEqual([o["id"] for o in response.json()], [self.verified_owner.id])

    def test_rejected_tab_lists_rejected_owners_with_reason(self):
        self._auth()
        response = self.client.get("/api/accounts/kyc/pending/?status=rejected")
        body = response.json()
        self.assertEqual([o["id"] for o in body], [self.rejected_owner.id])
        self.assertEqual(body[0]["kyc_rejection_reason"], "Blurry card")

    # ── Approver attribution ────────────────────────────────────────────────
    def test_approve_records_reviewer(self):
        self._auth()
        response = self.client.post(f"/api/accounts/kyc/{self.pending_owner.id}/approve/")
        self.assertEqual(response.status_code, 200)
        self.pending_owner.refresh_from_db()
        self.assertEqual(self.pending_owner.kyc_status, "verified")
        self.assertEqual(self.pending_owner.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending_owner.reviewed_at)

    def test_reject_records_reviewer(self):
        self._auth()
        response = self.client.post(
            f"/api/accounts/kyc/{self.pending_owner.id}/reject/",
            {"reason": "Card unreadable"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.pending_owner.refresh_from_db()
        self.assertEqual(self.pending_owner.reviewed_by, self.admin)
        self.assertIsNotNone(self.pending_owner.reviewed_at)

    def test_approved_list_surfaces_reviewer_name(self):
        self._auth()
        self.client.post(f"/api/accounts/kyc/{self.pending_owner.id}/approve/")
        response = self.client.get("/api/accounts/kyc/pending/?status=approved")
        row = next(o for o in response.json() if o["id"] == self.pending_owner.id)
        self.assertEqual(row["reviewed_by_name"], "Admin Person")
        self.assertIsNotNone(row["reviewed_at"])

    # ── Re-review ───────────────────────────────────────────────────────────
    def test_re_review_moves_rejected_back_to_pending_and_clears_rejection(self):
        self.rejected_owner.reviewed_by = self.admin
        self.rejected_owner.save(update_fields=["reviewed_by"])
        self._auth()
        response = self.client.post(f"/api/accounts/kyc/{self.rejected_owner.id}/re-review/")
        self.assertEqual(response.status_code, 200)
        self.rejected_owner.refresh_from_db()
        self.assertEqual(self.rejected_owner.kyc_status, "pending")
        self.assertIsNone(self.rejected_owner.kyc_rejection_reason)
        self.assertIsNone(self.rejected_owner.reviewed_by)
        self.assertIsNone(self.rejected_owner.reviewed_at)

    def test_re_review_rejects_a_non_rejected_submission(self):
        self._auth()
        response = self.client.post(f"/api/accounts/kyc/{self.pending_owner.id}/re-review/")
        self.assertEqual(response.status_code, 400)

    def test_re_review_requires_kyc_approve_permission(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant", email="acc-kycq@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(accountant, 'staff')}")
        response = self.client.post(f"/api/accounts/kyc/{self.rejected_owner.id}/re-review/")
        self.assertEqual(response.status_code, 403)

    # ── Address verification (item 8) ───────────────────────────────────────
    def test_address_verify_records_decision_and_attribution(self):
        self._auth()
        response = self.client.post(
            f"/api/accounts/kyc/{self.pending_owner.id}/address-verify/",
            {"verified": True}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        profile = self.pending_owner.profile
        profile.refresh_from_db()
        self.assertTrue(profile.address_verified)
        self.assertEqual(profile.address_verified_by, self.admin)
        self.assertIsNotNone(profile.address_verified_at)
        self.assertEqual(response.json()["address_verified_by_name"], "Admin Person")

    def test_address_verify_can_mark_wrong_but_still_records_decision(self):
        self._auth()
        response = self.client.post(
            f"/api/accounts/kyc/{self.pending_owner.id}/address-verify/",
            {"verified": False}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        profile = self.pending_owner.profile
        profile.refresh_from_db()
        self.assertFalse(profile.address_verified)
        # A decision was still made — this is what unblocks Approve/Reject.
        self.assertIsNotNone(profile.address_verified_at)

    def test_address_verify_surfaced_on_kyc_detail(self):
        self._auth()
        self.client.post(
            f"/api/accounts/kyc/{self.pending_owner.id}/address-verify/",
            {"verified": True}, format="json",
        )
        response = self.client.get(f"/api/accounts/kyc/{self.pending_owner.id}/")
        profile = response.json()["profile"]
        self.assertTrue(profile["address_verified"])
        self.assertEqual(profile["address_verified_by_name"], "Admin Person")
        self.assertIsNotNone(profile["address_verified_at"])

    def test_address_verify_requires_kyc_approve_permission(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant2", email="acc2-kycq@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(accountant, 'staff')}")
        response = self.client.post(
            f"/api/accounts/kyc/{self.pending_owner.id}/address-verify/",
            {"verified": True}, format="json",
        )
        self.assertEqual(response.status_code, 403)
