"""Hand-placed pin, landmark, Plus Code, location tier and the close-pin flag (self-serve Phase 2, Task 4)."""
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from openlocationcode import openlocationcode
from rest_framework.test import APIClient

from accounts import location_capture, location_tier, pluscode
from accounts.address_verification import owner_gps_evidence
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, LocationCapture
from accounts.testing import make_staff, staff_token
from commission.models import CommissionAccrual
from commission.tests.base import CommissionBase
from fraud import services as fraud
from fraud.models import FraudFlag
from listings.models import Category, Listing, Zone

ME = "/api/accounts/me/location/"
CAPTURE = "/api/accounts/location-links/capture/"
LINKS = "/api/accounts/location-links/"
KUMASI = {"lat": 6.6885, "lng": -1.6244}


class Base(TestCase):
    _n = 0

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.owner = self.make_owner()

    def make_owner(self, **profile_fields):
        type(self)._n += 1
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {self._n}", login_phone=f"+23324430{self._n:04d}", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name=f"Shop {self._n}", gps_address="AK-039-5028", **profile_fields,
        )
        return owner

    def post(self, body, owner=None):
        owner = owner or self.owner
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        return self.client.post(ME, body, format="json")

    def profile(self, owner=None):
        return BusinessOwnerProfile.objects.get(business_owner=owner or self.owner)


