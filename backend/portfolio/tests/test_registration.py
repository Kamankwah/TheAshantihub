import io
import tempfile
from decimal import Decimal
from unittest import mock

from django.contrib.auth.hashers import is_password_usable
from django.core.cache import cache
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals.models import ApprovalRequest
from approvals.services import reject
from fraud.models import FraudFlag
from listings.models import Category, Zone
from notifications.models import Notification
from portfolio.models import AccountManagerAssignment

TEST_MEDIA_ROOT = tempfile.mkdtemp()
REGISTER_URL = "/api/portfolio/register/"
CHECK_URL = "/api/portfolio/register/check/"
DUPLICATE = {"detail": "Already registered — ask Operations.", "code": "duplicate"}


def png(name):
    buffer = io.BytesIO()
    Image.new("RGB", (24, 24), (212, 160, 23)).save(buffer, "PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


def existing_business(name, *, phone, gps, lat=None, lng=None, momo=None, card=None, email=None):
    owner = BusinessOwner.objects.create(
        full_name=f"Owner of {name}", login_phone=phone, email=email, password_hash="x",
        kyc_status=BusinessOwner.VERIFIED,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name=name, gps_address=gps, business_contact_phone=phone,
        payout_momo_number=momo, ghana_card_number=card,
        lat=Decimal(lat) if lat else None, lng=Decimal(lng) if lng else None,
    )
    return owner


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class RegistrationBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.category = Category.objects.create(
            slug="test-hair-beauty", icon="💇", label="Hair & beauty", color="#D4A017", kind="service",
        )
        self.zone = Zone.objects.get_or_create(name="Asafo")[0]

    def as_(self, staff):
        token = staff_token(staff)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return token

    def form(self, **overrides):
        data = {
            "owner_full_name": "Gifty Asantewaa",
            "owner_phone": "0241234567",
            "owner_email": "gifty@example.com",
            "business_name": "Asafo Hair & Beauty",
            "business_kind": "service",
            "business_category": str(self.category.pk),
            "zone": str(self.zone.pk),
            "gps_address": "ak-112-0384",
            "lat": "6.688500",
            "lng": "-1.624400",
            "location_accuracy_m": "12",
            "location_is_manual": "false",
            "signboard_photo": png("signboard.png"),
            "ghana_card_front": png("card.png"),
            "ghana_card_number": "GHA-123456789-0",
            "maker_note": "Met Gifty at her salon",
        }
        data.update(overrides)
        return {key: value for key, value in data.items() if value is not None}

    def register(self, staff=None, **overrides):
        self.as_(staff or self.scout)
        return self.client.post(REGISTER_URL, self.form(**overrides), format="multipart")


class RegistrationTests(RegistrationBase):
    def test_a_scout_registers_a_business(self):
        response = self.register()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        owner = BusinessOwner.objects.get(pk=body["id"])
        approval = ApprovalRequest.objects.get(kind="business.kyc")
        self.assertEqual(body, {
            "id": owner.pk, "business_name": "Asafo Hair & Beauty", "approval_id": approval.pk,
            "approver_name": "Ama", "flags": [], "needs_claim": True,
        })
        # The owner: pending KYC, no usable password until they claim the login.
        self.assertEqual(
            (owner.full_name, owner.login_phone, owner.email, owner.kyc_status),
            ("Gifty Asantewaa", "+233241234567", "gifty@example.com", "pending"),
        )
        self.assertEqual(
            (owner.registration_channel, owner.registered_by, owner.account_manager),
            ("scout", self.scout, self.scout),
        )
        self.assertFalse(is_password_usable(owner.password_hash))
        self.assertIsNone(owner.claimed_at)
        # The profile.
        profile = BusinessOwnerProfile.objects.get(business_owner=owner)
        self.assertEqual(
            (profile.business_name, profile.business_kind, profile.business_category, profile.zone),
            ("Asafo Hair & Beauty", "service", self.category, self.zone),
        )
        self.assertEqual((profile.gps_address, profile.business_contact_phone), ("AK-112-0384", "+233241234567"))
        self.assertEqual((profile.lat, profile.lng), (Decimal("6.688500"), Decimal("-1.624400")))
        self.assertEqual(
            (profile.location_accuracy_m, profile.location_is_manual, profile.location_set_by), (12, False, "scout"),
        )
        self.assertIsNotNone(profile.location_set_at)
        self.assertEqual(profile.ghana_card_number, "GHA-123456789-0")
        self.assertTrue(profile.signboard_photo.name.startswith("signboards/"))
        self.assertTrue(profile.ghana_card_front_image.name.startswith("ghana_cards/"))
        self.assertFalse(profile.ghana_card_back_image)
        # The scout manages it from now on.
        assignment = AccountManagerAssignment.objects.get(business_owner=owner)
        self.assertEqual((assignment.scout, assignment.assigned_by, assignment.ended_at), (self.scout, self.scout, None))
        # The KYC request waits for the scout's Operations lead.
        self.assertEqual(
            (approval.maker, approval.stage, approval.assigned_to, approval.target_type, approval.target_id),
            (self.scout, "manager", self.lead, "accounts.businessowner", str(owner.pk)),
        )
        self.assertEqual(approval.payload, {"business_owner_id": owner.pk, "business_name": "Asafo Hair & Beauty"})
        self.assertEqual(approval.maker_note, "Met Gifty at her salon")
        self.assertTrue(Notification.objects.filter(staff=self.lead, kind="approval_waiting").exists())
        # Recorded once, last; the middleware adds nothing.
        self.assertEqual(
            list(ActivityEvent.objects.order_by("id").values_list("verb", flat=True)),
            ["approval.requested", "business.registered"],
        )
        event = ActivityEvent.objects.get(verb="business.registered")
        self.assertEqual(
            (event.actor_id, event.target_id, event.after),
            (self.scout.pk, str(owner.pk), {"business_name": "Asafo Hair & Beauty", "flags": []}),
        )

    def test_a_pin_placed_by_hand_needs_no_accuracy(self):
        response = self.register(location_accuracy_m=None, location_is_manual="true")
        self.assertEqual(response.status_code, 201, response.content)
        profile = BusinessOwnerProfile.objects.get(business_owner_id=response.json()["id"])
        self.assertEqual((profile.location_is_manual, profile.location_accuracy_m), (True, None))

    def test_a_rough_pin_is_accepted_once_it_is_placed_by_hand(self):
        response = self.register(location_accuracy_m="140", location_is_manual="true")
        self.assertEqual(response.status_code, 201, response.content)
        profile = BusinessOwnerProfile.objects.get(business_owner_id=response.json()["id"])
        self.assertEqual((profile.location_is_manual, profile.location_accuracy_m), (True, 140))

    def test_field_errors_come_back_per_field(self):
        exact_cases = [
            ({"owner_phone": "12345"}, {"owner_phone": ["Enter a Ghana phone number, for example 024 123 4567."]}),
            ({"lng": "2.5"}, {"lng": ["This pin isn't in Ghana. Check the location and try again."]}),
            ({"lat": "12.1"}, {"lat": ["This pin isn't in Ghana. Check the location and try again."]}),
            (
                {"location_accuracy_m": "140"},
                {"lat": ["Location isn't accurate enough (±140 m). Wait for a better fix, or place the pin by hand."]},
            ),
            (
                {"location_accuracy_m": None},
                {"location_accuracy_m": ["Say how accurate the location is, or place the pin by hand."]},
            ),
            ({"business_kind": "product"}, {"business_category": ["Choose a category for this kind of business."]}),
        ]
        for overrides, errors in exact_cases:
            with self.subTest(overrides=overrides):
                response = self.register(**overrides)
                self.assertEqual((response.status_code, response.json()), (400, errors))
        for overrides, field in [
            ({"gps_address": "GA-543-0125"}, "gps_address"),  # Greater Accra, not Ashanti
            ({"signboard_photo": None}, "signboard_photo"),
            ({"ghana_card_front": None}, "ghana_card_front"),
            ({"signboard_photo": SimpleUploadedFile("sign.png", b"not an image", content_type="image/png")}, "signboard_photo"),
        ]:
            with self.subTest(overrides=overrides):
                response = self.register(**overrides)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())
        existing_business("Adwoa Fabrics", phone="0201112223", gps="AK-039-5028", email="gifty@example.com")
        response = self.register()
        self.assertEqual(
            (response.status_code, response.json()),
            (400, {"owner_email": ["That email already belongs to another account."]}),
        )
        self.assertFalse(BusinessOwner.objects.filter(registration_channel="scout").exists())

    def test_a_staff_members_email_is_never_the_owners(self):
        # Password resets go to the owner's email, so a staff email there would
        # keep the business under that staff member's control after the claim.
        for email in ("kwame@example.com", "AMA@Example.com"):
            with self.subTest(email=email):
                response = self.register(owner_email=email)
                self.assertEqual(
                    (response.status_code, response.json()),
                    (400, {"owner_email": ["That email belongs to a staff member — ask Operations."]}),
                )
        self.assertFalse(BusinessOwner.objects.filter(registration_channel="scout").exists())

    def test_a_non_finite_or_absurd_accuracy_is_refused(self):
        for value in ("nan", "inf", "-inf", "Infinity"):
            with self.subTest(value=value):
                response = self.register(location_accuracy_m=value)
                self.assertEqual(
                    (response.status_code, response.json()), (400, {"location_accuracy_m": ["Enter a number."]}),
                )
        response = self.register(location_accuracy_m="100001", location_is_manual="true")
        self.assertEqual(response.status_code, 400)
        self.assertIn("location_accuracy_m", response.json())
        self.assertFalse(BusinessOwner.objects.filter(registration_channel="scout").exists())

    def test_a_body_that_is_not_a_set_of_fields_is_refused(self):
        self.as_(self.scout)
        response = self.client.post(REGISTER_URL, ["owner_phone", "0241234567"], format="json")
        self.assertEqual((response.status_code, response.json()), (400, {"detail": "Send the form's fields."}))

    def test_only_staff_who_register_businesses(self):
        response = self.register(staff=make_staff("support", "esi@example.com"))
        self.assertEqual(response.status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.post(REGISTER_URL, self.form(), format="multipart").status_code, 401)

    def test_a_super_admin_registration_waits_in_the_kyc_queue(self):
        boss = make_staff("super_admin", "boss@example.com")
        response = self.register(staff=boss)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual((response.json()["approval_id"], response.json()["approver_name"]), (None, None))
        self.assertFalse(ApprovalRequest.objects.exists())
        owner = BusinessOwner.objects.get(pk=response.json()["id"])
        self.assertEqual((owner.kyc_status, owner.registered_by), ("pending", boss))
        self.assertTrue(Notification.objects.filter(staff=self.lead, kind="kyc_needs_approval").exists())

    def test_an_operations_registration_goes_to_the_operations_pool_unassigned(self):
        kojo = make_staff("operations", "kojo@example.com")
        response = self.register(staff=kojo)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["approver_name"], "Operations")
        self.assertEqual(ApprovalRequest.objects.get().stage, "pool")
        owner = BusinessOwner.objects.get(pk=response.json()["id"])
        self.assertEqual((owner.registered_by, owner.account_manager), (kojo, None))
        self.assertFalse(AccountManagerAssignment.objects.exists())
        self.assertEqual(BusinessOwnerProfile.objects.get(business_owner=owner).location_set_by, "operations")


