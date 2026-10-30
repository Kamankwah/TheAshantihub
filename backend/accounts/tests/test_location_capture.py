"""Shop location capture (plan "shop location and address verification", Task 1): the staff-sent link, the public
preview and capture endpoints, and the owner's own capture. Covers the bearer-token rules (hashed, single use, 48 hours,
revoked by a newer link, POST-only, never in a response or an event) and the fix rules shared by every path."""
import hashlib
import re
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, LocationCapture, Permission
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from otp import senders

LINKS = "/api/accounts/location-links/"
PREVIEW = "/api/accounts/location-links/preview/"
CAPTURE = "/api/accounts/location-links/capture/"
ME = "/api/accounts/me/location/"
KUMASI = {"lat": 6.6885, "lng": -1.6244, "accuracy_m": 12}
TOKEN = re.compile(r"#token=([\w-]+)")


def sha(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def give_verify(staff):
    permission, _ = Permission.objects.get_or_create(codename="address.verify", defaults={"description": "Verify addresses"})
    staff.extra_permissions.add(permission)
    return staff


class Base(TestCase):
    _n = 0

    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.owner = self.make_owner()
        self.ops = give_verify(make_staff("operations", "ops@example.com"))
        self.client = APIClient()

    def make_owner(self, *, kyc=BusinessOwner.PENDING, profile=True, **profile_fields):
        type(self)._n += 1
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {self._n}", login_phone=f"+23324410{self._n:04d}", password_hash="x", kyc_status=kyc,
        )
        if profile:
            BusinessOwnerProfile.objects.create(
                business_owner=owner, business_name=f"Shop {self._n}", gps_address="AK-039-5028", **profile_fields,
            )
        return owner

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def as_owner(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def anon(self):
        self.client.credentials()

    def send_link(self, owner=None, staff=None):
        """Staff send a link; returns (response, raw token)."""
        self.as_staff(staff or self.ops)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(LINKS, {"business_owner": (owner or self.owner).pk}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response, TOKEN.search(response.json()["url"]).group(1)

    def capture(self, raw, **fix):
        self.anon()
        return self.client.post(CAPTURE, {"token": raw, **(fix or KUMASI)}, format="json")

    def profile(self, owner=None):
        return BusinessOwnerProfile.objects.get(business_owner=owner or self.owner)


class StaffSendsLinkTests(Base):
    def test_creates_a_hashed_link_and_returns_the_fragment_url_once(self):
        response, raw = self.send_link()
        body = response.json()
        self.assertEqual(set(body), {"id", "url", "expires_at", "sms_state", "phone_masked"})
        self.assertEqual(body["url"], f"{settings.FRONTEND_BASE_URL}/share-location#token={raw}")
        row = LocationCapture.objects.get()
        self.assertEqual(row.id, body["id"])
        self.assertEqual(row.token_hash, sha(raw))
        self.assertEqual(row.source, "link")
        self.assertEqual(row.business_owner, self.owner)
        self.assertEqual(row.created_by, self.ops)
        self.assertIsNone(row.used_at)
        self.assertIsNone(row.lat)
        window = row.expires_at - row.created_at
        self.assertAlmostEqual(window.total_seconds(), 48 * 3600, delta=5)
        self.assertGreaterEqual(len(raw), 43)  # secrets.token_urlsafe(32)

    def test_the_raw_token_is_stored_nowhere(self):
        _, raw = self.send_link()
        row = LocationCapture.objects.values().get()
        self.assertNotIn(raw, [str(value) for value in row.values()])
        for event in ActivityEvent.objects.all():
            self.assertNotIn(raw, str(event.__dict__))
            self.assertNotIn("token=", str(event.__dict__))
            self.assertNotIn(sha(raw), str(event.__dict__))

    def test_text_goes_out_once_to_the_owner_with_the_link(self):
        response, raw = self.send_link()
        self.assertEqual(len(senders.sms_outbox), 1)
        text = senders.sms_outbox[0]
        self.assertEqual(text.to, self.owner.login_phone)
        self.assertEqual(
            text.body,
            "AshantiHub: open this link on your phone while you are at your shop to share its location: "
            f"{response.json()['url']} . It works once and expires in 48 hours.",
        )
        self.assertEqual(response.json()["sms_state"], "sent")
        self.assertEqual(response.json()["phone_masked"], "024 *** " + self.owner.login_phone[-4:])
        self.assertLessEqual(len(text.body), 306)

    @override_settings(OTP_SMS_PROVIDER="simulated")
    def test_simulated_texts_are_reported_honestly(self):
        response, _ = self.send_link()
        self.assertEqual(response.json()["sms_state"], "simulated")
        self.assertEqual(senders.sms_outbox, [])

    def test_a_failed_text_is_reported_and_does_not_fail_the_request(self):
        from unittest import mock

        with mock.patch("otp.senders.send_sms", return_value=senders.Delivery(ok=False, provider="hubtel")):
            response, _ = self.send_link()
        self.assertEqual(response.json()["sms_state"], "failed")

    def test_an_owner_whose_number_is_a_staff_members_gets_no_text(self):
        make_staff("support", "help@example.com", phone=self.owner.login_phone)
        response, _ = self.send_link()
        self.assertEqual(response.json()["sms_state"], "no_phone")
        self.assertEqual(response.json()["phone_masked"], "")
        self.assertEqual(senders.sms_outbox, [])

    def test_an_owner_with_no_usable_number_gets_no_text(self):
        owner = self.make_owner()
        BusinessOwner.objects.filter(pk=owner.pk).update(login_phone="12345")
        response, _ = self.send_link(owner)
        self.assertEqual(response.json()["sms_state"], "no_phone")
        self.assertEqual(senders.sms_outbox, [])

    def test_a_new_link_revokes_every_older_live_one(self):
        _, first = self.send_link()
        _, second = self.send_link()
        first_row = LocationCapture.objects.get(token_hash=sha(first))
        self.assertIsNotNone(first_row.revoked_at)
        self.assertIsNone(LocationCapture.objects.get(token_hash=sha(second)).revoked_at)
        response = self.capture(first)
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "revoked")
        self.assertEqual(self.capture(second).status_code, 200)

    def test_a_new_link_leaves_other_businesses_links_alone(self):
        other = self.make_owner()
        _, mine = self.send_link()
        self.send_link(other)
        self.assertIsNone(LocationCapture.objects.get(token_hash=sha(mine)).revoked_at)

    def test_at_most_five_links_per_business_per_day(self):
        for _ in range(5):
            self.send_link()
        self.as_staff(self.ops)
        response = self.client.post(LINKS, {"business_owner": self.owner.pk}, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "too_many_links")
        self.assertEqual(LocationCapture.objects.count(), 5)
        self.assertEqual(len(senders.sms_outbox), 5)
        # another business is unaffected
        self.send_link(self.make_owner())

    def test_yesterdays_links_do_not_count_toward_the_cap(self):
        for _ in range(5):
            self.send_link()
        LocationCapture.objects.update(created_at=timezone.now() - timedelta(days=1))
        self.send_link()

    def test_unknown_business_is_404(self):
        self.as_staff(self.ops)
        self.assertEqual(self.client.post(LINKS, {"business_owner": 99999}, format="json").status_code, 404)
        self.assertEqual(self.client.post(LINKS, {}, format="json").status_code, 400)
        self.assertEqual(self.client.post(LINKS, {"business_owner": "abc"}, format="json").status_code, 400)

    def test_rejected_kyc_is_409(self):
        owner = self.make_owner(kyc=BusinessOwner.REJECTED)
        self.as_staff(self.ops)
        response = self.client.post(LINKS, {"business_owner": owner.pk}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "kyc_rejected")
        self.assertFalse(LocationCapture.objects.exists())

    def test_needs_the_address_verify_permission(self):
        support = make_staff("support", "help@example.com")
        self.as_staff(support)
        self.assertEqual(self.client.post(LINKS, {"business_owner": self.owner.pk}, format="json").status_code, 403)
        scout = make_staff("scout", "scout@example.com")
        self.as_staff(scout)
        self.assertEqual(self.client.post(LINKS, {"business_owner": self.owner.pk}, format="json").status_code, 403)
        self.as_owner(self.owner)
        self.assertEqual(self.client.post(LINKS, {"business_owner": self.owner.pk}, format="json").status_code, 403)
        self.anon()
        self.assertEqual(self.client.post(LINKS, {"business_owner": self.owner.pk}, format="json").status_code, 401)
        self.assertFalse(LocationCapture.objects.exists())
        self.assertEqual(senders.sms_outbox, [])

    def test_sending_is_recorded_without_the_link(self):
        _, raw = self.send_link()
        event = ActivityEvent.objects.get(verb="address-location-link-sent")
        self.assertEqual(event.actor_type, ActivityEvent.STAFF)
        self.assertEqual(event.actor_id, self.ops.pk)
        self.assertEqual(event.target_id, str(self.owner.pk))
        self.assertNotIn(raw, str(event.__dict__))

    def test_get_is_not_allowed(self):
        self.as_staff(self.ops)
        self.assertEqual(self.client.get(LINKS).status_code, 405)


class PreviewTests(Base):
    def preview(self, raw):
        self.anon()
        return self.client.post(PREVIEW, {"token": raw}, format="json")

    def test_a_live_link_shows_only_the_business_name_and_expiry(self):
        _, raw = self.send_link()
        response = self.preview(raw)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"business_name", "valid", "expires_at"})
        self.assertEqual(body["business_name"], self.owner.display_name)
        self.assertIs(body["valid"], True)
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertNotIn(self.owner.login_phone, response.content.decode())

    def test_previewing_does_not_use_the_link_up(self):
        _, raw = self.send_link()
        self.preview(raw)
        self.preview(raw)
        self.assertEqual(self.capture(raw).status_code, 200)

    def test_missing_or_unknown_token_is_400_invalid(self):
        for body in ({}, {"token": ""}, {"token": "nope"}, {"token": 12}, {"token": ["x"]}):
            self.anon()
            response = self.client.post(PREVIEW, body, format="json")
            self.assertEqual(response.status_code, 400, body)
            self.assertEqual(response.json()["code"], "invalid")
            self.assertEqual(response["Cache-Control"], "no-store")
            self.assertEqual(response["Referrer-Policy"], "no-referrer")

    def test_dead_links_are_410_with_a_reason(self):
        _, used = self.send_link()
        self.capture(used)
        self.assertEqual(self.preview(used).json()["code"], "used")
        _, expired = self.send_link()
        LocationCapture.objects.filter(token_hash=sha(expired)).update(expires_at=timezone.now() - timedelta(seconds=1))
        _, newest = self.send_link()
        # `expired` was also revoked by `newest`; expiry is checked on a link that is otherwise live
        other = self.make_owner()
        _, lapsed = self.send_link(other)
        LocationCapture.objects.filter(token_hash=sha(lapsed)).update(expires_at=timezone.now() - timedelta(seconds=1))
        response = self.preview(lapsed)
        self.assertEqual((response.status_code, response.json()["code"]), (410, "expired"))
        response = self.preview(expired)
        self.assertEqual((response.status_code, response.json()["code"]), (410, "revoked"))
        closed_owner = self.make_owner()
        _, closed = self.send_link(closed_owner)
        BusinessOwner.objects.filter(pk=closed_owner.pk).update(kyc_status=BusinessOwner.REJECTED)
        response = self.preview(closed)
        self.assertEqual((response.status_code, response.json()["code"]), (410, "closed"))
        self.assertEqual(self.preview(newest).status_code, 200)

    def test_get_is_not_allowed_so_the_token_is_never_in_a_url(self):
        self.anon()
        self.assertEqual(self.client.get(PREVIEW).status_code, 405)
        self.assertEqual(self.client.get(CAPTURE).status_code, 405)
        self.assertEqual(self.client.get(PREVIEW + "?token=abc").status_code, 405)

    def test_a_stale_authorization_header_changes_nothing(self):
        _, raw = self.send_link()
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.client.post(PREVIEW, {"token": raw}, format="json").status_code, 200)

    def test_the_throttle_answers_with_the_same_headers(self):
        _, raw = self.send_link()
        self.anon()
        last = None
        for _ in range(16):
            last = self.client.post(PREVIEW, {"token": raw}, format="json")
        self.assertEqual(last.status_code, 429)
        self.assertEqual(last["Cache-Control"], "no-store")
        self.assertEqual(last["Referrer-Policy"], "no-referrer")


