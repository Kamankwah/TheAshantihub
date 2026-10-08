from django.apps import apps
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import registry
from approvals import services as approvals
from fraud import services as fraud
from fraud.models import FraudFlag
from notifications.models import Notification
from portfolio.approval_kinds import BUSINESS_KYC, KINDS


class KycKindRegistrationTests(TestCase):
    def test_business_kyc_is_registered_at_startup(self):
        self.assertIn(BUSINESS_KYC, KINDS)
        kind = registry.get_kind("business.kyc")
        self.assertIs(kind, BUSINESS_KYC)
        self.assertEqual(
            (kind.label, kind.pool_permission, kind.response_hours), ("New business (KYC)", "kyc.approve", 24),
        )

    def test_ready_can_run_twice(self):
        apps.get_app_config("portfolio").ready()
        self.assertIs(registry.get_kind("business.kyc"), BUSINESS_KYC)


class KycKindTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = BusinessOwner.objects.create(
            full_name="Adwoa Mensah", login_phone="+233244123118", password_hash="x",
            registration_channel=BusinessOwner.SCOUT, registered_by=self.scout, account_manager=self.scout,
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner, business_name="Adwoa Fabrics", gps_address="AK-039-5028",
            business_contact_phone="+233244123118", address_verified=True, address_verified_by=self.lead,
            address_verified_at=timezone.now(),
        )
        self.approval = self.submit(self.owner)

    def submit(self, owner):
        return approvals.submit(
            self.scout, "business.kyc", target=owner, title=f"New business: {owner.display_name}",
            payload={"business_owner_id": owner.pk},
        )

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def test_the_request_waits_for_the_scouts_lead_and_snapshots_only_the_kyc_status(self):
        self.assertEqual((self.approval.stage, self.approval.assigned_to), ("manager", self.lead))
        self.assertEqual(self.approval.before, {"kyc_status": "pending"})
        self.assertEqual((self.approval.target_type, self.approval.target_id), ("accounts.businessowner", str(self.owner.pk)))

    def test_approving_in_the_inbox_verifies_the_owner_once_as_the_decider(self):
        self.as_(self.lead)
        response = self.client.post(
            f"/api/approvals/{self.approval.id}/approve/", {"note": "Pin and signboard match"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.owner.refresh_from_db()
        self.assertEqual((self.owner.kyc_status, self.owner.reviewed_by), ("verified", self.lead))
        self.assertEqual(Notification.objects.filter(business_owner=self.owner, kind="kyc_approved").count(), 1)
        event = ActivityEvent.objects.get(verb="kyc-approve")
        self.assertEqual((event.actor_id, event.after), (self.lead.id, {"via": "approval", "approval_id": self.approval.id}))
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.approved", actor_id=self.lead.id).exists())
        queue = self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/", {}, format="json")
        self.assertEqual(queue.status_code, 400)
        self.assertEqual(queue.json(), {"detail": "This business has already been decided."})

    def test_the_address_decision_comes_first(self):
        BusinessOwnerProfile.objects.filter(pk=self.profile.pk).update(
            address_verified=False, address_verified_by=None, address_verified_at=None,
        )
        self.as_(self.lead)
        response = self.client.post(f"/api/approvals/{self.approval.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Record the Ghana Post address decision first."})
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, "pending")

    def test_an_open_self_dealing_case_holds_the_request(self):
        flag = fraud.raise_flag(
            FraudFlag.SELF_DEALING, title="Adwoa Fabrics · owner phone matches a staff member",
            business_owner=self.owner, staff_subject=self.scout,
        )
        with self.assertRaises(approvals.ApprovalError) as raised:
            approvals.approve(self.approval.pk, self.lead)
        self.assertEqual(raised.exception.message, "Decide the self-dealing case in Fraud cases first.")
        self.approval.refresh_from_db()
        self.assertEqual(self.approval.status, "pending")
        fraud.dismiss(flag.pk, self.boss, note="Her own phone; the match was a typo in the staff profile")
        approvals.approve(self.approval.pk, self.lead)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, "verified")

    def test_a_business_not_waiting_for_kyc_is_refused(self):
        rejected = BusinessOwner.objects.create(
            full_name="Kofi Mensah", login_phone="+233201112223", password_hash="x", kyc_status=BusinessOwner.REJECTED,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=rejected, business_name="Kofi Spares", address_verified=True, address_verified_at=timezone.now(),
        )
        approval = self.submit(rejected)
        with self.assertRaises(approvals.ApprovalError) as raised:
            approvals.approve(approval.pk, self.lead)
        self.assertEqual(raised.exception.message, "This business isn't waiting for KYC any more.")

    def test_a_decision_made_outside_the_engine_makes_the_request_stale(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.VERIFIED)
        with self.assertRaises(approvals.StaleRequest) as raised:
            approvals.approve(self.approval.pk, self.lead)
        self.assertEqual(raised.exception.status_code, 409)

    def test_returning_the_request_leaves_the_owner_pending(self):
        approvals.reject(self.approval.pk, self.lead, note="Retake the signboard photo in daylight")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, "pending")
        self.assertFalse(Notification.objects.filter(business_owner=self.owner).exists())

    def test_the_diff_reads_in_plain_words(self):
        self.assertEqual(approvals.diff_rows(self.approval), [
            {"field": "Business", "before": None, "after": "Adwoa Fabrics"},
            {"field": "Owner", "before": None, "after": "Adwoa Mensah · +233244123118"},
            {"field": "Registered by", "before": None, "after": "Kwame"},
            {"field": "Ghana Post address", "before": None, "after": "AK-039-5028 · verified"},
        ])
        BusinessOwnerProfile.objects.filter(pk=self.profile.pk).update(address_verified=False, address_verified_at=None)
        self.assertEqual(approvals.diff_rows(self.approval)[3]["after"], "AK-039-5028 · not checked yet")
        BusinessOwnerProfile.objects.filter(pk=self.profile.pk).update(address_verified=False, address_verified_at=timezone.now())
        self.assertEqual(approvals.diff_rows(self.approval)[3]["after"], "AK-039-5028 · marked wrong")

    def test_the_inbox_shows_the_kind_and_the_diff(self):
        self.as_(self.lead)
        body = self.client.get(f"/api/approvals/{self.approval.id}/").json()
        self.assertEqual((body["kind"], body["kind_label"], body["stale"]), ("business.kyc", "New business (KYC)", False))
        self.assertEqual(body["diff"][0], {"field": "Business", "before": None, "after": "Adwoa Fabrics"})