class RegistrationDuplicateTests(RegistrationBase):
    def test_phone_written_differently_is_still_a_duplicate(self):
        existing_business("Adwoa Fabrics", phone="0241234567", gps="AK-039-5028")
        response = self.register(owner_phone="+233 24 123 4567")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {**DUPLICATE, "matched": ["phone"]})
        self.assertNotIn("Adwoa", response.content.decode())  # never names the other business
        self.assertEqual(BusinessOwner.objects.count(), 1)
        self.assertFalse(ApprovalRequest.objects.exists())
        self.assertFalse(ActivityEvent.objects.filter(verb="business.registered").exists())

    def test_a_stored_phone_with_spaces_is_still_a_duplicate(self):
        existing_business("Adwoa Fabrics", phone="024 123 4567", gps="AK-039-5028")
        response = self.register(owner_phone="+233241234567")
        self.assertEqual((response.status_code, response.json()), (400, {**DUPLICATE, "matched": ["phone"]}))
        self.assertEqual(BusinessOwner.objects.count(), 1)

    def test_another_business_momo_number_blocks(self):
        existing_business("Adwoa Fabrics", phone="0201112223", gps="AK-039-5028", momo="0244000111")
        response = self.register(owner_phone="0244000111")
        self.assertEqual((response.status_code, response.json()), (400, {**DUPLICATE, "matched": ["phone"]}))

    def test_ghana_post_address_and_ghana_card_block(self):
        existing_business("Adwoa Fabrics", phone="0201112223", gps="AK-112-0384", card="GHA-123456789-0")
        response = self.register()
        self.assertEqual(
            (response.status_code, response.json()),
            (400, {**DUPLICATE, "matched": ["gps_address", "ghana_card"]}),
        )

    def test_a_registration_racing_another_is_still_refused(self):
        BusinessOwner.objects.create(full_name="Racer", login_phone="+233241234567", password_hash="x")
        with mock.patch("portfolio.checks.exact_duplicates", side_effect=[[], ["phone"]]):
            response = self.register()
        self.assertEqual((response.status_code, response.json()), (400, {**DUPLICATE, "matched": ["phone"]}))
        self.assertEqual(BusinessOwner.objects.count(), 1)


