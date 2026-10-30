"""Address verification (plan "shop location and address verification", Task 2): the staff queue and decision API, the
`address.verify` permission, the maker-checker, the staff badge, the live refresh and the KYC pin gate."""
import asyncio
from datetime import timedelta
from decimal import Decimal

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import kyc
from accounts.authentication import issue_token
from accounts.models import (
    BusinessOwner,
    BusinessOwnerProfile,
    LocationCapture,
    Permission,
    Role,
    ScoutAssignment,
)
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from notifications.models import Notification
from otp import senders

QUEUE = "/api/accounts/address-verification/"
BADGES = "/api/notifications/staff-badges/"
ME = "/api/accounts/me/location/"
ROW_KEYS = {
    "id", "business_name", "owner_name", "phone", "zone", "kyc_status", "gps_address", "signboard_photo", "pin",
    "registrar", "last_capture", "address_status", "verification", "evidence", "can_decide", "blocked_reason",
}
PIN_KEYS = {"lat", "lng", "accuracy_m", "set_by", "set_by_staff_name", "set_at", "is_manual"}
CAPTURE_KEYS = {"source", "created_at", "expires_at", "used_at", "revoked_at", "state", "accuracy_m", "sent_by_name"}
EVIDENCE_KEYS = {"owner_gps_50m", "signboard", "scout_report", "first_verification"}


def decide_url(owner):
    return f"{QUEUE}{owner.pk}/decide/"