class PublicCaptureTests(Base):
    def test_writes_the_pin_with_its_accuracy_and_uses_the_link_up(self):
        _, raw = self.send_link()
        before = timezone.now()
        response = self.capture(raw, lat=6.688512349, lng=-1.624411, accuracy_m=12.2)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(set(body), {"business_name", "accuracy_m", "captured_at"})
        self.assertEqual(body["accuracy_m"], 13)  # ceil
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        profile = self.profile()
        self.assertEqual(profile.lat, Decimal("6.688512"))
        self.assertEqual(profile.lng, Decimal("-1.624411"))
        self.assertEqual(profile.location_accuracy_m, 13)
        self.assertEqual(profile.location_set_by, "owner")
        self.assertFalse(profile.location_is_manual)
        self.assertIsNone(profile.location_set_by_staff)
        self.assertGreaterEqual(profile.location_set_at, before)
        row = LocationCapture.objects.get()
        self.assertEqual((row.lat, row.lng, row.accuracy_m), (Decimal("6.688512"), Decimal("-1.624411"), 13))
        self.assertIsNotNone(row.used_at)
        self.assertEqual(row.captured_at, row.used_at)

    def test_a_replay_is_410_used_and_changes_nothing(self):
        _, raw = self.send_link()
        self.assertEqual(self.capture(raw).status_code, 200)
        profile = self.profile()
        response = self.capture(raw, lat=6.7, lng=-1.6, accuracy_m=5)
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "used")
        self.assertEqual(self.profile().lat, profile.lat)
        self.assertEqual(ActivityEvent.objects.filter(verb="address-location-captured").count(), 1)

    def test_an_expired_link_is_410_and_writes_nothing(self):
        _, raw = self.send_link()
        LocationCapture.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        response = self.capture(raw)
        self.assertEqual((response.status_code, response.json()["code"]), (410, "expired"))
        self.assertIsNone(self.profile().lat)

    def test_unknown_token_is_400_invalid(self):
        response = self.capture("nope")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "invalid"))

    def test_rejected_kyc_closes_the_link(self):
        _, raw = self.send_link()
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.REJECTED)
        response = self.capture(raw)
        self.assertEqual((response.status_code, response.json()["code"]), (410, "closed"))
        self.assertIsNone(self.profile().lat)

    def test_a_fix_worse_than_100_m_is_refused_and_the_link_survives(self):
        _, raw = self.send_link()
        for accuracy in (100.01, 101, 850, 5000, 400000):  # 5000 m: an IP-based or desktop location
            response = self.capture(raw, lat=6.69, lng=-1.62, accuracy_m=accuracy)
            self.assertEqual(response.status_code, 400, accuracy)
            self.assertIn("accuracy_m", response.json())
        shown = self.capture(raw, lat=6.69, lng=-1.62, accuracy_m=850).json()["accuracy_m"][0]
        self.assertEqual(
            shown,
            "Your phone's location is only accurate to ±850 m. We need 100 m or better: "
            "step outside or near a window and try again.",
        )
        self.assertIsNone(self.profile().lat)
        self.assertIsNone(LocationCapture.objects.get().used_at)
        self.assertEqual(self.capture(raw, lat=6.69, lng=-1.62, accuracy_m=100).status_code, 200)  # exactly 100 is fine

    def test_a_location_outside_the_ashanti_region_is_refused(self):
        _, raw = self.send_link()
        for lat, lng in ((5.6037, -0.187), (9.4, -0.84), (6.69, 0.2), (6.69, -3.2), (0, 0), (5.49, -1.6), (7.81, -1.6)):
            response = self.capture(raw, lat=lat, lng=lng, accuracy_m=10)  # Accra, Tamale, ...
            self.assertEqual(response.status_code, 400, (lat, lng))
            self.assertEqual(
                response.json()["lat"], ["This location isn't in the Ashanti Region. Share it from your shop."],
            )
        self.assertIsNone(self.profile().lat)
        self.assertEqual(self.capture(raw, lat=5.5, lng=-2.7, accuracy_m=10).status_code, 200)  # the box edge is inside

    def test_missing_and_malformed_numbers_are_refused(self):
        _, raw = self.send_link()
        for fix in (
            {"lat": 6.7, "lng": -1.6}, {"lat": 6.7, "accuracy_m": 5}, {"lng": -1.6, "accuracy_m": 5},
            {"lat": "nan", "lng": -1.6, "accuracy_m": 5}, {"lat": 6.7, "lng": "inf", "accuracy_m": 5},
            {"lat": 6.7, "lng": -1.6, "accuracy_m": "nan"}, {"lat": "x", "lng": -1.6, "accuracy_m": 5},
            {"lat": None, "lng": -1.6, "accuracy_m": 5}, {"lat": 6.7, "lng": -1.6, "accuracy_m": -1},
        ):
            self.assertEqual(self.capture(raw, **fix).status_code, 400, fix)
        self.assertIsNone(self.profile().lat)

    def test_a_business_with_no_profile_gets_one(self):
        owner = self.make_owner(profile=False)
        _, raw = self.send_link(owner)
        self.assertEqual(self.capture(raw).status_code, 200)
        profile = self.profile(owner)
        self.assertEqual(profile.location_set_by, "owner")
        self.assertEqual(profile.lat, Decimal("6.688500"))

    def test_a_new_pin_clears_an_existing_address_decision(self):
        staff = make_staff("super_admin", "root@example.com")
        profile = self.profile()
        profile.address_verified, profile.address_verified_by, profile.address_verified_at = True, staff, timezone.now()
        profile.lat, profile.lng, profile.location_accuracy_m = Decimal("6.7"), Decimal("-1.6"), 9
        profile.location_set_by_staff = staff
        profile.save()
        _, raw = self.send_link()
        self.assertEqual(self.capture(raw).status_code, 200)
        profile = self.profile()
        self.assertFalse(profile.address_verified)
        self.assertIsNone(profile.address_verified_by)
        self.assertIsNone(profile.address_verified_at)
        self.assertIsNone(profile.location_set_by_staff)
        self.assertEqual(profile.lat, Decimal("6.688500"))

    def test_the_capture_is_recorded_with_the_owner_as_actor_and_no_token(self):
        _, raw = self.send_link()
        self.capture(raw)
        event = ActivityEvent.objects.get(verb="address-location-captured")
        self.assertEqual(event.actor_type, ActivityEvent.BUSINESS_OWNER)
        self.assertEqual(event.actor_id, self.owner.pk)
        self.assertEqual(event.target_id, str(self.owner.pk))
        self.assertEqual(event.after, {"accuracy_m": 12, "source": "link"})
        for blob in (str(event.__dict__), event.summary):
            self.assertNotIn(raw, blob)
            self.assertNotIn(sha(raw), blob)
            self.assertNotIn("token=", blob)

    def test_the_views_write_no_event_of_their_own(self):
        """activity_exempt: the middleware must not store the request body (it holds the token)."""
        _, raw = self.send_link()
        self.capture(raw)
        self.client.post(PREVIEW, {"token": raw}, format="json")
        for event in ActivityEvent.objects.all():
            self.assertNotIn(raw, str(event.__dict__))


