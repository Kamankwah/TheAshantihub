"""Hand-placed pin, landmark, Plus Code, location tier and the close-pin flag (self-serve Phase 2, Task 4)."""
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from openlocationcode import openlocationcode
from rest_framework.test import APIClient

from accounts import location_tier, pluscode
from accounts.address_verification import owner_gps_evidence
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, LocationCapture
from accounts.testing import make_staff, staff_token
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
        return FraudFlag.objects.filter(kind=FraudFlag.SIMILAR_NEARBY, dedupe_key__startswith="pin-near-")

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