class Base(TestCase):
    _n = 0

    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.client = APIClient()
        self.ops = make_staff("operations", "ops@example.com")
        self.gm = make_staff("general_manager", "gm@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")
        self.other_boss = make_staff("super_admin", "boss2@example.com")
        self.support = make_staff("support", "esi@example.com")
        self.scout = make_staff("scout", "kwame@example.com")

    def make_owner(self, *, kyc_status=BusinessOwner.PENDING, profile=True, registered_by=None, pin=True,
                   owner_pin=True, signboard=True, accuracy=12, **profile_fields):
        type(self)._n += 1
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {self._n}", login_phone=f"+23324420{self._n:04d}", password_hash="x",
            kyc_status=kyc_status, registered_by=registered_by,
        )
        if profile:
            fields = {"business_name": f"Shop {self._n}", "gps_address": "AK-039-5028"}
            if pin:
                fields.update(
                    lat=Decimal("6.688500"), lng=Decimal("-1.624400"), location_accuracy_m=accuracy,
                    location_set_by="owner" if owner_pin else "scout", location_set_at=timezone.now(),
                    location_is_manual=False,
                )
            if signboard:
                fields["signboard_photo"] = "signboards/shop.jpg"
            fields.update(profile_fields)
            BusinessOwnerProfile.objects.create(business_owner=owner, **fields)
        return owner

    def decided(self, owner, *, verified, by=None, at=None, **fields):
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(
            address_verified=verified, address_verified_by=by or self.ops, address_verified_at=at or timezone.now(),
            **fields,
        )

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        return self.client

    def as_owner(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def profile(self, owner):
        return BusinessOwnerProfile.objects.get(business_owner=owner)

    def decide(self, owner, staff=None, **body):
        self.as_staff(staff or self.ops)
        return self.client.post(decide_url(owner), body, format="json")

    def verify_by_call(self, owner, staff=None, **extra):
        return self.decide(
            owner, staff, result="verified", method="video_call", note=extra.pop("note", "Spoke to the owner; shop matches."),
            **extra,
        )

    def ids(self, response):
        return [row["id"] for row in response.json()["results"]]


class PermissionTests(Base):
    def test_operations_general_manager_and_super_admin_hold_address_verify(self):
        holders = set(Role.objects.filter(permissions__codename="address.verify").values_list("name", flat=True))
        self.assertEqual(holders, {"operations", "general_manager", "super_admin"})
        self.assertTrue(Permission.objects.get(codename="address.verify").description.strip())

    def test_support_and_scout_do_not(self):
        for staff in (self.support, self.scout):
            self.assertNotIn("address.verify", staff.effective_permission_codenames())
        for staff in (self.ops, self.gm, self.boss):
            self.assertIn("address.verify", staff.effective_permission_codenames())

    def test_the_queue_and_decide_are_refused_to_support_scout_and_anonymous(self):
        owner = self.make_owner()
        for staff in (self.support, self.scout):
            with self.subTest(staff=staff.email):
                self.as_staff(staff)
                self.assertEqual(self.client.get(QUEUE).status_code, 403)
                response = self.client.post(decide_url(owner), {"result": "wrong", "method": "desk", "note": "x"}, format="json")
                self.assertEqual(response.status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get(QUEUE).status_code, 401)
        self.assertEqual(self.client.post(decide_url(owner), {}, format="json").status_code, 401)

    def test_a_business_owner_cannot_use_the_staff_queue(self):
        owner = self.make_owner()
        self.as_owner(owner)
        self.assertEqual(self.client.get(QUEUE).status_code, 403)
        self.assertEqual(self.client.post(decide_url(owner), {}, format="json").status_code, 403)

    def test_the_migration_seed_and_its_reverse(self):
        from importlib import import_module

        from django.apps import apps

        migration = import_module("accounts.migrations.0072_address_verification")
        migration.unseed(apps, None)
        self.assertFalse(Permission.objects.filter(codename="address.verify").exists())
        migration.seed(apps, None)
        migration.seed(apps, None)  # idempotent
        holders = set(Role.objects.filter(permissions__codename="address.verify").values_list("name", flat=True))
        self.assertEqual(holders, {"operations", "general_manager", "super_admin"})

    def test_the_old_address_verify_door_is_unchanged_for_kyc_approvers(self):
        self.assertIn("kyc.approve", self.ops.effective_permission_codenames())


class QueueTests(Base):
    def test_the_default_tab_is_pending_oldest_first_and_paginated(self):
        first = self.make_owner()
        second = self.make_owner()
        BusinessOwner.objects.filter(pk=first.pk).update(created_at=timezone.now() - timedelta(days=3))
        response = self.as_staff(self.ops).get(QUEUE)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"count", "next", "previous", "results"})
        self.assertEqual([row["id"] for row in body["results"]], [first.pk, second.pk])

    def test_unknown_status_falls_back_to_pending(self):
        pending = self.make_owner()
        done = self.make_owner()
        self.decided(done, verified=True)
        self.assertEqual(self.ids(self.as_staff(self.ops).get(QUEUE, {"status": "nonsense"})), [pending.pk])

    def test_pending_holds_no_profile_and_undecided_and_not_rejected(self):
        no_profile = self.make_owner(profile=False)
        undecided = self.make_owner(pin=False)
        decided = self.make_owner()
        self.decided(decided, verified=False, address_verification_note="Wrong street")
        rejected = self.make_owner(kyc_status=BusinessOwner.REJECTED)
        approved = self.make_owner(kyc_status=BusinessOwner.VERIFIED)
        ids = self.ids(self.as_staff(self.ops).get(QUEUE))
        self.assertEqual(set(ids), {no_profile.pk, undecided.pk, approved.pk})
        self.assertNotIn(rejected.pk, ids)
        self.assertNotIn(decided.pk, ids)

    def test_verified_and_wrong_are_history_newest_decision_first_and_hide_rejected_kyc(self):
        old = self.make_owner()
        new = self.make_owner()
        wrong = self.make_owner()
        closed = self.make_owner(kyc_status=BusinessOwner.REJECTED)
        now = timezone.now()
        self.decided(old, verified=True, at=now - timedelta(days=2))
        self.decided(new, verified=True, at=now - timedelta(days=1))
        self.decided(wrong, verified=False, address_verification_note="Not at that address")
        self.decided(closed, verified=True)
        client = self.as_staff(self.ops)
        self.assertEqual(self.ids(client.get(QUEUE, {"status": "verified"})), [new.pk, old.pk])
        self.assertEqual(self.ids(client.get(QUEUE, {"status": "wrong"})), [wrong.pk])

    def test_row_shape_with_a_full_set_of_evidence(self):
        zone_owner = self.make_owner(registered_by=self.scout)
        capture = LocationCapture.objects.create(
            business_owner=zone_owner, source=LocationCapture.LINK, token_hash="a" * 64, created_by=self.ops,
            expires_at=timezone.now() + timedelta(hours=48), used_at=timezone.now(), lat=Decimal("6.6885"),
            lng=Decimal("-1.6244"), accuracy_m=12, captured_at=timezone.now(),
        )
        row = self.as_staff(self.ops).get(QUEUE).json()["results"][0]
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(row["id"], zone_owner.pk)
        self.assertEqual(row["business_name"], zone_owner.display_name)
        self.assertEqual(row["owner_name"], zone_owner.full_name)
        self.assertNotIn(zone_owner.login_phone, row["phone"])  # masked like the KYC queue
        self.assertEqual((row["kyc_status"], row["gps_address"], row["address_status"]), ("pending", "AK-039-5028", "not_verified"))
        self.assertTrue(row["signboard_photo"].endswith("signboards/shop.jpg"))
        self.assertEqual(set(row["pin"]), PIN_KEYS)
        self.assertEqual(
            (row["pin"]["lat"], row["pin"]["lng"], row["pin"]["accuracy_m"], row["pin"]["set_by"], row["pin"]["is_manual"]),
            (6.6885, -1.6244, 12, "owner", False),
        )
        self.assertIsNone(row["pin"]["set_by_staff_name"])
        self.assertEqual(row["registrar"], {"id": self.scout.pk, "name": self.scout.full_name})
        self.assertEqual(set(row["last_capture"]), CAPTURE_KEYS)
        self.assertEqual(
            (row["last_capture"]["source"], row["last_capture"]["state"], row["last_capture"]["accuracy_m"],
             row["last_capture"]["sent_by_name"]),
            ("link", "used", 12, self.ops.full_name),
        )
        self.assertEqual(set(row["evidence"]), EVIDENCE_KEYS)
        self.assertEqual(
            row["evidence"],
            {"owner_gps_50m": True, "signboard": True, "scout_report": False, "first_verification": True},
        )
        self.assertIsNone(row["verification"])
        self.assertEqual((row["can_decide"], row["blocked_reason"]), (True, None))
        self.assertEqual(capture.pk, LocationCapture.objects.get().pk)

    def test_a_business_with_no_pin_has_a_null_pin_and_honest_empty_evidence(self):
        self.make_owner(pin=False, signboard=False)
        row = self.as_staff(self.ops).get(QUEUE).json()["results"][0]
        self.assertIsNone(row["pin"])
        self.assertIsNone(row["signboard_photo"])
        self.assertIsNone(row["last_capture"])
        self.assertIsNone(row["registrar"])
        self.assertEqual(
            row["evidence"],
            {"owner_gps_50m": False, "signboard": False, "scout_report": False, "first_verification": True},
        )

    def test_a_business_with_no_profile_still_lists(self):
        owner = self.make_owner(profile=False)
        row = self.as_staff(self.ops).get(QUEUE).json()["results"][0]
        self.assertEqual(row["id"], owner.pk)
        self.assertEqual((row["business_name"], row["pin"], row["zone"], row["gps_address"]), (owner.full_name, None, None, None))

    def test_evidence_gps_needs_an_owner_device_fix_of_50_m_or_better(self):
        cases = [
            ("owner 50 m", {"accuracy": 50}, True),
            ("owner 51 m", {"accuracy": 51}, False),
            ("scout pin", {"owner_pin": False}, False),
            ("by hand", {"location_is_manual": True}, False),
        ]
        for label, fields, expected in cases:
            with self.subTest(label):
                BusinessOwner.objects.all().delete()
                self.make_owner(**fields)
                row = self.as_staff(self.ops).get(QUEUE).json()["results"][0]
                self.assertEqual(row["evidence"]["owner_gps_50m"], expected)

    def test_scout_report_evidence_is_a_visited_assignment_that_confirmed_the_address(self):
        confirmed = self.make_owner()
        denied = self.make_owner()
        for owner, ok in ((confirmed, True), (denied, False)):
            ScoutAssignment.objects.create(
                business_owner=owner, scout=self.scout, status=ScoutAssignment.VISITED, address_confirmed=ok,
                visited_at=timezone.now(),
            )
        rows = {row["id"]: row for row in self.as_staff(self.ops).get(QUEUE).json()["results"]}
        self.assertTrue(rows[confirmed.pk]["evidence"]["scout_report"])
        self.assertFalse(rows[denied.pk]["evidence"]["scout_report"])

    def test_last_capture_states(self):
        owner = self.make_owner()
        now = timezone.now()
        base = {"business_owner": owner, "source": LocationCapture.LINK}
        cases = [
            ("live", {"expires_at": now + timedelta(hours=5)}),
            ("expired", {"expires_at": now - timedelta(hours=1)}),
            ("revoked", {"expires_at": now + timedelta(hours=5), "revoked_at": now}),
            ("used", {"expires_at": now + timedelta(hours=5), "used_at": now}),
        ]
        for state, fields in cases:
            with self.subTest(state):
                LocationCapture.objects.all().delete()
                LocationCapture.objects.create(token_hash=state.ljust(64, "x"), created_by=self.gm, **base, **fields)
                row = self.as_staff(self.ops).get(QUEUE).json()["results"][0]
                self.assertEqual(row["last_capture"]["state"], state)
                self.assertEqual(row["last_capture"]["sent_by_name"], self.gm.full_name)

    def test_the_latest_capture_is_the_one_shown(self):
        owner = self.make_owner()
        LocationCapture.objects.create(
            business_owner=owner, source=LocationCapture.LINK, token_hash="1" * 64, expires_at=timezone.now(),
        )
        newest = LocationCapture.objects.create(business_owner=owner, source=LocationCapture.OWNER_APP, used_at=timezone.now())
        row = self.as_staff(self.ops).get(QUEUE).json()["results"][0]
        self.assertEqual(row["last_capture"]["source"], "owner_app")
        self.assertEqual(newest.source, "owner_app")

    def test_no_row_carries_a_token_hash_or_link(self):
        owner = self.make_owner()
        self.as_staff(self.ops)
        self.client.post("/api/accounts/location-links/", {"business_owner": owner.pk}, format="json")
        raw = LocationCapture.objects.get().token_hash
        text = self.client.get(QUEUE).content.decode()
        self.assertNotIn(raw, text)
        self.assertNotIn("token", text)
        self.assertNotIn("share-location", text)

    def test_history_rows_show_the_decision(self):
        owner = self.make_owner()
        at = timezone.now()
        self.decided(
            owner, verified=True, by=self.gm, at=at, address_verification_method="video_call",
            address_verification_note="Called, matches", address_first_verified_at=at,
        )
        row = self.as_staff(self.ops).get(QUEUE, {"status": "verified"}).json()["results"][0]
        self.assertEqual(row["address_status"], "verified")
        self.assertEqual(
            (row["verification"]["method"], row["verification"]["note"], row["verification"]["by_name"]),
            ("video_call", "Called, matches", self.gm.full_name),
        )
        self.assertIsNotNone(row["verification"]["at"])
        self.assertFalse(row["evidence"]["first_verification"])
        self.assertEqual(row["can_decide"], False)
        self.assertEqual(row["blocked_reason"], "This address has already been decided.")

    def test_can_decide_is_per_requesting_staff_member(self):
        owner = self.make_owner(registered_by=self.gm)
        row = self.as_staff(self.gm).get(QUEUE).json()["results"][0]
        self.assertEqual((row["can_decide"], row["blocked_reason"]), (False, kyc.OWN_REGISTRATION))
        row = self.as_staff(self.ops).get(QUEUE).json()["results"][0]
        self.assertEqual((row["can_decide"], row["blocked_reason"]), (True, None))
        self.assertEqual(row["registrar"]["id"], self.gm.pk)
        self.assertEqual(owner.registered_by, self.gm)

    def test_whoever_last_set_the_pin_cannot_decide(self):
        owner = self.make_owner(location_set_by_staff=self.ops, owner_pin=False)
        row = self.as_staff(self.ops).get(QUEUE).json()["results"][0]
        self.assertEqual((row["can_decide"], row["blocked_reason"]), (False, kyc.OWN_REGISTRATION))
        self.assertEqual(row["pin"]["set_by_staff_name"], self.ops.full_name)
        row = self.as_staff(self.gm).get(QUEUE).json()["results"][0]
        self.assertTrue(row["can_decide"])
        self.assertEqual(owner.pk, row["id"])