class OwnerOwnCaptureTests(Base):
    def test_get_with_no_pin(self):
        self.as_owner(self.owner)
        response = self.client.get(ME)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"pin": None, "address_status": "not_verified", "wrong_reason": None, "can_capture": True},
        )

    def test_get_with_a_pin(self):
        owner = self.make_owner(
            lat=Decimal("6.700000"), lng=Decimal("-1.610000"), location_accuracy_m=12, location_set_by="owner",
            location_set_at=timezone.now(),
        )
        self.as_owner(owner)
        pin = self.client.get(ME).json()["pin"]
        self.assertEqual(set(pin), {"lat", "lng", "accuracy_m", "set_by", "set_at", "is_manual"})
        self.assertEqual((pin["lat"], pin["lng"], pin["accuracy_m"], pin["set_by"], pin["is_manual"]), (6.7, -1.61, 12, "owner", False))

    def test_get_for_a_business_with_no_profile(self):
        owner = self.make_owner(profile=False)
        self.as_owner(owner)
        self.assertEqual(self.client.get(ME).json()["pin"], None)

    def test_address_status_follows_the_decision(self):
        profile = self.profile()
        self.as_owner(self.owner)
        profile.lat, profile.lng = Decimal("6.688500"), Decimal("-1.624400")  # a verified address with a pin is locked
        profile.address_verified_at, profile.address_verified = timezone.now(), True
        profile.save()
        body = self.client.get(ME).json()
        self.assertEqual((body["address_status"], body["can_capture"], body["wrong_reason"]), ("verified", False, None))
        profile.address_verified = False
        profile.save()
        body = self.client.get(ME).json()
        self.assertEqual((body["address_status"], body["can_capture"]), ("wrong", True))

    def test_rejected_kyc_cannot_capture(self):
        owner = self.make_owner(kyc=BusinessOwner.REJECTED)
        self.as_owner(owner)
        self.assertIs(self.client.get(ME).json()["can_capture"], False)

    def test_only_a_business_owner_may_use_it(self):
        customer = Customer.objects.create(full_name="C", email="c@example.com", password_hash="x")
        for method in ("get", "post"):
            self.as_staff(self.ops)
            self.assertEqual(getattr(self.client, method)(ME).status_code, 403)
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
            self.assertEqual(getattr(self.client, method)(ME).status_code, 403)
            self.anon()
            self.assertEqual(getattr(self.client, method)(ME).status_code, 401)

    def test_post_sets_the_pin_and_returns_the_get_shape(self):
        self.as_owner(self.owner)
        response = self.client.post(ME, KUMASI, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(set(body), {"pin", "address_status", "wrong_reason", "can_capture"})
        self.assertEqual(body["pin"]["accuracy_m"], 12)
        self.assertEqual(body["pin"]["set_by"], "owner")
        profile = self.profile()
        self.assertEqual((profile.lat, profile.lng, profile.location_accuracy_m), (Decimal("6.688500"), Decimal("-1.624400"), 12))
        self.assertEqual(profile.location_set_by, "owner")
        self.assertFalse(profile.location_is_manual)
        row = LocationCapture.objects.get()
        self.assertEqual((row.source, row.token_hash, row.expires_at, row.created_by), ("owner_app", None, None, None))
        self.assertIsNotNone(row.captured_at)
        event = ActivityEvent.objects.get(verb="address-location-captured")
        self.assertEqual(event.after, {"accuracy_m": 12, "source": "owner_app"})
        self.assertEqual(event.actor_type, ActivityEvent.BUSINESS_OWNER)

    def test_post_applies_the_shared_rules(self):
        self.as_owner(self.owner)
        response = self.client.post(ME, {**KUMASI, "accuracy_m": 400}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("±400 m", response.json()["accuracy_m"][0])
        response = self.client.post(ME, {**KUMASI, "lat": 5.6, "lng": -0.19}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("lat", response.json())
        self.assertFalse(LocationCapture.objects.exists())
        self.assertIsNone(self.profile().lat)

    def test_a_verified_address_cannot_be_recaptured(self):
        profile = self.profile()
        profile.lat, profile.lng = Decimal("6.688500"), Decimal("-1.624400")
        profile.address_verified, profile.address_verified_at = True, timezone.now()
        profile.save()
        self.as_owner(self.owner)
        response = self.client.post(ME, KUMASI, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "address_verified")
        self.assertEqual(
            response.json()["detail"],
            "Your shop's location is verified. To change it, contact AshantiHub Support.",
        )
        self.assertEqual(self.profile().lat, Decimal("6.688500"))

    def test_a_verified_address_with_no_pin_is_not_locked_and_a_capture_returns_it_to_the_queue(self):
        # An old door once marked "verified" without a pin. There is nothing to protect, so the owner may share one.
        profile = self.profile()
        profile.address_verified, profile.address_verified_at = True, timezone.now()
        profile.address_verification_method, profile.address_verification_note = "desk", "old"
        profile.save()
        self.as_owner(self.owner)
        state = self.client.get(ME).json()
        self.assertEqual((state["pin"], state["address_status"], state["can_capture"]), (None, "verified", True))
        response = self.client.post(ME, KUMASI, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["address_status"], "not_verified")
        profile = self.profile()
        self.assertEqual((profile.address_verified, profile.address_verified_at), (False, None))
        self.assertEqual((profile.address_verification_method, profile.address_verification_note), ("", ""))
        self.assertIsNotNone(profile.lat)

    def test_rejected_kyc_is_409(self):
        owner = self.make_owner(kyc=BusinessOwner.REJECTED)
        self.as_owner(owner)
        response = self.client.post(ME, KUMASI, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "kyc_rejected"))

    def test_a_wrong_address_can_be_recaptured_and_returns_to_the_queue(self):
        profile = self.profile()
        profile.address_verified, profile.address_verified_at = False, timezone.now()
        profile.save()
        self.as_owner(self.owner)
        body = self.client.post(ME, KUMASI, format="json").json()
        self.assertEqual(body["address_status"], "not_verified")
        self.assertIsNone(self.profile().address_verified_at)

    def test_it_creates_the_profile_when_missing(self):
        owner = self.make_owner(profile=False)
        self.as_owner(owner)
        self.assertEqual(self.client.post(ME, KUMASI, format="json").status_code, 200)
        self.assertEqual(self.profile(owner).location_set_by, "owner")

    def test_the_five_a_day_cap_does_not_apply_to_the_owners_own_captures(self):
        self.as_owner(self.owner)
        for _ in range(6):
            self.assertEqual(self.client.post(ME, KUMASI, format="json").status_code, 200)


class OwnerLocationThrottleTests(Base):
    def test_the_owners_own_capture_is_throttled_to_ten_a_minute_and_reading_is_not(self):
        from accounts.views_location import MyLocationView

        self.assertEqual(MyLocationView.throttle_scope, "owner_location")
        self.assertEqual(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["owner_location"], "10/min")
        self.as_owner(self.owner)
        for _ in range(10):
            self.assertEqual(self.client.post(ME, {"lat": 1, "lng": 1, "accuracy_m": 5}, format="json").status_code, 400)
        self.assertEqual(self.client.post(ME, KUMASI, format="json").status_code, 429)
        self.assertEqual(self.client.get(ME).status_code, 200)


class NoLinkLeakTests(Base):
    def test_no_get_response_or_event_carries_the_token(self):
        response, raw = self.send_link()
        self.capture(raw)
        _, live = self.send_link()
        root = make_staff("super_admin", "root@example.com")
        needles = [raw, live, sha(raw), sha(live)]
        for who, urls in (
            (lambda: self.as_staff(root), [
                "/api/activity/", f"/api/portfolio/businesses/{self.owner.pk}/",
                "/api/portfolio/businesses/", "/api/accounts/kyc/pending/", f"/api/accounts/kyc/{self.owner.pk}/",
            ]),
            (lambda: self.as_owner(self.owner), [ME, "/api/accounts/me/"]),
        ):
            who()
            for url in urls:
                reply = self.client.get(url)
                self.assertEqual(reply.status_code, 200, url)  # a 403 would prove nothing
                text = b"".join(reply.streaming_content).decode() if getattr(reply, "streaming", False) else reply.content.decode()
                for needle in needles:
                    self.assertNotIn(needle, text, url)
                self.assertNotIn("token=", text, url)
        for event in ActivityEvent.objects.all():
            for needle in needles:
                self.assertNotIn(needle, str(event.__dict__))
            self.assertNotIn("token=", str(event.__dict__))
