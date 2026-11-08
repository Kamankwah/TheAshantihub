"""Listings stop waiting on `kyc_status` (self-serve phase 2, Task 3): a business that is live (golive) may submit
listings, and staff may approve them, whatever its KYC decision says. A business that is not live is refused at the
submit door with the blockers named, and staff cannot approve its listing."""
from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import golive
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser
from listings.models import Category, HeroMediaSubmission, Listing, Zone
from listings.moderation_checks import hero_checks, promotion_checks
from otp.models import EMAIL, VerifiedContact


def make_owner(phone, *, email="ama@example.com", confirmed=True, kyc=BusinessOwner.PENDING):
    owner = BusinessOwner.objects.create(
        full_name="Ama Trader", login_phone=phone, password_hash="x", email=email, kyc_status=kyc,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_contact_phone=phone, business_kind="service",
        lat=Decimal("6.690000"), lng=Decimal("-1.620000"), terms_accepted_at=timezone.now(),
    )
    if confirmed:
        VerifiedContact.objects.create(
            account_type="business_owner", account_id=owner.pk, channel=EMAIL, destination=email.lower(),
        )
    return BusinessOwner.objects.get(pk=owner.pk)


class GoLiveGateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-golive@example.com", password_hash="x",
            role=Role.objects.get(name="operations"),
        )

    def draft(self, owner, status=Listing.DRAFT):
        return Listing.objects.create(price_amount="10.00",
            business_owner=owner, category=self.hotels, zone=self.manhyia, name="Lodge", description="D.",
            contact_phone=owner.login_phone, status=status,
        )

    def as_(self, who, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who, kind)}")

    def submit(self, owner, listing):
        self.as_(owner, "business_owner")
        return self.client.post(f"/api/listings/mine/{listing.pk}/submit/")

    def test_unconfirmed_owner_cannot_submit(self):
        owner = make_owner("+233241450001", confirmed=False)
        listing = self.draft(owner)
        response = self.submit(owner, listing)
        self.assertEqual(response.status_code, 403, response.content)
        body = response.json()
        self.assertEqual(body["code"], "not_live")
        self.assertEqual(body["detail"], golive.MESSAGES["email_unconfirmed"])
        self.assertEqual(body["blockers"], [{"code": "email_unconfirmed", "message": golive.MESSAGES["email_unconfirmed"]}])
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.DRAFT)

    def test_unconfirmed_owner_cannot_resubmit_a_rejected_listing(self):
        owner = make_owner("+233241450002", confirmed=False)
        listing = self.draft(owner, status=Listing.REJECTED)
        response = self.submit(owner, listing)
        self.assertEqual((response.status_code, response.json()["code"]), (403, "not_live"))
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.REJECTED)

    def test_kyc_rejected_owner_cannot_submit(self):
        owner = make_owner("+233241450010", kyc=BusinessOwner.REJECTED)
        listing = self.draft(owner)
        response = self.submit(owner, listing)
        self.assertEqual(response.status_code, 403, response.content)
        body = response.json()
        self.assertEqual(body["code"], "not_live")
        self.assertEqual(body["blockers"], [{"code": "kyc_rejected", "message": golive.MESSAGES["kyc_rejected"]}])
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.DRAFT)

    def test_confirmed_pinned_owner_submits_to_pending_review(self):
        owner = make_owner("+233241450003")
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)
        listing = self.draft(owner)
        response = self.submit(owner, listing)
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PENDING_REVIEW)

    def test_staff_can_approve_when_owner_live_but_kyc_pending(self):
        owner = make_owner("+233241450004")
        listing = self.draft(owner, status=Listing.PENDING_REVIEW)
        self.as_(self.admin, "staff")
        response = self.client.post(f"/api/listings/moderation/{listing.pk}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PUBLISHED)

    def test_staff_cannot_approve_when_owner_not_live(self):
        owner = make_owner("+233241450005", confirmed=False)
        listing = self.draft(owner, status=Listing.PENDING_REVIEW)
        self.as_(self.admin, "staff")
        response = self.client.post(f"/api/listings/moderation/{listing.pk}/approve/")
        self.assertEqual(response.status_code, 400, response.content)
        body = response.json()
        self.assertEqual(body["code"], "not_live")
        # Staff are told in staff words, not the owner's "Open the link we emailed you" sentence.
        self.assertEqual(body["detail"], "This business is not live yet: email not confirmed.")
        self.assertNotIn("emailed you", body["detail"])
        self.assertEqual(body["blockers"], [{"code": "email_unconfirmed", "message": golive.MESSAGES["email_unconfirmed"]}])
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PENDING_REVIEW)

    def test_staff_refusal_names_every_blocker_briefly(self):
        owner = make_owner("+233241450011", kyc=BusinessOwner.REJECTED, confirmed=False)
        listing = self.draft(owner, status=Listing.PENDING_REVIEW)
        self.as_(self.admin, "staff")
        response = self.client.post(f"/api/listings/moderation/{listing.pk}/approve/")
        self.assertEqual(response.status_code, 400, response.content)
        body = response.json()
        self.assertEqual(body["code"], "not_live")
        self.assertEqual(
            body["detail"],
            "This business is not live yet: email not confirmed; application rejected, waiting for the owner's changes.",
        )
        self.assertEqual([b["code"] for b in body["blockers"]], ["email_unconfirmed", "kyc_rejected"])

    def test_staff_can_approve_a_kyc_verified_owner_with_no_email(self):
        owner = BusinessOwner.objects.create(
            full_name="Old Trader", login_phone="+233241450006", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        listing = self.draft(owner, status=Listing.PENDING_REVIEW)
        self.as_(self.admin, "staff")
        self.assertEqual(self.client.post(f"/api/listings/moderation/{listing.pk}/approve/").status_code, 200)

    def test_hero_and_promotion_checks_still_carry_the_kyc_check(self):
        # Promotions and hero slides still need the Verified (KYC) tier, so a business that is live but whose KYC is
        # pending must read FAIL on "Business verified (KYC)" there; going live does not change that display.
        owner = make_owner("+233241450007")
        self.assertTrue(golive.is_live(owner))
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)
        listing = self.draft(owner, status=Listing.PUBLISHED)
        submission = HeroMediaSubmission.objects.create(
            business_owner=owner, listing=listing, title="Lodge", caption="Lovely rooms",
            media=SimpleUploadedFile("hero.jpg", b"x", content_type="image/jpeg"),
        )
        promotion = type("P", (), {"listing": listing})()
        for checks in (hero_checks(submission), promotion_checks(promotion)):
            keys = [c["key"] for c in checks]
            self.assertIn("kyc", keys)
            self.assertNotIn("live", keys)
            kyc = next(c for c in checks if c["key"] == "kyc")
            self.assertEqual((kyc["label"], kyc["status"]), ("Business verified (KYC)", "fail"))

    def test_submit_and_approve_do_not_read_the_kyc_check(self):
        # The doors go by golive alone: a live owner whose KYC is still pending passes both; the KYC check
        # (a display only) is never consulted. (A KYC-rejected owner is not live, so it is refused at both doors.)
        owner = make_owner("+233241450008")
        with patch("listings.moderation_checks._kyc_check", side_effect=AssertionError("read the KYC check")):
            listing = self.draft(owner)
            self.assertEqual(self.submit(owner, listing).status_code, 200)
            self.as_(self.admin, "staff")
            response = self.client.post(f"/api/listings/moderation/{listing.pk}/approve/")
            self.assertEqual(response.status_code, 200, response.content)