class DecideWrongTests(Base):
    def wrong(self, owner, **extra):
        return self.decide(owner, result="wrong", method=extra.pop("method", "desk"), **extra)

    def test_a_reason_is_required(self):
        owner = self.make_owner()
        for note in (None, "", "   "):
            with self.subTest(note=note):
                body = {"note": note} if note is not None else {}
                response = self.wrong(owner, **body)
                self.assertEqual(response.status_code, 400)
                self.assertIn("note", response.json())
        self.assertIsNone(self.profile(owner).address_verified_at)

    def test_marks_the_address_wrong_notifies_the_owner_and_records_it(self):
        owner = self.make_owner()
        response = self.wrong(owner, note="  The video call showed a different street.  ")
        self.assertEqual(response.status_code, 200, response.content)
        profile = self.profile(owner)
        self.assertEqual(
            (profile.address_verified, profile.address_verified_by, profile.address_verification_method,
             profile.address_verification_note),
            (False, self.ops, "desk", "The video call showed a different street."),
        )
        self.assertIsNotNone(profile.address_verified_at)
        self.assertIsNone(profile.address_first_verified_at)
        row = response.json()
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(row["address_status"], "wrong")
        self.assertEqual(row["verification"]["note"], "The video call showed a different street.")
        notice = Notification.objects.get(business_owner=owner)
        self.assertIn("The video call showed a different street.", notice.body)
        self.assertEqual(notice.link, "/business-dashboard")
        event = ActivityEvent.objects.get(verb="address-marked-wrong")
        self.assertEqual((event.actor_id, event.target_id, event.target_type), (self.ops.pk, str(owner.pk), "accounts.businessowner"))

    def test_the_owner_sees_the_reason_and_may_capture_again(self):
        owner = self.make_owner()
        self.wrong(owner, note="Pin is on the wrong side of the road")
        self.as_owner(owner)
        state = self.client.get(ME).json()
        self.assertEqual(state["address_status"], "wrong")
        self.assertEqual(state["wrong_reason"], "Pin is on the wrong side of the road")
        self.assertTrue(state["can_capture"])

    def test_any_method_is_accepted_for_wrong(self):
        for method in ("gps_capture", "video_call", "scout", "desk"):
            with self.subTest(method=method):
                owner = self.make_owner()
                self.assertEqual(self.wrong(owner, method=method, note="No such shop").status_code, 200)

    def test_wrong_needs_no_pin_and_no_profile(self):
        no_pin = self.make_owner(pin=False)
        self.assertEqual(self.wrong(no_pin, note="Address is not a shop").status_code, 200)
        no_profile = self.make_owner(profile=False)
        self.assertEqual(self.wrong(no_profile, note="Address is not a shop").status_code, 200)
        self.assertEqual(self.profile(no_profile).address_verification_note, "Address is not a shop")

    def test_a_recapture_returns_the_business_to_the_queue_and_blanks_method_and_note(self):
        owner = self.make_owner()
        self.wrong(owner, note="Wrong street")
        self.as_owner(owner)
        response = self.client.post(ME, {"lat": 6.6885, "lng": -1.6244, "accuracy_m": 10}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        profile = self.profile(owner)
        self.assertIsNone(profile.address_verified_at)
        self.assertEqual((profile.address_verification_method, profile.address_verification_note), ("", ""))
        self.assertIn(owner.pk, self.ids(self.as_staff(self.ops).get(QUEUE)))


class DecideValidationTests(Base):
    def test_unknown_business_is_404(self):
        self.as_staff(self.ops)
        response = self.client.post(f"{QUEUE}999999/decide/", {"result": "wrong", "method": "desk", "note": "x"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_result_and_method_are_validated(self):
        owner = self.make_owner()
        cases = [
            ({}, "result"),
            ({"result": "maybe", "method": "desk", "note": "x"}, "result"),
            ({"result": "wrong", "method": "psychic", "note": "x"}, "method"),
            ({"result": "wrong", "note": "x"}, "method"),
            ({"result": ["wrong"], "method": "desk", "note": "x"}, "result"),
            ({"result": "wrong", "method": "desk", "note": ["x"]}, "note"),
        ]
        for body, field in cases:
            with self.subTest(body=body):
                response = self.decide(owner, **body)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())
        self.assertIsNone(self.profile(owner).address_verified_at)

    def test_a_very_long_note_is_refused(self):
        owner = self.make_owner()
        response = self.decide(owner, result="wrong", method="desk", note="x" * 1001)
        self.assertEqual(response.status_code, 400)
        self.assertIn("note", response.json())

    def test_an_already_decided_address_is_refused_409(self):
        owner = self.make_owner()
        self.decided(owner, verified=True)
        response = self.decide(owner, result="wrong", method="desk", note="x")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "already_decided")

    def test_a_rejected_business_is_refused_409(self):
        owner = self.make_owner(kyc_status=BusinessOwner.REJECTED)
        response = self.decide(owner, result="wrong", method="desk", note="x")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "kyc_rejected")


