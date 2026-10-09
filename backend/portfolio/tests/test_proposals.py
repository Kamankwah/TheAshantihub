"""Scout-proposed changes (Task 9): staging photos and proposing detail
changes, new listings and listing photos through the API, and the
Add-a-product form's options."""
from datetime import timedelta
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from activity.models import ActivityEvent
from approvals.models import ApprovalRequest
from billing.models import Subscription
from listings.models import Category, Listing, Zone
from portfolio import proposals
from portfolio.models import AppliedChange, StagedPhoto
from portfolio.tests.change_fixtures import ChangeTestBase, jpeg, make_business, make_listing, product_body


class PhotoStageTests(ChangeTestBase):
    def url(self, owner=None):
        return f"/api/portfolio/businesses/{(owner or self.owner).pk}/photos/"

    def test_the_account_manager_stages_a_photo_with_where_it_was_taken(self):
        self.as_staff(self.scout)
        response = self.client.post(
            self.url(), {"image": jpeg(), "lat": "6.7001234", "lng": "-1.6100049", "accuracy_m": "8.6"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(set(body), {"id", "url", "created_at"})
        photo = StagedPhoto.objects.get(pk=body["id"])
        self.assertEqual((photo.business_owner, photo.uploaded_by, photo.used_at), (self.owner, self.scout, None))
        self.assertEqual(
            (photo.taken_lat, photo.taken_lng, photo.taken_accuracy_m),
            (Decimal("6.700123"), Decimal("-1.610005"), 9),
        )
        self.assertTrue(body["url"].endswith(photo.image.url))
        event = ActivityEvent.objects.order_by("-id").first()
        self.assertEqual(
            (event.verb, event.actor_id, event.target_id),
            ("portfolio.photo_staged", self.scout.pk, str(self.owner.pk)),
        )

    def test_a_photo_without_a_location_is_still_staged(self):
        self.as_staff(self.scout)
        response = self.client.post(self.url(), {"image": jpeg()}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(StagedPhoto.objects.get(pk=response.json()["id"]).taken_lat)

    def test_only_an_image_is_accepted(self):
        self.as_staff(self.scout)
        not_an_image = SimpleUploadedFile("notes.jpg", b"not an image", content_type="image/jpeg")
        response = self.client.post(self.url(), {"image": not_an_image}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("image", response.json())
        self.assertFalse(StagedPhoto.objects.exists())

    def test_only_the_account_manager_can_stage(self):
        self.as_staff(self.other_scout)
        self.assertEqual(self.client.post(self.url(), {"image": jpeg()}, format="multipart").status_code, 404)
        self.as_staff(self.lead)  # Operations doesn't hold businesses.manage_portfolio
        self.assertEqual(self.client.post(self.url(), {"image": jpeg()}, format="multipart").status_code, 403)
        self.assertFalse(StagedPhoto.objects.exists())


class ProposeChangeApiTests(ChangeTestBase):
    def post(self, fields, reason="Owner asked at the visit", owner=None):
        return self.client.post(
            f"/api/portfolio/businesses/{(owner or self.owner).pk}/changes/",
            {"fields": fields, "reason": reason}, format="json",
        )

    def test_a_change_goes_to_the_scouts_lead(self):
        self.as_staff(self.scout)
        response = self.post({"business_name": "Abena Kente Palace", "opening_hours": "Mon–Sun 7am–8pm"})
        self.assertEqual(response.status_code, 201, response.content)
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual(response.json(), {"approval_id": approval.pk, "approver_name": "Ama", "status": "pending"})
        self.assertEqual(
            (approval.kind, approval.stage, approval.assigned_to, approval.pool_permission),
            ("business.update", "manager", self.lead, "portfolio.manage"),
        )
        self.assertEqual(approval.payload, {
            "business_owner_id": self.owner.pk,
            "reason": "Owner asked at the visit",
            "fields": {"business_name": "Abena Kente Palace", "opening_hours": "Mon–Sun 7am–8pm"},
        })
        self.assertEqual(approval.before, {"business_name": "Abena Kente House", "opening_hours": "Mon–Sat 8am–6pm"})
        self.assertEqual(approval.maker_note, "Owner asked at the visit")
        self.assertEqual(
            (approval.target_type, approval.target_id, approval.target_label),
            ("accounts.businessowner", str(self.owner.pk), "Abena Kente House"),
        )
        self.assertEqual(ActivityEvent.objects.order_by("-id").first().verb, "business.change_proposed")
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.requested").exists())
        self.assertFalse(ActivityEvent.objects.filter(verb="portfolio-propose-change").exists())
        self.owner.profile.refresh_from_db()
        self.assertEqual(self.owner.profile.business_name, "Abena Kente House")  # nothing changes until approval

    def unclaim(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=None)

    def test_phones_are_stored_in_one_form(self):
        self.unclaim()
        self.as_staff(self.scout)
        response = self.post({"login_phone": "024 555 0101", "business_contact_phone": "0555123456"})
        self.assertEqual(response.status_code, 201, response.content)
        fields = ApprovalRequest.objects.get(pk=response.json()["approval_id"]).payload["fields"]
        self.assertEqual(fields, {"login_phone": "+233245550101", "business_contact_phone": "+233555123456"})

    def test_a_phone_written_differently_is_still_a_duplicate(self):
        self.unclaim()
        BusinessOwner.objects.create(full_name="Yaa Asantewaa", login_phone="0245550101", password_hash="x")
        self.as_staff(self.scout)
        response = self.post({"login_phone": "+233 24 555 0101"})
        self.assertEqual((response.status_code, response.json()), (400, {"login_phone": [proposals.DUPLICATE_PHONE]}))
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_address_and_email_duplicates_are_refused(self):
        self.unclaim()
        make_business(self.other_scout, phone="+233244900900", name="Kofi Spare Parts", gps="AK-100-2000",
                      email="kofi@example.com")
        self.as_staff(self.scout)
        response = self.post({"gps_address": "ak-100-2000", "email": "KOFI@example.com"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"gps_address": [proposals.DUPLICATE_GPS], "email": [proposals.DUPLICATE_EMAIL]})

    def test_sign_in_details_only_before_the_owner_has_a_login(self):
        self.as_staff(self.scout)
        claimed = self.post({"email": "me@example.com", "login_phone": "0245550101"})
        self.assertEqual((claimed.status_code, claimed.json()), (400, {
            "email": ["Sign-in email is changed by the owner once they have a login."],
            "login_phone": ["Sign-in phone is changed by the owner once they have a login."],
        }))
        self.unclaim()
        self.assertEqual(self.post({"email": "me@example.com", "login_phone": "0245550101"}).status_code, 201)

    def test_the_business_phone_is_editable_after_claim(self):
        self.as_staff(self.scout)
        self.assertEqual(self.post({"business_contact_phone": "0555123456"}).status_code, 201)

    def test_a_staff_email_or_phone_is_refused(self):
        make_staff("accountant", "Pat@Example.com", phone="0201112223")
        self.unclaim()
        self.as_staff(self.scout)
        self.assertEqual(self.post({"email": "pat@example.com"}).json(),
                         {"email": [proposals.STAFF_EMAIL]})
        self.assertEqual(self.post({"login_phone": "+233 20 111 2223"}).json(),
                         {"login_phone": [proposals.STAFF_PHONE]})
        self.assertEqual(self.post({"business_contact_phone": "0201112223"}).json(),
                         {"business_contact_phone": [proposals.STAFF_PHONE]})
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_bad_values_are_explained(self):
        self.as_staff(self.scout)
        response = self.post({"business_name": "  ", "login_phone": "12345", "gps_address": "XX-1", "zone_id": 99999})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {
            "business_name": ["This can't be empty."],
            "login_phone": ["Enter a Ghana phone number, for example 024 123 4567."],
            "gps_address": ["Enter a valid Ghana Post GPS address, e.g. AK-039-5028."],
            "zone_id": ["Choose an area from the list."],
        })

    def test_payout_details_are_never_accepted(self):
        self.as_staff(self.scout)
        response = self.post({"payout_momo_number": "0241112223", "business_name": "New name"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {
            "payout_momo_number": [
                "Payout details can't be changed by scouts. The owner changes them in their dashboard."
            ],
        })
        self.assertEqual(self.post({"kyc_status": "verified"}).json(), {"kyc_status": [proposals.NOT_EDITABLE]})
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_a_change_needs_a_reason_and_a_real_difference(self):
        self.as_staff(self.scout)
        self.assertEqual(self.post({"business_name": "Abena Kente House"}).json(), {"fields": [proposals.NOTHING_CHANGED]})
        self.assertEqual(self.post({}).json(), {"fields": [proposals.NO_FIELDS]})
        self.assertEqual(self.post({"business_name": "Abena Fabrics"}, reason="  ").json(),
                         {"reason": [proposals.REASON_REQUIRED]})

    def test_a_rough_pin_is_refused_unless_placed_by_hand(self):
        self.as_staff(self.scout)
        response = self.post({"lat": 6.7012341, "lng": -1.6200001, "location_accuracy_m": 250})
        self.assertEqual(response.json(), {
            "location_accuracy_m": ["Location too rough: ±250 m. Try again, or place the pin by hand."],
        })
        response = self.post({"lat": 6.7012341, "lng": -1.6200001, "location_is_manual": True})
        self.assertEqual(response.status_code, 201, response.content)
        fields = ApprovalRequest.objects.get(pk=response.json()["approval_id"]).payload["fields"]
        self.assertEqual(fields, {
            "lat": "6.701234", "lng": "-1.620000", "location_accuracy_m": None, "location_is_manual": True,
        })

    def test_a_pin_outside_ghana_is_refused(self):
        self.as_staff(self.scout)
        response = self.post({"lat": 51.5, "lng": -0.12, "location_accuracy_m": 5})
        self.assertEqual(response.json(), {"lat": ["That pin isn't in Ghana — check the location and try again."]})

    def test_only_the_account_manager_can_propose(self):
        self.as_staff(self.other_scout)
        self.assertEqual(self.post({"business_name": "Mine now"}).status_code, 404)
        self.as_staff(self.lead)
        self.assertEqual(self.post({"business_name": "Mine now"}).status_code, 403)
        with self.assertRaisesMessage(PermissionDenied, "Only the business's account manager can propose changes."):
            proposals.propose_update(self.other_scout, self.owner, {"business_name": "Mine now"}, reason="Owner asked")
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_a_super_admins_own_proposal_applies_at_once(self):
        boss = make_staff("super_admin", "boss@example.com")
        theirs = make_business(boss, phone="+233244900900", name="Kofi Spare Parts", gps="AK-100-2000")
        self.as_staff(boss)
        response = self.post({"business_name": "Kofi Auto Parts"}, owner=theirs)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], "approved")  # the form says "Applied", not "Sent to …"
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual(BusinessOwnerProfile.objects.get(business_owner=theirs).business_name, "Kofi Auto Parts")
        self.assertTrue(AppliedChange.objects.filter(approval=approval).exists())


class ProposeListingApiTests(ChangeTestBase):
    def post(self, listing=None, *, main=None, photos=(), reason="Owner showed me the stock"):
        return self.client.post(
            f"/api/portfolio/businesses/{self.owner.pk}/listings/",
            {"listing": listing if listing is not None else product_body(), "main_photo_id": main,
             "photo_ids": list(photos), "reason": reason},
            format="json",
        )

    def test_a_new_product_goes_for_approval(self):
        main, extra = self.staged(), self.staged()
        self.as_staff(self.scout)
        response = self.post(main=main.pk, photos=[extra.pk])
        self.assertEqual(response.status_code, 201, response.content)
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual((response.json()["approver_name"], response.json()["status"]), ("Ama", "pending"))
        self.assertEqual(
            (approval.kind, approval.assigned_to, approval.target_id),
            ("listing.create", self.lead, str(self.owner.pk)),
        )
        self.assertEqual(approval.payload["business_owner_id"], self.owner.pk)
        self.assertEqual(approval.payload["reason"], "Owner showed me the stock")
        self.assertEqual((approval.payload["main_photo_id"], approval.payload["photo_ids"]), (main.pk, [extra.pk]))
        self.assertEqual(approval.payload["listing"]["name"], "Kente stole")
        self.assertEqual(approval.before, {"business_owner_id": self.owner.pk})
        self.assertEqual(approval.title, "New product: Kente stole — Abena Kente House")
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())
        self.assertEqual(ActivityEvent.objects.order_by("-id").first().verb, "business.change_proposed")

    def test_the_business_needs_approved_kyc(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.PENDING)
        self.as_staff(self.scout)
        response = self.post()
        self.assertEqual((response.status_code, response.json()), (400, {"business": ["Approve the business's KYC first."]}))

    def test_a_paused_subscription_is_refused(self):
        now = timezone.now()
        Subscription.objects.filter(business_owner=self.owner).update(
            current_period_end=now - timedelta(days=16), overdue_since=now - timedelta(days=16),
            paused_at=now - timedelta(days=2),
        )
        self.as_staff(self.scout)
        self.assertEqual(self.post().json(), {"subscription": [proposals.SUBSCRIPTION_PAUSED]})

    def test_an_ended_subscription_and_a_full_plan_are_refused_in_scout_words(self):
        for n in range(5):
            make_listing(self.owner, name=f"Stole {n}")
        self.as_staff(self.scout)
        self.assertEqual(self.post().json(), {"max_active_listings": [proposals.LISTING_LIMIT]})
        Subscription.objects.filter(business_owner=self.owner).update(current_period_end=timezone.now() - timedelta(hours=1))
        self.assertEqual(self.post().json(), {"subscription": [proposals.SUBSCRIPTION_INACTIVE]})

    def test_the_owners_listing_rules_apply(self):
        self.as_staff(self.scout)
        body = product_body()
        del body["has_warranty"]
        self.assertEqual(self.post(body).json(), {"has_warranty": ["State whether this product comes with a warranty."]})
        hotels = product_body(category=Category.objects.get(slug="hotels").id)
        self.assertEqual(self.post(hotels).json(), {"category": ["This business is registered for product listings only."]})
        self.assertIn("name", self.post(product_body(name="")).json())
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_the_contact_phone_is_stored_in_one_form_and_never_a_staff_phone(self):
        self.as_staff(self.scout)
        response = self.post(product_body(contact_phone="024 555 0101"))
        self.assertEqual(response.status_code, 201, response.content)
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual(approval.payload["listing"]["contact_phone"], "+233245550101")
        self.assertEqual(
            self.post(product_body(contact_phone="12345")).json(),
            {"contact_phone": ["Enter a Ghana phone number, for example 024 123 4567."]},
        )
        make_staff("accountant", "pat@example.com", phone="0201112223")
        self.assertEqual(
            self.post(product_body(contact_phone="+233 20 111 2223")).json(), {"contact_phone": [proposals.STAFF_PHONE]},
        )
        self.assertEqual(ApprovalRequest.objects.count(), 1)

    def test_a_staff_contact_phone_added_after_the_proposal_is_refused_at_approval(self):
        self.as_staff(self.scout)
        approval_id = self.post(product_body(contact_phone="0201112223")).json()["approval_id"]
        make_staff("accountant", "pat@example.com", phone="0201112223")
        self.as_staff(self.lead)
        response = self.client.post(f"/api/approvals/{approval_id}/approve/", {}, format="json")
        self.assertEqual((response.status_code, response.json()["detail"]), (400, proposals.STAFF_PHONE))
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())

    def test_photos_must_be_this_businesss_unused_ones(self):
        other = make_business(self.other_scout, phone="+233244900900", name="Kofi Spare Parts", gps="AK-100-2000")
        theirs = self.staged(owner=other, by=self.other_scout)
        used = self.staged()
        StagedPhoto.objects.filter(pk=used.pk).update(used_at=timezone.now())
        self.as_staff(self.scout)
        self.assertEqual(self.post(photos=[theirs.pk]).json(), {"photo_ids": [proposals.PHOTOS_UNAVAILABLE]})
        self.assertEqual(self.post(main=used.pk).json(), {"photo_ids": [proposals.PHOTOS_UNAVAILABLE]})
        too_many = [self.staged().pk for _ in range(proposals.MAX_PHOTOS + 1)]
        self.assertEqual(self.post(photos=too_many).json(), {"photo_ids": [proposals.TOO_MANY_PHOTOS]})
        self.assertFalse(ApprovalRequest.objects.exists())