class RegistrationFlagTests(RegistrationBase):
    def test_a_similar_business_nearby_is_flagged_not_blocked(self):
        fabrics = existing_business(
            "Adwoa Fabrics", phone="0201112223", gps="AK-039-5028", lat="6.688500", lng="-1.624400",
        )
        response = self.register(business_name="Adwoa Fabric", lat="6.688770")
        self.assertEqual(response.status_code, 201, response.content)
        flag = FraudFlag.objects.get()
        self.assertEqual(response.json()["flags"], [{
            "id": flag.pk, "kind": "similar_nearby", "kind_label": "Similar business nearby",
        }])
        owner = BusinessOwner.objects.get(pk=response.json()["id"])
        self.assertEqual(
            (flag.business_owner, flag.related_business_owner, flag.status, flag.source, flag.raised_by),
            (owner, fabrics, "open", "system", None),
        )
        self.assertIn("Name similarity 0.80", flag.evidence)
        self.assertFalse(ActivityEvent.objects.filter(verb="fraud.flag_raised").exists())
        self.assertEqual(ActivityEvent.objects.get(verb="business.registered").after["flags"], [flag.pk])

    def test_an_owner_phone_matching_a_staff_member_is_flagged_as_self_dealing(self):
        esi = make_staff("support", "esi@example.com", phone="055 900 0111")
        response = self.register(owner_phone="0559000111")
        self.assertEqual(response.status_code, 201, response.content)
        flag = FraudFlag.objects.get()
        self.assertEqual(response.json()["flags"], [{
            "id": flag.pk, "kind": "self_dealing", "kind_label": "Self-dealing",
        }])
        self.assertEqual((flag.staff_subject, flag.business_owner_id), (esi, response.json()["id"]))
        self.assertEqual(ActivityEvent.objects.get(verb="business.registered").after["flags"], [flag.pk])

    def test_fraud_case_titles_go_only_to_whoever_holds_portfolio_manage(self):
        make_staff("support", "esi@example.com", phone="055 900 0111")
        kojo = make_staff("operations", "kojo@example.com")
        response = self.register(staff=kojo, owner_phone="0559000111")
        self.assertEqual(response.status_code, 201, response.content)
        flag = FraudFlag.objects.get()
        self.assertEqual(response.json()["flags"], [{
            "id": flag.pk, "kind": "self_dealing", "kind_label": "Self-dealing",
            "title": "Owner's phone matches staff member Esi",
        }])


