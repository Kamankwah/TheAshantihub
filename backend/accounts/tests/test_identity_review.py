from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import kyc
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from notifications.models import Notification

QUEUE = "/api/accounts/kyc/identity/pending/"


class IdentityReviewTests(TestCase):
    _counter = 0

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.reviewer = make_staff("operations", "kojo@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def _owner(self, identity_status=BusinessOwnerProfile.IDENTITY_PENDING, *, submitted_at=None,
               kyc_status=BusinessOwner.PENDING, scout=None, address_decided=True, **profile_fields):
        type(self)._counter += 1
        n = type(self)._counter
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {n}", login_phone=f"+2332200000{n:02d}", password_hash="x", kyc_status=kyc_status,
            registration_channel=BusinessOwner.SCOUT if scout else BusinessOwner.SELF,
            registered_by=scout, account_manager=scout,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name=f"Shop {n}", gps_address="AK-039-5050",
            business_contact_phone=owner.login_phone, identity_status=identity_status,
            identity_submitted_at=submitted_at or timezone.now(),
            address_verified=address_decided, address_verified_by=self.lead if address_decided else None,
            address_verified_at=timezone.now() if address_decided else None,
            **profile_fields,
        )
        return owner

    def _profile(self, owner):
        return BusinessOwnerProfile.objects.get(business_owner=owner)

    def _approve(self, owner):
        return self.client.post(f"/api/accounts/kyc/{owner.id}/identity/approve/", {}, format="json")

    def _reject(self, owner, reason="The card photo is blurred."):
        return self.client.post(f"/api/accounts/kyc/{owner.id}/identity/reject/", {"reason": reason}, format="json")

    def _reopen(self, owner):
        return self.client.post(f"/api/accounts/kyc/{owner.id}/identity/re-review/", {}, format="json")

    def test_approve_sets_verified_reviewer_and_notifies_owner(self):
        owner = self._owner()
        self.as_(self.reviewer)
        response = self._approve(owner)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"id": owner.id, "identity_status": "verified"})
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "verified")
        self.assertEqual(profile.identity_reviewed_by, self.reviewer)
        self.assertIsNotNone(profile.identity_reviewed_at)
        self.assertIsNone(profile.identity_rejection_reason)
        note = Notification.objects.get(business_owner=owner)
        self.assertEqual(note.title, "You're verified!")
        self.assertIn("verified check mark", note.body)
        self.assertEqual(note.link, "/business-dashboard")
        self.assertEqual(note.icon, "✅")

    def test_reject_requires_reason_and_notifies(self):
        owner = self._owner()
        self.as_(self.reviewer)
        blank = self._reject(owner, "   ")
        self.assertEqual(blank.status_code, 400)
        self.assertEqual(blank.json()["detail"], kyc.REASON_REQUIRED)
        self.assertEqual(self._profile(owner).identity_status, "pending")
        self.assertFalse(Notification.objects.filter(business_owner=owner).exists())

        response = self._reject(owner, "The card photo is blurred.")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"id": owner.id, "identity_status": "rejected"})
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "rejected")
        self.assertEqual(profile.identity_rejection_reason, "The card photo is blurred.")
        self.assertEqual(profile.identity_reviewed_by, self.reviewer)
        self.assertIsNotNone(profile.identity_reviewed_at)
        note = Notification.objects.get(business_owner=owner)
        self.assertEqual(note.body, "The card photo is blurred.")
        self.assertEqual(note.link, "/business-dashboard")

    def test_cannot_decide_when_not_pending(self):
        self.as_(self.reviewer)
        for status in ("not_submitted", "verified", "rejected"):
            owner = self._owner(status)
            for response in (self._approve(owner), self._reject(owner)):
                self.assertEqual(response.status_code, 400, (status, response.content))
                self.assertEqual(response.json()["detail"], kyc.IDENTITY_NOT_PENDING)
            self.assertEqual(self._profile(owner).identity_status, status)
        self.assertEqual(Notification.objects.count(), 0)

    def test_unknown_owner_is_404(self):
        self.as_(self.reviewer)
        response = self.client.post("/api/accounts/kyc/999999/identity/approve/", {}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_registrar_cannot_approve_identity_403(self):
        owner = self._owner(scout=self.scout)
        registrar = make_staff("operations", "reg@example.com")
        owner.registered_by = registrar
        owner.account_manager = None
        owner.save()
        self.as_(registrar)
        for response in (self._approve(owner), self._reject(owner)):
            self.assertEqual(response.status_code, 403, response.content)
            self.assertEqual(response.json()["detail"], kyc.OWN_REGISTRATION)
        self.assertEqual(self._profile(owner).identity_status, "pending")

    def test_account_manager_cannot_approve_identity_403(self):
        owner = self._owner(scout=self.scout)
        manager = make_staff("operations", "mgr@example.com")
        owner.account_manager = manager
        owner.save()
        self.as_(manager)
        response = self._approve(owner)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["detail"], kyc.OWN_REGISTRATION)
        self.assertEqual(self._profile(owner).identity_status, "pending")

    def test_super_admin_who_registered_is_still_refused(self):
        owner = self._owner()
        owner.registered_by = self.boss
        owner.save()
        self.as_(self.boss)
        self.assertEqual(self._approve(owner).status_code, 403)

    def test_decision_records_activity_event(self):
        owner = self._owner()
        self.as_(self.reviewer)
        self._approve(owner)
        rejected = self._owner()
        self._reject(rejected, "Number does not match the photo.")
        approve = ActivityEvent.objects.get(verb="identity-approve")
        self.assertEqual(approve.target_type, "accounts.businessowner")
        self.assertEqual(approve.target_id, str(owner.pk))
        self.assertEqual(approve.actor_id, self.reviewer.pk)
        reject = ActivityEvent.objects.get(verb="identity-reject")
        self.assertEqual(reject.target_id, str(rejected.pk))
        self.assertEqual(ActivityEvent.objects.filter(verb__startswith="identity-").count(), 2)

    def test_unknown_status_param_falls_back_to_pending(self):
        pending = self._owner()
        verified = self._owner("verified")
        self.as_(self.reviewer)
        for query in ("", "?status=bogus", "?status=pending"):
            ids = [row["id"] for row in self.client.get(QUEUE + query).json()]
            self.assertEqual(ids, [pending.id], query)
        approved = [row["id"] for row in self.client.get(QUEUE + "?status=approved").json()]
        self.assertEqual(approved, [verified.id])

    def test_queue_orders_pending_oldest_first(self):
        now = timezone.now()
        newest = self._owner(submitted_at=now)
        oldest = self._owner(submitted_at=now - timedelta(days=3))
        middle = self._owner(submitted_at=now - timedelta(days=1))
        self.as_(self.reviewer)
        rows = self.client.get(QUEUE).json()
        self.assertEqual([row["id"] for row in rows], [oldest.id, middle.id, newest.id])
        self.assertEqual({row["identity_status"] for row in rows}, {"pending"})

    def test_history_orders_most_recently_decided_first(self):
        now = timezone.now()
        old = self._owner("rejected", identity_reviewed_at=now - timedelta(days=2))
        recent = self._owner("rejected", identity_reviewed_at=now)
        self.as_(self.reviewer)
        rows = self.client.get(QUEUE + "?status=rejected").json()
        self.assertEqual([row["id"] for row in rows], [recent.id, old.id])

    def test_reopen_only_from_rejected(self):
        self.as_(self.reviewer)
        for status in ("not_submitted", "pending", "verified"):
            owner = self._owner(status)
            response = self._reopen(owner)
            self.assertEqual(response.status_code, 400, (status, response.content))
            self.assertEqual(self._profile(owner).identity_status, status)

        owner = self._owner("rejected", identity_rejection_reason="Blurred.",
                            identity_reviewed_by=self.lead, identity_reviewed_at=timezone.now())
        response = self._reopen(owner)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"id": owner.id, "identity_status": "pending"})
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "pending")
        self.assertIsNone(profile.identity_rejection_reason)
        self.assertIsNone(profile.identity_reviewed_by)
        self.assertIsNone(profile.identity_reviewed_at)
        self.assertTrue(ActivityEvent.objects.filter(verb="identity-reopen", target_id=str(owner.pk)).exists())

    def test_reopen_refuses_a_submitter(self):
        owner = self._owner("rejected", scout=self.scout)
        self.as_(self.scout)
        self.assertEqual(self._reopen(owner).status_code, 403)

    def test_identity_decision_does_not_change_kyc_status(self):
        owner = self._owner(kyc_status=BusinessOwner.PENDING)
        self.as_(self.reviewer)
        self._approve(owner)
        owner.refresh_from_db()
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)
        self.assertIsNone(owner.reviewed_by)
        self.assertIsNone(owner.reviewed_at)

        rejected = self._owner(kyc_status=BusinessOwner.VERIFIED)
        self._reject(rejected)
        rejected.refresh_from_db()
        self.assertEqual(rejected.kyc_status, BusinessOwner.VERIFIED)

    def test_kyc_approval_does_not_change_identity_status(self):
        owner = self._owner("not_submitted")
        self.as_(self.reviewer)
        response = self.client.post(f"/api/accounts/kyc/{owner.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        owner.refresh_from_db()
        self.assertEqual(owner.kyc_status, BusinessOwner.VERIFIED)
        self.assertEqual(self._profile(owner).identity_status, "not_submitted")

        pending_id = self._owner("pending")
        self.client.post(f"/api/accounts/kyc/{pending_id.id}/approve/", {}, format="json")
        self.assertEqual(self._profile(pending_id).identity_status, "pending")

    def test_requires_kyc_approve_permission(self):
        owner = self._owner()
        other_scout = make_staff("scout", "efua@example.com", manager=self.lead)
        self.as_(other_scout)
        self.assertEqual(self.client.get(QUEUE).status_code, 403)
        self.assertEqual(self._approve(owner).status_code, 403)
        self.assertEqual(self._reject(owner).status_code, 403)
        self.assertEqual(self._reopen(owner).status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get(QUEUE).status_code, 401)
        self.assertEqual(self._profile(owner).identity_status, "pending")

    def test_identity_pending_url_is_not_captured_by_the_kyc_detail_route(self):
        self.as_(self.reviewer)
        self.assertEqual(self.client.get(QUEUE).status_code, 200)

    def test_kyc_list_and_detail_carry_identity_fields(self):
        owner = self._owner(identity_rejection_reason="Blurred.")
        self.as_(self.reviewer)
        listed = self.client.get("/api/accounts/kyc/pending/").json()
        self.assertEqual([row["identity_status"] for row in listed if row["id"] == owner.id], ["pending"])
        detail = self.client.get(f"/api/accounts/kyc/{owner.id}/").json()
        self.assertEqual(detail["identity_status"], "pending")
        profile = detail["profile"]
        self.assertEqual(profile["identity_status"], "pending")
        self.assertEqual(profile["identity_rejection_reason"], "Blurred.")
        self.assertIsNotNone(profile["identity_submitted_at"])

    def test_owner_without_a_profile_reads_no_identity_status(self):
        owner = BusinessOwner.objects.create(full_name="No Profile", login_phone="+233220000999", password_hash="x")
        self.as_(self.reviewer)
        self.assertIsNone(self.client.get(f"/api/accounts/kyc/{owner.id}/").json()["identity_status"])
        response = self._approve(owner)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], kyc.IDENTITY_NOT_PENDING)