class DecideVerifiedTests(Base):
    def test_video_call_with_pin_photo_and_note_verifies(self):
        owner = self.make_owner(registered_by=self.scout)
        before = timezone.now()
        response = self.verify_by_call(owner, note="  Called the owner; the shop front matches.  ")
        self.assertEqual(response.status_code, 200, response.content)
        profile = self.profile(owner)
        self.assertEqual(
            (profile.address_verified, profile.address_verified_by, profile.address_verification_method,
             profile.address_verification_note),
            (True, self.ops, "video_call", "Called the owner; the shop front matches."),
        )
        self.assertGreaterEqual(profile.address_verified_at, before)
        self.assertEqual(profile.address_first_verified_at, profile.address_verified_at)
        row = response.json()
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual((row["address_status"], row["verification"]["method"]), ("verified", "video_call"))
        self.assertFalse(row["evidence"]["first_verification"])
        self.assertEqual(Notification.objects.filter(business_owner=owner).count(), 0)  # only "wrong" tells the owner
        event = ActivityEvent.objects.get(verb="address-verified")
        self.assertEqual((event.actor_id, event.target_id), (self.ops.pk, str(owner.pk)))
        self.assertNotIn("address-marked-wrong", ActivityEvent.objects.values_list("verb", flat=True))

    def test_the_call_note_is_required_for_a_video_call(self):
        owner = self.make_owner()
        for note in (None, "", "  "):
            with self.subTest(note=note):
                body = {} if note is None else {"note": note}
                response = self.decide(owner, result="verified", method="video_call", **body)
                self.assertEqual(response.status_code, 400)
                self.assertIn("note", response.json())
        self.assertIsNone(self.profile(owner).address_verified_at)

    def test_a_pin_is_required(self):
        for fields in ({"profile": False}, {"pin": False}):
            with self.subTest(fields=fields):
                owner = self.make_owner(**fields)
                response = self.verify_by_call(owner)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "pin_required")
                self.assertEqual(response.json()["detail"], kyc.PIN_REQUIRED)

    def test_the_pin_must_be_the_owners_own_device_fix_of_50_m_or_better(self):
        cases = [
            {"accuracy": 51},
            {"owner_pin": False},
            {"location_is_manual": True},
            {"accuracy": None},
        ]
        for fields in cases:
            with self.subTest(fields=fields):
                owner = self.make_owner(**fields)
                response = self.verify_by_call(owner)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "gps_evidence")
                self.assertIsNone(self.profile(owner).address_verified_at)

    def test_exactly_50_m_passes(self):
        owner = self.make_owner(accuracy=50)
        self.assertEqual(self.verify_by_call(owner).status_code, 200)

    def test_the_signboard_photo_is_required(self):
        owner = self.make_owner(signboard=False)
        response = self.verify_by_call(owner)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "signboard_missing")

    def test_gps_capture_alone_is_refused_for_a_first_verification(self):
        owner = self.make_owner()
        response = self.decide(owner, result="verified", method="gps_capture", note="")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "video_call_required")
        self.assertIsNone(self.profile(owner).address_verified_at)

    def test_gps_capture_is_allowed_for_a_reverification_with_the_same_evidence(self):
        owner = self.make_owner(address_first_verified_at=timezone.now() - timedelta(days=30))
        response = self.decide(owner, result="verified", method="gps_capture", note="")
        self.assertEqual(response.status_code, 200, response.content)
        profile = self.profile(owner)
        self.assertEqual(profile.address_verification_method, "gps_capture")
        self.assertLess(profile.address_first_verified_at, profile.address_verified_at)  # never moved

    def test_gps_capture_reverification_still_needs_the_gps_evidence_and_photo(self):
        first = timezone.now() - timedelta(days=30)
        weak = self.make_owner(address_first_verified_at=first, accuracy=80)
        self.assertEqual(self.decide(weak, result="verified", method="gps_capture", note="").json()["code"], "gps_evidence")
        bare = self.make_owner(address_first_verified_at=first, signboard=False)
        self.assertEqual(self.decide(bare, result="verified", method="gps_capture", note="").json()["code"], "signboard_missing")

    def test_a_desk_check_can_only_mark_wrong(self):
        owner = self.make_owner()
        response = self.decide(owner, result="verified", method="desk", note="Looked at the map")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "desk_cannot_verify")

    def test_scout_method_needs_a_visited_assignment_that_confirmed_the_address(self):
        owner = self.make_owner(owner_pin=False, signboard=False)
        missing = self.decide(owner, result="verified", method="scout", note="Scout visited")
        self.assertEqual((missing.status_code, missing.json()["code"]), (400, "scout_report_missing"))
        ScoutAssignment.objects.create(business_owner=owner, scout=self.scout, address_confirmed=True)  # assigned, not visited
        self.assertEqual(self.decide(owner, result="verified", method="scout", note="x").json()["code"], "scout_report_missing")
        ScoutAssignment.objects.filter(business_owner=owner).update(
            status=ScoutAssignment.VISITED, address_confirmed=False, visited_at=timezone.now(),
        )
        self.assertEqual(self.decide(owner, result="verified", method="scout", note="x").json()["code"], "scout_report_missing")
        ScoutAssignment.objects.filter(business_owner=owner).update(address_confirmed=True)
        ok = self.decide(owner, result="verified", method="scout", note="Scout report on file")
        self.assertEqual(ok.status_code, 200, ok.content)
        profile = self.profile(owner)
        self.assertEqual((profile.address_verified, profile.address_verification_method), (True, "scout"))
        self.assertIsNotNone(profile.address_first_verified_at)

    def test_scout_method_still_needs_a_pin(self):
        owner = self.make_owner(pin=False)
        ScoutAssignment.objects.create(
            business_owner=owner, scout=self.scout, status=ScoutAssignment.VISITED, address_confirmed=True,
            visited_at=timezone.now(),
        )
        self.assertEqual(self.decide(owner, result="verified", method="scout", note="x").json()["code"], "pin_required")

    def test_a_recapture_clears_the_decision_but_never_the_first_verification(self):
        owner = self.make_owner()
        self.assertEqual(self.verify_by_call(owner).status_code, 200)
        first = self.profile(owner).address_first_verified_at
        self.assertIsNotNone(first)
        # The owner cannot re-share once verified (409); staff text a new link and the owner shares through it.
        self.as_staff(self.ops)
        link = self.client.post("/api/accounts/location-links/", {"business_owner": owner.pk}, format="json").json()["url"]
        self.client.credentials()
        shared = self.client.post(
            "/api/accounts/location-links/capture/",
            {"token": link.split("#token=")[1], "lat": 6.6886, "lng": -1.6245, "accuracy_m": 9}, format="json",
        )
        self.assertEqual(shared.status_code, 200, shared.content)
        profile = self.profile(owner)
        self.assertIsNone(profile.address_verified_at)
        self.assertEqual((profile.address_verification_method, profile.address_verification_note), ("", ""))
        self.assertEqual(profile.address_first_verified_at, first)
        # The next verification, on the fresh pin, may use gps_capture alone.
        response = self.decide(owner, result="verified", method="gps_capture", note="")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.profile(owner).address_first_verified_at, first)

    def test_a_verified_business_row_moves_out_of_pending_into_history(self):
        owner = self.make_owner()
        self.verify_by_call(owner)
        client = self.as_staff(self.ops)
        self.assertNotIn(owner.pk, self.ids(client.get(QUEUE)))
        self.assertIn(owner.pk, self.ids(client.get(QUEUE, {"status": "verified"})))

    def test_the_decision_lets_kyc_through_the_address_gate(self):
        owner = self.make_owner(registered_by=self.scout)
        self.verify_by_call(owner)
        self.as_staff(self.boss)
        response = self.client.post(f"/api/accounts/kyc/{owner.pk}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)


class MakerCheckerTests(Base):
    def test_the_registrar_is_refused_with_own_registration(self):
        owner = self.make_owner(registered_by=self.gm)
        response = self.verify_by_call(owner, self.gm)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": kyc.OWN_REGISTRATION, "code": "own_registration"})
        wrong = self.decide(owner, self.gm, result="wrong", method="desk", note="x")
        self.assertEqual(wrong.status_code, 403)
        self.assertIsNone(self.profile(owner).address_verified_at)

    def test_a_different_operations_gm_or_super_admin_succeeds(self):
        for verifier in (self.ops, self.gm, self.boss):
            with self.subTest(verifier=verifier.email):
                owner = self.make_owner(registered_by=self.scout)
                self.assertEqual(self.verify_by_call(owner, verifier).status_code, 200)

    def test_super_admin_is_not_exempt_from_their_own_registration(self):
        owner = self.make_owner(registered_by=self.boss)
        self.assertEqual(self.verify_by_call(owner, self.boss).status_code, 403)
        # ...and is the fallback for a business someone else registered, or a second Super Admin.
        self.assertEqual(self.verify_by_call(owner, self.other_boss).status_code, 200)

    def test_the_staff_member_who_last_set_the_pin_is_refused(self):
        owner = self.make_owner(registered_by=self.scout, location_set_by_staff=self.ops, owner_pin=False)
        response = self.verify_by_call(owner, self.ops)
        self.assertEqual((response.status_code, response.json()["code"]), (403, "own_registration"))

    def test_an_owner_capture_after_a_staff_pin_frees_the_staff_member(self):
        owner = self.make_owner(registered_by=self.scout, location_set_by_staff=self.ops)
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(location_set_by_staff=None)
        self.assertEqual(self.verify_by_call(owner, self.ops).status_code, 200)

    def test_account_manager_and_kyc_maker_are_refused_too(self):
        owner = self.make_owner()
        BusinessOwner.objects.filter(pk=owner.pk).update(account_manager=self.gm)
        self.assertEqual(self.verify_by_call(owner, self.gm).status_code, 403)

    def test_is_kyc_submitter_counts_the_pin_setter_for_every_kyc_door(self):
        owner = self.make_owner(location_set_by_staff=self.gm, owner_pin=False)
        self.assertTrue(kyc.is_kyc_submitter(owner, self.gm))
        self.assertFalse(kyc.is_kyc_submitter(owner, self.ops))
        self.as_staff(self.gm)
        self.assertEqual(self.client.post(f"/api/accounts/kyc/{owner.pk}/approve/", {}, format="json").status_code, 403)


class BadgeTests(Base):
    def test_pending_count_for_holders_and_zero_for_others(self):
        self.make_owner()
        self.make_owner(profile=False)
        done = self.make_owner()
        self.decided(done, verified=True)
        self.make_owner(kyc_status=BusinessOwner.REJECTED)
        for staff, expected in ((self.ops, 2), (self.gm, 2), (self.boss, 2), (self.support, 0), (self.scout, 0)):
            with self.subTest(staff=staff.email):
                body = self.as_staff(staff).get(BADGES).json()
                self.assertEqual(body["address_verification"], expected)

    def test_the_count_matches_the_pending_queue(self):
        for _ in range(3):
            self.make_owner()
        count = self.as_staff(self.ops).get(QUEUE).json()["count"]
        self.assertEqual(self.client.get(BADGES).json()["address_verification"], count)


class RealtimeTests(Base):
    def setUp(self):
        super().setUp()
        self.layer = get_channel_layer()
        async_to_sync(self.layer.flush)()

    def listen(self, group):
        channel = async_to_sync(self.layer.new_channel)()
        async_to_sync(self.layer.group_add)(group, channel)
        return channel

    def drain(self, channel):
        async def receive():
            seen = []
            while True:
                try:
                    seen.append(await asyncio.wait_for(self.layer.receive(channel), timeout=0.2))
                except asyncio.TimeoutError:
                    return seen

        return [message["payload"] for message in async_to_sync(receive)()]

    def invalidations(self, channel):
        return [payload["invalidate"] for payload in self.drain(channel) if payload["type"] == "invalidate"]

    def test_the_queue_entry_is_registered(self):
        from realtime.publish import QUEUE_INVALIDATIONS

        self.assertIn(
            (("address-",), ("address.verify",), ("address-verification", "staff-badges")), QUEUE_INVALIDATIONS,
        )

    def test_a_decision_refreshes_the_queue_and_badge_of_every_verifier(self):
        owner = self.make_owner()
        holders = self.listen("perm.address.verify")
        self.as_staff(self.ops)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(decide_url(owner), {"result": "wrong", "method": "desk", "note": "x"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn(["address-verification", "staff-badges"], self.invalidations(holders))

    def test_an_owner_capture_refreshes_the_queue_live(self):
        owner = self.make_owner(pin=False)
        holders = self.listen("perm.address.verify")
        self.as_owner(owner)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(ME, {"lat": 6.6885, "lng": -1.6244, "accuracy_m": 10}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn(["address-verification", "staff-badges"], self.invalidations(holders))

    def test_sending_a_link_refreshes_the_queue_live(self):
        owner = self.make_owner(pin=False)
        holders = self.listen("perm.address.verify")
        self.as_staff(self.ops)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post("/api/accounts/location-links/", {"business_owner": owner.pk}, format="json")
        self.assertIn(["address-verification", "staff-badges"], self.invalidations(holders))


class KycPinGateTests(Base):
    def kyc_ready(self, **fields):
        owner = self.make_owner(registered_by=self.scout, **fields)
        self.decided(owner, verified=True)
        return owner

    def approve(self, owner, staff=None):
        self.as_staff(staff or self.boss)
        return self.client.post(f"/api/accounts/kyc/{owner.pk}/approve/", {}, format="json")

    def test_queue_door_refuses_without_a_pin_and_names_the_code(self):
        for fields in ({"pin": False}, {"profile": False}):
            with self.subTest(fields=fields):
                owner = self.kyc_ready(**fields) if "profile" not in fields else self.make_owner(registered_by=self.scout, profile=False)
                response = self.approve(owner)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"detail": kyc.PIN_REQUIRED, "code": "pin_required"})
                owner.refresh_from_db()
                self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)

    def test_the_message_is_the_contract_text(self):
        self.assertEqual(
            kyc.PIN_REQUIRED,
            "Add the shop's map pin first: send the owner a location link from Address verification.",
        )

    def test_one_missing_coordinate_counts_as_no_pin(self):
        owner = self.kyc_ready()
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(lng=None)
        self.assertEqual(self.approve(owner).json()["code"], "pin_required")

    def test_the_pin_gate_comes_before_the_address_decision(self):
        owner = self.make_owner(registered_by=self.scout, pin=False)  # no pin AND no address decision
        self.assertEqual(self.approve(owner).json()["code"], "pin_required")

    def test_with_a_pin_but_no_address_decision_the_address_message_is_honest(self):
        owner = self.make_owner(registered_by=self.scout)
        response = self.approve(owner)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": kyc.ADDRESS_FIRST})

    def test_a_pinned_and_decided_business_is_approved(self):
        owner = self.kyc_ready()
        self.assertEqual(self.approve(owner).status_code, 200)

    def test_a_pin_of_zero_is_a_pin(self):
        owner = self.kyc_ready(lat=Decimal("0"), lng=Decimal("0"))
        self.assertEqual(self.approve(owner).status_code, 200)

    def test_reject_is_not_gated_by_the_pin(self):
        owner = self.make_owner(registered_by=self.scout, pin=False)
        self.as_staff(self.boss)
        response = self.client.post(f"/api/accounts/kyc/{owner.pk}/reject/", {"reason": "Not a real shop"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_approval_door_refuses_without_a_pin_too(self):
        from approvals import services as approvals
        from approvals.models import ApprovalRequest

        owner = self.make_owner(registered_by=self.scout, pin=False)
        self.decided(owner, verified=True)
        request = approvals.submit(
            self.scout, "business.kyc", target=owner, title="New business", payload={"business_owner_id": owner.pk},
        )
        self.as_staff(self.ops)
        response = self.client.post(f"/api/approvals/{request.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "pin_required")
        self.assertEqual(response.json()["detail"], kyc.PIN_REQUIRED)
        self.assertEqual(ApprovalRequest.objects.get(pk=request.pk).status, ApprovalRequest.PENDING)
        owner.refresh_from_db()
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)


class PublicBodyHardeningTests(Base):
    def test_a_superscript_digit_business_id_is_a_400_not_a_500(self):
        self.as_staff(self.ops)
        for value in ("²", "٣", "1.5", "-1", " ", "12 ", True, None, [], {}):
            with self.subTest(value=value):
                response = self.client.post("/api/accounts/location-links/", {"business_owner": value}, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("business_owner", response.json())

    def test_a_huge_business_id_is_a_404(self):
        self.as_staff(self.ops)
        response = self.client.post("/api/accounts/location-links/", {"business_owner": "9" * 30}, format="json")
        self.assertEqual(response.status_code, 404)


class OldAddressVerifyDoorTests(Base):
    def test_the_kyc_door_keeps_working_and_blanks_a_stale_method_and_note(self):
        owner = self.make_owner(registered_by=self.scout)
        self.decided(owner, verified=False, address_verification_method="desk", address_verification_note="Old reason")
        self.as_staff(self.boss)
        response = self.client.post(f"/api/accounts/kyc/{owner.pk}/address-verify/", {"verified": True}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        profile = self.profile(owner)
        self.assertEqual((profile.address_verified, profile.address_verification_method, profile.address_verification_note), (True, "", ""))

    def test_the_kyc_door_refuses_whoever_last_set_the_pin(self):
        owner = self.make_owner(location_set_by_staff=self.ops, owner_pin=False)
        self.as_staff(self.ops)
        response = self.client.post(f"/api/accounts/kyc/{owner.pk}/address-verify/", {"verified": True}, format="json")
        self.assertEqual(response.status_code, 403)