class RegisterCheckTests(RegistrationBase):
    def test_the_review_step_check(self):
        existing_business("Adwoa Fabrics", phone="0241234567", gps="AK-039-5028", lat="6.688500", lng="-1.624400")
        make_staff("support", "esi@example.com", phone="0559000111")
        self.as_(self.scout)
        response = self.client.post(CHECK_URL, {
            "owner_phone": "+233 24 123 4567", "business_name": "Adwoa Fabric", "gps_address": "ak-039-5028",
            "lat": 6.68877, "lng": -1.6244, "ghana_card_number": "",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["exact"], body["staff_match"]), (["phone", "gps_address"], False))
        # The look-alike check shows the other business's name and distance.
        self.assertEqual(
            [{key: match[key] for key in ("business_name", "distance_m")} for match in body["similar"]],
            [{"business_name": "Adwoa Fabrics", "distance_m": 30}],
        )
        response = self.client.post(CHECK_URL, {
            "owner_phone": "0559000111", "business_name": "Kofi Electronics", "gps_address": "AK-112-0384",
            "lat": "not a number",
        }, format="json")
        self.assertEqual(response.json(), {"exact": [], "similar": [], "staff_match": True})
        self.assertFalse(ActivityEvent.objects.exists())  # it changes nothing, so it records nothing
        self.as_(make_staff("support", "abena@example.com"))
        self.assertEqual(self.client.post(CHECK_URL, {}, format="json").status_code, 403)


