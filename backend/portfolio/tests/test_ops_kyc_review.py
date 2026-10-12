"""OP-2: the KYC review shows the owner's phone masked; the full number is one
recorded, password-confirmed step away. The KYC approval says what Approve does."""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.phones import mask_phone
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import services as approvals
from commission.models import CommissionPolicy


class MaskPhoneTests(TestCase):
    def test_masks_the_middle(self):
        self.assertEqual(mask_phone("+233244125531"), "024 *** 5531")
        self.assertEqual(mask_phone("0244125531"), "024 *** 5531")
        self.assertEqual(mask_phone("12"), "•••")


class OpsKycReviewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = BusinessOwner.objects.create(
            full_name="Nana Adwoa", login_phone="+233244125531", password_hash="x",
            registration_channel=BusinessOwner.SCOUT, registered_by=self.scout, account_manager=self.scout,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, business_name="Nana's Chop Bar", gps_address="AK-039-5128",
            address_verified=True, address_verified_by=self.lead, address_verified_at=timezone.now(),
        )

    def as_(self, staff, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, **kwargs)}")

    def test_the_review_sheet_masks_the_login_phone(self):
        self.as_(self.lead)
        sheet = self.client.get(f"/api/portfolio/businesses/{self.owner.id}/review/").json()
        self.assertEqual(sheet["owner"]["login_phone"], "024 *** 5531")

    def test_the_kyc_queue_masks_the_login_phone(self):
        self.as_(self.lead)
        row = self.client.get("/api/accounts/kyc/pending/").json()[0]
        self.assertEqual(row["login_phone"], "024 *** 5531")
        detail = self.client.get(f"/api/accounts/kyc/{self.owner.id}/").json()
        self.assertEqual(detail["login_phone"], "024 *** 5531")

    def test_revealing_needs_the_password_and_is_recorded_without_the_number(self):
        url = f"/api/portfolio/businesses/{self.owner.id}/reveal-phone/"
        self.as_(self.lead)
        refused = self.client.post(url)
        self.assertEqual((refused.status_code, refused.json()["code"]), (403, "sudo_required"))
        self.assertFalse(ActivityEvent.objects.filter(verb="business.phone_revealed").exists())
        self.as_(self.lead, sudo=True)
        shown = self.client.post(url)
        self.assertEqual((shown.status_code, shown.json()), (200, {"login_phone": "+233244125531"}))
        event = ActivityEvent.objects.get(verb="business.phone_revealed")
        self.assertEqual(event.actor_id, self.lead.id)
        self.assertNotIn("4125531", f"{event.summary} {event.before} {event.after}")

    def test_support_cannot_reveal(self):
        support = make_staff("support", "esi@example.com")
        self.as_(support, sudo=True)
        self.assertEqual(self.client.post(f"/api/portfolio/businesses/{self.owner.id}/reveal-phone/").status_code, 403)

    def test_the_request_names_what_approve_does(self):
        CommissionPolicy.objects.create(
            kind=CommissionPolicy.REGISTRATION, amount="50.00", effective_from="2026-01-01", proposed_by=self.lead, approved_by=self.lead,
        )
        approval = approvals.submit(
            self.scout, "business.kyc", target=self.owner, title="New business", payload={"business_owner_id": self.owner.pk},
        )
        self.as_(self.lead)
        detail = self.client.get(f"/api/approvals/{approval.id}/").json()
        self.assertEqual(detail["consequences"][0], "The business is verified and can go live.")
        self.assertEqual(detail["consequences"][1], "It counts toward Kwame's registrations today.")
        self.assertIn("GH₵ 50.00", detail["consequences"][2])
        self.assertIn("on hold until", detail["consequences"][2])
        owner_row = next(r for r in detail["diff"] if r["field"] == "Owner")
        self.assertIn("024 *** 5531", owner_row["after"])
        self.assertNotIn("4125531", owner_row["after"])

    def test_no_commission_line_without_an_approved_policy(self):
        approval = approvals.submit(
            self.scout, "business.kyc", target=self.owner, title="New business", payload={"business_owner_id": self.owner.pk},
        )
        self.as_(self.lead)
        lines = self.client.get(f"/api/approvals/{approval.id}/").json()["consequences"]
        self.assertFalse(any("commission" in line for line in lines))

    def test_week_stats(self):
        self.as_(self.lead)
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status="verified", reviewed_at=timezone.now())
        stats = self.client.get("/api/accounts/kyc/stats/").json()
        self.assertEqual(stats, {"week_verified": 1, "week_rejected": 0})