class ProposePhotosApiTests(ChangeTestBase):
    def setUp(self):
        super().setUp()
        self.listing = make_listing(self.owner)

    def post(self, photos, listing=None, reason="Better light today"):
        return self.client.post(
            f"/api/portfolio/listings/{(listing or self.listing).pk}/photos/",
            {"photo_ids": photos, "reason": reason}, format="json",
        )

    def test_photos_for_a_listing_go_for_approval(self):
        first, second = self.staged(), self.staged()
        self.as_staff(self.scout)
        response = self.post([first.pk, second.pk])
        self.assertEqual(response.status_code, 201, response.content)
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual(response.json(), {"approval_id": approval.pk, "approver_name": "Ama", "status": "pending"})
        self.assertEqual(
            (approval.kind, approval.target_type, approval.target_id),
            ("listing.photos", "listings.listing", str(self.listing.pk)),
        )
        self.assertEqual(approval.payload, {
            "business_owner_id": self.owner.pk, "reason": "Better light today",
            "listing_id": self.listing.pk, "photo_ids": [first.pk, second.pk],
        })
        self.assertEqual(approval.before, {"listing_id": self.listing.pk})
        self.assertEqual(approval.title, "2 photos for Kente stole — Abena Kente House")

    def test_at_least_one_photo(self):
        self.as_staff(self.scout)
        self.assertEqual(self.post([]).json(), {"photo_ids": [proposals.NO_PHOTOS]})

    def test_another_businesss_listing_is_not_found(self):
        other = make_business(self.other_scout, phone="+233244900900", name="Kofi Spare Parts", gps="AK-100-2000")
        self.as_staff(self.scout)
        self.assertEqual(self.post([self.staged().pk], listing=make_listing(other)).status_code, 404)


class ListingFormMetaTests(ChangeTestBase):
    def test_the_add_a_product_form_options(self):
        self.as_staff(self.scout)
        response = self.client.get(f"/api/portfolio/meta/listing-form/?business={self.owner.pk}")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        names = {category["name"] for category in body["categories"]}
        self.assertIn("Shops", names)
        self.assertNotIn("Hotels", names)  # a product business only sees product categories
        self.assertIn({"id": Zone.objects.get(name="Adum").id, "name": "Adum"}, body["zones"])
        self.assertEqual(set(body["required_answers"]), {"has_warranty", "has_expiry", "return_policy"})
        self.assertEqual((body["business_kind"], body["max_photos"]), ("product", proposals.MAX_PHOTOS))

    def test_someone_elses_business_and_a_missing_business(self):
        self.as_staff(self.other_scout)
        self.assertEqual(self.client.get(f"/api/portfolio/meta/listing-form/?business={self.owner.pk}").status_code, 404)
        self.assertEqual(self.client.get("/api/portfolio/meta/listing-form/").status_code, 400)
        # "²" is a digit to str.isdigit() but not a number int() reads.
        self.assertEqual(self.client.get("/api/portfolio/meta/listing-form/?business=²").status_code, 400)