class ManualPinTests(Base):
    def test_manual_pin_inside_ashanti_accepted_with_no_accuracy(self):
        response = self.post({**KUMASI, "manual": True})
        self.assertEqual(response.status_code, 200, response.content)
        profile = self.profile()
        self.assertTrue(profile.location_is_manual)
        self.assertIsNone(profile.location_accuracy_m)
        self.assertEqual(profile.location_set_by, "owner")
        self.assertEqual(profile.lat, Decimal("6.688500"))
        pin = response.json()["pin"]
        self.assertTrue(pin["is_manual"])
        self.assertIsNone(pin["accuracy_m"])
        self.assertTrue(response.json()["is_manual"])

    def test_manual_pin_ignores_a_huge_accuracy_figure(self):
        response = self.post({**KUMASI, "manual": True, "accuracy_m": 4000})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(self.profile().location_accuracy_m)

    def test_manual_pin_outside_ashanti_refused(self):
        response = self.post({"lat": 5.6037, "lng": -0.1870, "manual": True})  # Accra
        self.assertEqual(response.status_code, 400)
        self.assertIn("lat", response.json())
        self.assertIsNone(self.profile().lat)

    def test_device_fix_over_100m_still_refused(self):
        response = self.post({**KUMASI, "accuracy_m": 101})
        self.assertEqual(response.status_code, 400)
        self.assertIn("accuracy_m", response.json())
        self.assertIsNone(self.profile().lat)

    def test_device_fix_without_accuracy_is_refused_not_treated_as_manual(self):
        response = self.post(KUMASI)
        self.assertEqual(response.status_code, 400)
        self.assertIn("accuracy_m", response.json())

    def test_manual_false_is_a_device_fix(self):
        response = self.post({**KUMASI, "accuracy_m": 12, "manual": False})
        self.assertEqual(response.status_code, 200, response.content)
        profile = self.profile()
        self.assertFalse(profile.location_is_manual)
        self.assertEqual(profile.location_accuracy_m, 12)

    def test_a_device_fix_after_a_manual_pin_clears_the_manual_flag(self):
        self.post({**KUMASI, "manual": True})
        self.post({**KUMASI, "accuracy_m": 8})
        profile = self.profile()
        self.assertFalse(profile.location_is_manual)
        self.assertEqual(profile.location_accuracy_m, 8)

    def test_a_manual_pin_is_not_device_evidence_for_address_verification(self):
        self.post({**KUMASI, "manual": True})
        self.assertFalse(owner_gps_evidence(self.profile()))

    def test_a_manual_pin_with_no_accuracy_lists_in_the_staff_queue(self):
        self.post({**KUMASI, "manual": True})
        staff = make_staff("operations", "ops-tier@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        rows = self.client.get("/api/accounts/address-verification/").json()["results"]
        row = next(r for r in rows if r["id"] == self.owner.pk)
        self.assertTrue(row["pin"]["is_manual"])
        self.assertIsNone(row["pin"]["accuracy_m"])
        self.assertFalse(row["evidence"]["owner_gps_50m"])

    def test_the_staff_link_path_cannot_send_a_manual_pin(self):
        staff = make_staff("operations", "ops-link@example.com")
        permission_owner = staff  # operations holds address.verify
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(permission_owner)}")
        sent = self.client.post(LINKS, {"business_owner": self.owner.pk}, format="json")
        self.assertEqual(sent.status_code, 201, sent.content)
        raw = sent.json()["url"].split("#token=")[1]
        self.client.credentials()
        refused = self.client.post(CAPTURE, {"token": raw, **KUMASI, "manual": True, "landmark": "x"}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("accuracy_m", refused.json())
        self.assertIsNone(self.profile().lat)
        # a coarse fix with manual=true is still refused, and the link is not used up
        coarse = self.client.post(CAPTURE, {"token": raw, **KUMASI, "accuracy_m": 400, "manual": True}, format="json")
        self.assertEqual(coarse.status_code, 400)
        self.assertIsNone(LocationCapture.objects.get(token_hash__isnull=False).used_at)
        # a proper device fix works, is never manual and ignores a landmark sent through the link
        ok = self.client.post(CAPTURE, {"token": raw, **KUMASI, "accuracy_m": 9, "landmark": "x"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        profile = self.profile()
        self.assertFalse(profile.location_is_manual)
        self.assertEqual(profile.landmark, "")


class LandmarkTests(Base):
    def test_landmark_saved_and_trimmed(self):
        response = self.post({**KUMASI, "manual": True, "landmark": "  Opposite the Kejetia main gate  "})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.profile().landmark, "Opposite the Kejetia main gate")
        self.assertEqual(response.json()["landmark"], "Opposite the Kejetia main gate")

    def test_landmark_over_200_characters_refused(self):
        response = self.post({**KUMASI, "accuracy_m": 5, "landmark": "x" * 201})
        self.assertEqual(response.status_code, 400)
        self.assertIn("landmark", response.json())

    def test_landmark_left_out_keeps_the_saved_one(self):
        self.post({**KUMASI, "accuracy_m": 5, "landmark": "By the mosque"})
        self.post({**KUMASI, "accuracy_m": 5})
        self.assertEqual(self.profile().landmark, "By the mosque")

    def test_an_empty_landmark_clears_it(self):
        self.post({**KUMASI, "accuracy_m": 5, "landmark": "By the mosque"})
        self.post({**KUMASI, "accuracy_m": 5, "landmark": "   "})
        self.assertEqual(self.profile().landmark, "")


class PlusCodeTests(Base):
    def test_plus_code_for_known_point(self):
        code = pluscode.encode(Decimal("6.6885"), Decimal("-1.6244"))
        self.assertEqual(code, openlocationcode.encode(6.6885, -1.6244))
        self.assertEqual(len(code), 11)
        self.assertEqual(code[8], "+")

    def test_own_state_carries_the_plus_code_only_when_there_is_a_pin(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        empty = self.client.get(ME).json()
        self.assertIsNone(empty["plus_code"])
        self.assertEqual(empty["tier"], "none")
        self.assertEqual(empty["tier_label"], "")
        self.assertEqual(empty["landmark"], "")
        self.assertFalse(empty["is_manual"])
        self.post({**KUMASI, "manual": True, "landmark": "Gate 3"})
        body = self.client.get(ME).json()
        self.assertEqual(body["plus_code"], openlocationcode.encode(6.6885, -1.6244))
        self.assertEqual(body["landmark"], "Gate 3")
        self.assertEqual(body["tier"], "located")
        self.assertEqual(body["tier_label"], "Location shared by the owner")
        self.assertTrue(body["is_manual"])

    def test_plus_code_is_not_stored(self):
        self.assertNotIn("plus_code", [f.name for f in BusinessOwnerProfile._meta.get_fields()])


class TierTests(Base):
    def test_tier_values_for_each_case(self):
        now = timezone.now()
        pin = {"lat": Decimal("6.6885"), "lng": Decimal("-1.6244")}
        cases = [
            ("no profile", None, "none"),
            ("no pin", BusinessOwnerProfile(), "none"),
            ("pin only", BusinessOwnerProfile(**pin), "located"),
            ("verified with a pin", BusinessOwnerProfile(**pin, address_verified=True, address_verified_at=now), "verified"),
            ("verified with no pin", BusinessOwnerProfile(address_verified=True, address_verified_at=now), "none"),
            ("marked wrong", BusinessOwnerProfile(**pin, address_verified=False, address_verified_at=now), "wrong"),
            ("marked wrong with no pin", BusinessOwnerProfile(address_verified_at=now), "wrong"),
        ]
        for label, profile, expected in cases:
            with self.subTest(label):
                self.assertEqual(location_tier.tier(profile), expected)

    def test_labels(self):
        self.assertEqual(location_tier.LABELS, {
            "located": "Location shared by the owner", "verified": "Verified location",
            "wrong": "Location needs re-sharing", "none": "",
        })

    def test_public_listing_owner_payload_has_location_tier(self):
        located = self.make_owner(lat=Decimal("6.6885"), lng=Decimal("-1.6244"))
        verified = self.make_owner(
            lat=Decimal("6.7"), lng=Decimal("-1.62"), address_verified=True, address_verified_at=timezone.now(),
        )
        pinless = self.make_owner()
        listings = {}
        for owner in (located, verified, pinless):
            listings[owner.pk] = Listing.objects.create(
                business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
                name=f"Item {owner.pk}", description="D.", contact_phone="+233207991001", price_amount="10.00",
                status=Listing.PUBLISHED,
            )
        self.client.credentials()
        got = {}
        for owner_id, listing in listings.items():
            response = self.client.get(f"/api/listings/{listing.pk}/")
            self.assertEqual(response.status_code, 200, response.content)
            got[owner_id] = response.json()["business_owner"]
        self.assertEqual(got[located.pk]["location_tier"], {"tier": "located", "label": "Location shared by the owner"})
        self.assertEqual(got[verified.pk]["location_tier"], {"tier": "verified", "label": "Verified location"})
        self.assertEqual(got[pinless.pk]["location_tier"], {"tier": "none", "label": ""})
        for payload in got.values():
            self.assertNotIn("lat", payload)
            self.assertNotIn("plus_code", payload)

    def test_the_owner_payload_adds_no_query_per_listing(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        def add_listing():
            owner = self.make_owner(lat=Decimal("6.6885"), lng=Decimal("-1.6244"))
            Listing.objects.create(
                business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
                name="Item", description="D.", contact_phone="+233207991001", price_amount="10.00",
                status=Listing.PUBLISHED,
            )

        def count():
            cache.clear()
            self.client.credentials()
            with CaptureQueriesContext(connection) as ctx:
                response = self.client.get("/api/listings/")
            self.assertEqual(response.status_code, 200)
            self.assertIn("location_tier", str(response.json()))
            return len(ctx)

        add_listing()
        before = count()
        for _ in range(3):
            add_listing()
        self.assertEqual(count(), before)


class ClosePinFlagTests(Base):
    def flags(self):
        return FraudFlag.objects.filter(kind=FraudFlag.OTHER, dedupe_key__startswith="pin-near-")

    def test_second_business_within_25m_raises_one_flag_and_still_saves(self):
        first = self.make_owner()
        self.assertEqual(self.post({**KUMASI, "accuracy_m": 5}, owner=first).status_code, 200)
        self.assertEqual(self.flags().count(), 0)
        second = self.make_owner()
        response = self.post({"lat": 6.68861, "lng": -1.6244, "accuracy_m": 5}, owner=second)  # about 11 m north
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.profile(second).lat, Decimal("6.688610"))
        flag = self.flags().get()
        low, high = sorted([first.pk, second.pk])
        self.assertEqual(flag.dedupe_key, f"pin-near-{low}-{high}")
        self.assertEqual(flag.business_owner, second)
        self.assertEqual(flag.related_business_owner, first)
        self.assertEqual(flag.status, FraudFlag.OPEN)
        self.assertEqual(flag.source, FraudFlag.SYSTEM)

    def test_sharing_again_does_not_raise_a_second_open_flag(self):
        first, second = self.make_owner(), self.make_owner()
        self.post({**KUMASI, "accuracy_m": 5}, owner=first)
        self.post({"lat": 6.68861, "lng": -1.6244, "accuracy_m": 5}, owner=second)
        self.post({"lat": 6.68862, "lng": -1.6244, "accuracy_m": 5}, owner=second)
        self.assertEqual(self.flags().count(), 1)

    def test_a_manual_pin_near_another_is_flagged_too(self):
        first, second = self.make_owner(), self.make_owner()
        self.post({**KUMASI, "manual": True}, owner=first)
        self.post({"lat": 6.68855, "lng": -1.6244, "manual": True}, owner=second)
        self.assertEqual(self.flags().count(), 1)

    def test_business_100m_away_raises_no_flag(self):
        first, second = self.make_owner(), self.make_owner()
        self.post({**KUMASI, "accuracy_m": 5}, owner=first)
        response = self.post({"lat": 6.6894, "lng": -1.6244, "accuracy_m": 5}, owner=second)  # about 100 m north
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.flags().count(), 0)

    def test_just_over_25m_raises_no_flag(self):
        first, second = self.make_owner(), self.make_owner()
        self.post({**KUMASI, "accuracy_m": 5}, owner=first)
        self.post({"lat": 6.68873, "lng": -1.6244, "accuracy_m": 5}, owner=second)  # about 26 m north
        self.assertEqual(self.flags().count(), 0)

    def test_a_businesss_own_old_pin_never_flags_itself(self):
        self.post({**KUMASI, "accuracy_m": 5})
        self.post({"lat": 6.68851, "lng": -1.6244, "accuracy_m": 5})
        self.assertEqual(self.flags().count(), 0)

    def test_the_link_path_flags_a_close_pin_too(self):
        first, second = self.make_owner(), self.make_owner()
        self.post({**KUMASI, "accuracy_m": 5}, owner=first)
        staff = make_staff("operations", "ops-near@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        raw = self.client.post(LINKS, {"business_owner": second.pk}, format="json").json()["url"].split("#token=")[1]
        self.client.credentials()
        self.assertEqual(
            self.client.post(CAPTURE, {"token": raw, "lat": 6.68861, "lng": -1.6244, "accuracy_m": 5}, format="json").status_code,
            200,
        )
        self.assertEqual(self.flags().count(), 1)

    def test_the_notice_says_plainly_it_is_a_co_location_notice(self):
        first, second = self.make_owner(), self.make_owner()
        self.post({**KUMASI, "accuracy_m": 5}, owner=first)
        self.post({"lat": 6.68861, "lng": -1.6244, "accuracy_m": 5}, owner=second)
        flag = self.flags().get()
        self.assertEqual(flag.kind, FraudFlag.OTHER)
        self.assertNotEqual(flag.dedupe_key.split(":")[0], "similar_nearby")
        self.assertIn("Co-location notice", flag.detail)
        self.assertIn("normal", flag.detail)
        self.assertIn("apart", flag.title)

    def test_a_re_share_of_an_unchanged_pin_raises_nothing(self):
        first, second = self.make_owner(), self.make_owner()
        self.post({**KUMASI, "accuracy_m": 5}, owner=first)
        # the second business already holds a pin 11 m away, placed before the first (no check ran for it)
        BusinessOwnerProfile.objects.filter(business_owner=second).update(lat=Decimal("6.688610"), lng=Decimal("-1.624400"))
        self.assertEqual(self.flags().count(), 0)
        response = self.post({"lat": 6.68861, "lng": -1.6244, "accuracy_m": 5}, owner=second)  # same spot again
        self.assertEqual(response.status_code, 200, response.content)
        response = self.post({"lat": 6.6886105, "lng": -1.6244, "accuracy_m": 5}, owner=second)  # about half a metre
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.flags().count(), 0)

    def test_a_dismissed_pair_is_not_raised_again_when_the_pin_moves_a_few_metres(self):
        first, second = self.make_owner(), self.make_owner()
        self.post({**KUMASI, "accuracy_m": 5}, owner=first)
        self.post({"lat": 6.68861, "lng": -1.6244, "accuracy_m": 5}, owner=second)
        flag = self.flags().get()
        fraud.dismiss(flag.pk, make_staff("super_admin", "boss-near@example.com"), note="Same market building")
        self.post({"lat": 6.68863, "lng": -1.6244, "accuracy_m": 5}, owner=second)  # moved about 2 m
        self.post({"lat": 6.68862, "lng": -1.6244, "accuracy_m": 5}, owner=first)  # the other business moves too
        self.assertEqual(self.flags().count(), 1)
        self.assertEqual(self.flags().get().status, FraudFlag.DISMISSED)

    def test_more_than_three_neighbours_raises_exactly_three_nearest_first(self):
        crowd = [self.make_owner() for _ in range(5)]
        for index, other in enumerate(crowd):  # 0, 2, 4, 6, 8 m north of the spot
            self.post({"lat": 6.6885 + index * 0.000018, "lng": -1.6244, "accuracy_m": 5}, owner=other)
        flags_after_setup = self.flags().count()
        newcomer = self.make_owner()
        self.post({"lat": 6.6885, "lng": -1.6244, "accuracy_m": 5}, owner=newcomer)
        mine = self.flags().filter(business_owner=newcomer)
        self.assertEqual(mine.count(), 3)
        self.assertEqual(
            {flag.related_business_owner_id for flag in mine}, {crowd[0].pk, crowd[1].pk, crowd[2].pk},
        )
        self.assertGreater(self.flags().count(), flags_after_setup)


class CoLocationNoticeDoesNotTouchCommissionTests(CommissionBase):
    """Confirming a co-location notice must reverse no commission and offer no suspension."""

    def test_confirming_the_notice_leaves_commission_and_the_business_alone(self):
        from commission.services import REVERSING_KINDS

        self.assertNotIn(FraudFlag.OTHER, REVERSING_KINDS)
        self.assertNotIn(FraudFlag.OTHER, FraudFlag.SUSPENDABLE)
        self.policy()
        owner = self.pending_owner()
        self.approve(owner)
        accrual = CommissionAccrual.objects.get()
        neighbour = BusinessOwner.objects.create(full_name="Next door", login_phone="+233244999001", password_hash="x")
        BusinessOwnerProfile.objects.create(
            business_owner=neighbour, business_name="Next door shop", lat=Decimal("6.688600"), lng=Decimal("-1.624400"),
        )
        # the commission business re-shares its (unverified-for-the-test) pin to a spot next to the neighbour
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(
            lat=Decimal("6.7"), lng=Decimal("-1.6"), address_verified=False, address_verified_at=None,
        )
        location_capture.capture_for_owner(owner, {"lat": 6.68861, "lng": -1.6244, "accuracy_m": 5})
        flag = FraudFlag.objects.get(dedupe_key__startswith="pin-near-")
        self.assertEqual(flag.business_owner, owner)
        with self.assertRaises(fraud.FraudError):
            fraud.confirm(flag.pk, self.boss, note="Checked", suspend=True)
        fraud.confirm(flag.pk, self.boss, note="Checked")
        accrual.refresh_from_db()
        owner.refresh_from_db()
        self.assertEqual(accrual.status, CommissionAccrual.ON_HOLD)
        self.assertFalse(owner.is_suspended)
        self.assertFalse(CommissionAccrual.objects.filter(status=CommissionAccrual.REVERSED).exists())