class KycResubmitTests(RegistrationBase):
    def setUp(self):
        super().setUp()
        body = self.register().json()
        self.owner = BusinessOwner.objects.get(pk=body["id"])
        self.approval_id = body["approval_id"]
        self.url = f"/api/portfolio/businesses/{self.owner.pk}/kyc/"

    def test_after_a_return_the_scout_sends_new_photos(self):
        reject(self.approval_id, self.lead, "The signboard photo is blurry")
        self.as_(self.scout)
        response = self.client.post(
            self.url, {"signboard_photo": png("daylight.png"), "maker_note": "Retook it in daylight"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        new = ApprovalRequest.objects.get(status="pending")
        self.assertEqual(response.json(), {"approval_id": new.pk, "approver_name": "Ama"})
        self.assertEqual((new.kind, new.maker, new.assigned_to, new.maker_note),
                         ("business.kyc", self.scout, self.lead, "Retook it in daylight"))
        self.assertIn("daylight", BusinessOwnerProfile.objects.get(business_owner=self.owner).signboard_photo.name)
        event = ActivityEvent.objects.order_by("-id").first()
        self.assertEqual(
            (event.verb, event.after),
            ("business.kyc_resubmitted", {"photos": ["signboard_photo"], "approval_id": new.pk}),
        )

    def test_replaced_photos_are_deleted_once_the_request_is_saved(self):
        reject(self.approval_id, self.lead, "Both photos are blurry")
        profile = BusinessOwnerProfile.objects.get(business_owner=self.owner)
        old_signboard, old_card = profile.signboard_photo.name, profile.ghana_card_front_image.name
        self.assertTrue(default_storage.exists(old_signboard))
        self.assertTrue(default_storage.exists(old_card))
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                self.url, {"signboard_photo": png("daylight.png"), "ghana_card_front": png("card-again.png")},
                format="multipart",
            )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(default_storage.exists(old_signboard))
        self.assertFalse(default_storage.exists(old_card))
        profile.refresh_from_db()
        self.assertTrue(default_storage.exists(profile.signboard_photo.name))
        self.assertTrue(default_storage.exists(profile.ghana_card_front_image.name))
        event = ActivityEvent.objects.order_by("-id").first()
        self.assertEqual(event.after["photos"], ["signboard_photo", "ghana_card_front"])

    def test_a_replaced_photo_that_cannot_be_deleted_is_logged(self):
        reject(self.approval_id, self.lead, "Blurry")
        self.as_(self.scout)
        storage = mock.Mock()
        storage.delete.side_effect = OSError("disk full")
        with mock.patch("portfolio.registration.default_storage", storage), \
                self.assertLogs("portfolio.registration", level="ERROR"), \
                self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, {"signboard_photo": png("again.png")}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        storage.delete.assert_called_once()

    def test_a_resubmit_body_that_is_not_a_set_of_fields_is_refused(self):
        reject(self.approval_id, self.lead, "Blurry")
        self.as_(self.scout)
        response = self.client.post(self.url, ["maker_note"], format="json")
        self.assertEqual((response.status_code, response.json()), (400, {"detail": "Send the form's fields."}))
        self.assertFalse(ApprovalRequest.objects.filter(status="pending").exists())

    def test_refused_while_a_request_waits_or_once_kyc_is_decided(self):
        self.as_(self.scout)
        response = self.client.post(self.url, {}, format="multipart")
        self.assertEqual((response.status_code, response.json()), (400, {
            "detail": "A KYC request for this business is already waiting for a decision.", "code": "already_pending",
        }))
        reject(self.approval_id, self.lead, "Blurry")
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.VERIFIED)
        response = self.client.post(self.url, {}, format="multipart")
        self.assertEqual((response.status_code, response.json()), (400, {
            "detail": "This business isn't waiting for KYC any more.", "code": "not_pending",
        }))

    def test_a_super_admin_who_is_the_account_manager_sends_it_again_to_the_kyc_queue(self):
        reject(self.approval_id, self.lead, "Blurry")
        boss = make_staff("super_admin", "boss@example.com")
        boss_owner = self.owner
        BusinessOwner.objects.filter(pk=boss_owner.pk).update(registered_by=boss, account_manager=boss)
        self.as_(boss)
        response = self.client.post(
            f"/api/portfolio/businesses/{boss_owner.pk}/kyc/", {"maker_note": "Checked the card by phone"},
            format="multipart",
        )
        self.assertEqual((response.status_code, response.json()), (201, {"approval_id": None, "approver_name": None}))
        self.assertFalse(ApprovalRequest.objects.filter(status="pending").exists())

    def test_a_super_admin_who_is_not_the_account_manager_gets_a_404_and_changes_nothing(self):
        reject(self.approval_id, self.lead, "Blurry")
        profile = BusinessOwnerProfile.objects.get(business_owner=self.owner)
        signboard, card = profile.signboard_photo.name, profile.ghana_card_front_image.name
        self.as_(make_staff("super_admin", "boss@example.com"))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                self.url, {"signboard_photo": png("swap.png"), "ghana_card_front": png("swap2.png")},
                format="multipart",
            )
        self.assertEqual(response.status_code, 404)
        profile.refresh_from_db()
        self.assertEqual((profile.signboard_photo.name, profile.ghana_card_front_image.name), (signboard, card))
        self.assertTrue(default_storage.exists(signboard))
        self.assertTrue(default_storage.exists(card))
        self.assertFalse(ApprovalRequest.objects.filter(status="pending").exists())

    def test_a_business_that_registered_itself_online_is_refused_even_with_a_scout_manager(self):
        owner = existing_business("Kofi Electronics", phone="0201112223", gps="AK-039-5028")
        owner.kyc_status = BusinessOwner.PENDING
        owner.account_manager = self.scout
        owner.save(update_fields=["kyc_status", "account_manager"])
        profile = BusinessOwnerProfile.objects.get(business_owner=owner)
        profile.signboard_photo.save("old-sign.png", png("old-sign.png"))
        profile.ghana_card_front_image.save("old-card.png", png("old-card.png"))
        signboard, card = profile.signboard_photo.name, profile.ghana_card_front_image.name
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/portfolio/businesses/{owner.pk}/kyc/",
                {"signboard_photo": png("swap.png"), "ghana_card_front": png("swap2.png")}, format="multipart",
            )
        self.assertEqual((response.status_code, response.json()), (400, {
            "detail": "KYC for a business that registered itself online is handled in the KYC queue.",
            "code": "not_scout",
        }))
        profile.refresh_from_db()
        self.assertEqual((profile.signboard_photo.name, profile.ghana_card_front_image.name), (signboard, card))
        self.assertTrue(default_storage.exists(signboard))
        self.assertTrue(default_storage.exists(card))

    def test_only_the_account_manager_resubmits(self):
        reject(self.approval_id, self.lead, "Blurry")
        self.as_(make_staff("scout", "yaw@example.com", manager=self.lead))
        self.assertEqual(self.client.post(self.url, {}, format="multipart").status_code, 404)
        self.as_(self.lead)  # holds portfolio.manage, but resubmitting is the account manager's job
        self.assertEqual(self.client.post(self.url, {}, format="multipart").status_code, 404)
        self.as_(make_staff("support", "esi@example.com"))
        self.assertEqual(self.client.post(self.url, {}, format="multipart").status_code, 403)
