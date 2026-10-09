import tempfile
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, ScoutAssignment
from accounts.testing import make_staff, staff_token
from field import services
from field.models import VisitCheckIn
from field.tasks import close_abandoned_visits
from fraud.models import FraudFlag
from portfolio import health
from portfolio.tests.health_fixtures import image, make_business, make_healthy

TEST_MEDIA_ROOT = tempfile.mkdtemp()
PIN = (6.688500, -1.624400)  # Kumasi
VISITS = "/api/field/visits/"


def fix(metres_north=0.0, accuracy=12):
    """A position `metres_north` metres north of the pin (1 degree of latitude is 111195 m)."""
    return {"lat": PIN[0] + metres_north / 111195.0, "lng": PIN[1], "accuracy_m": accuracy}


def pin_business(name, manager, *, pinned=True):
    owner = make_business(name, manager=manager)
    if pinned:
        profile = owner.profile
        profile.lat, profile.lng = PIN
        profile.save()
    return owner


class DistanceTests(SimpleTestCase):
    def test_one_degree_of_latitude_is_about_111_km(self):
        self.assertAlmostEqual(services.haversine_m(6, 0, 7, 0), 111195, delta=100)

    def test_the_same_point_is_zero_metres(self):
        self.assertEqual(services.haversine_m(*PIN, *PIN), 0)

    def test_longitude_shrinks_with_latitude(self):
        at_equator = services.haversine_m(0, 0, 0, 1)
        at_kumasi = services.haversine_m(PIN[0], 0, PIN[0], 1)
        self.assertLess(at_kumasi, at_equator)


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class VisitApiBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.adwoa = pin_business("Adwoa Fabrics", self.kwame)

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def check_in(self, owner=None, purpose="subscription_follow_up", **position):
        self.as_staff(position.pop("who", self.kwame))
        body = {"business_owner": (owner or self.adwoa).pk, "purpose": purpose, **(position or fix(38))}
        return self.client.post(VISITS, body, format="json")


class CheckInTests(VisitApiBase):
    def test_a_check_in_inside_the_radius_measures_the_distance(self):
        response = self.check_in(**fix(38))
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["status"], "open")
        self.assertAlmostEqual(response.data["distance_m"], 38, delta=1)
        self.assertFalse(response.data["outside_radius"])
        self.assertEqual(response.data["business"]["name"], "Adwoa Fabrics")
        self.assertIsNotNone(response.data["pin"])

    def test_the_server_stamps_the_time(self):
        before = timezone.now()
        visit = VisitCheckIn.objects.get(pk=self.check_in().data["id"])
        self.assertGreaterEqual(visit.checked_in_at, before)

    def test_outside_the_radius_is_saved_and_flagged(self):
        response = self.check_in(**fix(180))
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["outside_radius"])
        self.assertAlmostEqual(response.data["distance_m"], 180, delta=1)

    def test_exactly_at_the_radius_is_not_flagged(self):
        self.assertFalse(self.check_in(**fix(99)).data["outside_radius"])

    def test_a_business_with_no_pin_has_no_distance_and_is_not_flagged(self):
        owner = pin_business("Pinless Shop", self.kwame, pinned=False)
        response = self.check_in(owner)
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data["distance_m"])
        self.assertFalse(response.data["outside_radius"])
        self.assertIsNone(response.data["pin"])
        self.assertFalse(response.data["business"]["has_pin"])

    def test_a_pin_at_zero_zero_is_treated_as_no_pin(self):
        owner = pin_business("Null Island", self.kwame, pinned=False)
        owner.profile.lat = owner.profile.lng = 0
        owner.profile.save()
        self.assertIsNone(self.check_in(owner).data["distance_m"])

    def test_without_a_location_it_is_a_400(self):
        self.as_staff(self.kwame)
        response = self.client.post(VISITS, {"business_owner": self.adwoa.pk, "purpose": "prospecting"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Location is needed to check in")
        self.assertEqual(VisitCheckIn.objects.count(), 0)

    def test_a_rough_fix_is_refused(self):
        response = self.check_in(**fix(10, accuracy=450))
        self.assertEqual(response.status_code, 400)
        self.assertIn("too rough", response.data["detail"])

    def test_a_fix_outside_ghana_is_refused(self):
        response = self.check_in(lat=51.5, lng=-0.12, accuracy_m=10)
        self.assertEqual(response.status_code, 400)
        self.assertIn("isn't in Ghana", response.data["detail"])

    def test_a_purpose_is_needed_for_a_business(self):
        self.as_staff(self.kwame)
        response = self.client.post(VISITS, {"business_owner": self.adwoa.pk, **fix(10)}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_verification_cannot_be_picked_for_a_managed_business(self):
        self.assertEqual(self.check_in(purpose="verification").status_code, 400)

    def test_a_second_open_visit_is_a_409_naming_the_first(self):
        self.check_in()
        other = pin_business("Nana's Chop Bar", self.kwame)
        response = self.check_in(other)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["detail"], "Check out of Adwoa Fabrics first")
        self.assertEqual(VisitCheckIn.objects.filter(scout=self.kwame).count(), 1)

    def test_the_database_allows_one_open_visit_per_scout(self):
        from django.db import IntegrityError, transaction

        self.check_in()
        with self.assertRaises(IntegrityError), transaction.atomic():
            VisitCheckIn.objects.create(
                scout=self.kwame, business_owner=self.adwoa, purpose="prospecting",
                checked_in_at=timezone.now(), lat=PIN[0], lng=PIN[1], accuracy_m=5,
            )

    def test_another_scouts_business_is_a_404(self):
        response = self.check_in(self.adwoa, who=self.efua)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(VisitCheckIn.objects.count(), 0)

    def test_a_check_in_is_recorded_in_the_activity_log(self):
        from activity.models import ActivityEvent

        self.check_in()
        self.assertTrue(ActivityEvent.objects.filter(verb="visit.check_in").exists())

    def test_support_staff_cannot_check_in(self):
        support = make_staff("support", "esi@example.com")
        self.assertEqual(self.check_in(who=support).status_code, 403)


class VerificationVisitTests(VisitApiBase):
    def setUp(self):
        super().setUp()
        self.other = pin_business("Yaw's Garage", None)
        self.assignment = ScoutAssignment.objects.create(business_owner=self.other, scout=self.kwame)

    def post(self, who, assignment, **position):
        self.as_staff(who)
        return self.client.post(VISITS, {"scout_assignment": assignment.pk, **(position or fix(20))}, format="json")

    def test_an_assigned_scout_can_check_in_and_the_purpose_is_verification(self):
        response = self.post(self.kwame, self.assignment)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["purpose"], "verification")
        self.assertEqual(response.data["scout_assignment_id"], self.assignment.pk)
        self.assertEqual(response.data["business"]["name"], "Yaw's Garage")

    def test_another_scouts_assignment_is_a_404(self):
        self.assertEqual(self.post(self.efua, self.assignment).status_code, 404)

    def test_a_visited_assignment_is_no_longer_a_target(self):
        self.assignment.status = ScoutAssignment.VISITED
        self.assignment.save()
        self.assertEqual(self.post(self.kwame, self.assignment).status_code, 404)

    def test_the_purpose_of_a_verification_cannot_change(self):
        visit_id = self.post(self.kwame, self.assignment).data["id"]
        response = self.client.patch(f"{VISITS}{visit_id}/", {"purpose": "prospecting"}, format="json")
        self.assertEqual(response.status_code, 400)


class CheckOutTests(VisitApiBase):
    def open_visit(self):
        return self.check_in().data["id"]

    def check_out(self, visit_id, who=None, body=None):
        self.as_staff(who or self.kwame)
        return self.client.post(f"{VISITS}{visit_id}/check-out/", body if body is not None else {**fix(30), "notes": "Paid."}, format="json")

    def test_check_out_closes_the_visit_with_notes_and_a_stay(self):
        visit_id = self.open_visit()
        VisitCheckIn.objects.filter(pk=visit_id).update(checked_in_at=timezone.now() - timedelta(minutes=14))
        response = self.check_out(visit_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["status"], "done")
        self.assertEqual(response.data["notes"], "Paid.")
        self.assertEqual(response.data["minutes"], 14)
        visit = VisitCheckIn.objects.get(pk=visit_id)
        self.assertIsNotNone(visit.checked_out_at)
        self.assertIsNotNone(visit.out_lat)

    def test_check_out_needs_a_location(self):
        visit_id = self.open_visit()
        response = self.check_out(visit_id, body={"notes": "x"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Location is needed to check out")
        self.assertEqual(VisitCheckIn.objects.get(pk=visit_id).status, "open")

    def test_a_visit_cannot_be_checked_out_twice(self):
        visit_id = self.open_visit()
        self.check_out(visit_id)
        self.assertEqual(self.check_out(visit_id).status_code, 409)

    def test_nobody_checks_out_another_scouts_visit(self):
        visit_id = self.open_visit()
        self.assertEqual(self.check_out(visit_id, who=self.efua).status_code, 404)

    def test_after_check_out_a_new_visit_can_start(self):
        self.check_out(self.open_visit())
        self.assertEqual(self.check_in().status_code, 201)

    def test_purpose_and_notes_change_while_open_only(self):
        visit_id = self.open_visit()
        response = self.client.patch(f"{VISITS}{visit_id}/", {"purpose": "info_update", "notes": "Hours changed."}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["purpose"], "info_update")
        self.check_out(visit_id)
        self.assertEqual(self.client.patch(f"{VISITS}{visit_id}/", {"notes": "late"}, format="json").status_code, 409)

    def test_open_endpoint_returns_the_open_visit_or_null(self):
        self.as_staff(self.kwame)
        self.assertIsNone(self.client.get("/api/field/visits/open/").data["visit"])
        visit_id = self.open_visit()
        self.assertEqual(self.client.get("/api/field/visits/open/").data["visit"]["id"], visit_id)
        self.check_out(visit_id)
        self.assertIsNone(self.client.get("/api/field/visits/open/").data["visit"])


class VisitPhotoTests(VisitApiBase):
    def test_a_photo_is_stored_with_its_own_location(self):
        visit_id = self.check_in().data["id"]
        response = self.client.post(
            f"{VISITS}{visit_id}/photos/", {"image": image(), "lat": "6.6886", "lng": "-1.6244", "accuracy_m": "9"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        photo = VisitCheckIn.objects.get(pk=visit_id).photos.get()
        self.assertEqual(photo.accuracy_m, 9)
        self.assertAlmostEqual(float(photo.lat), 6.6886, places=4)
        self.assertIsNotNone(photo.taken_at)
        shown = self.client.get("/api/field/visits/open/").data["visit"]
        self.assertEqual(len(shown["photos"]), 1)

    def test_a_photo_without_a_position_is_still_kept(self):
        visit_id = self.check_in().data["id"]
        response = self.client.post(f"{VISITS}{visit_id}/photos/", {"image": image()}, format="multipart")
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(VisitCheckIn.objects.get(pk=visit_id).photos.get().lat)

    def test_no_photos_after_check_out(self):
        visit_id = self.check_in().data["id"]
        self.client.post(f"{VISITS}{visit_id}/check-out/", fix(30), format="json")
        response = self.client.post(f"{VISITS}{visit_id}/photos/", {"image": image()}, format="multipart")
        self.assertEqual(response.status_code, 409)

    def test_not_an_image_is_refused(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        visit_id = self.check_in().data["id"]
        response = self.client.post(
            f"{VISITS}{visit_id}/photos/", {"image": SimpleUploadedFile("a.txt", b"hello", content_type="text/plain")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)

    def test_another_scout_cannot_add_a_photo(self):
        visit_id = self.check_in().data["id"]
        self.as_staff(self.efua)
        response = self.client.post(f"{VISITS}{visit_id}/photos/", {"image": image()}, format="multipart")
        self.assertEqual(response.status_code, 404)


class AbandonedVisitTests(VisitApiBase):
    def test_a_visit_open_for_12_hours_becomes_abandoned(self):
        stale = VisitCheckIn.objects.get(pk=self.check_in().data["id"])
        VisitCheckIn.objects.filter(pk=stale.pk).update(checked_in_at=timezone.now() - timedelta(hours=12, minutes=1))
        self.assertEqual(close_abandoned_visits(), 1)
        stale.refresh_from_db()
        self.assertEqual(stale.status, "abandoned")
        self.assertIsNone(stale.checked_out_at)

    def test_a_younger_visit_stays_open_and_the_job_is_idempotent(self):
        fresh = VisitCheckIn.objects.get(pk=self.check_in().data["id"])
        VisitCheckIn.objects.filter(pk=fresh.pk).update(checked_in_at=timezone.now() - timedelta(hours=11))
        self.assertEqual(close_abandoned_visits(), 0)
        self.assertEqual(VisitCheckIn.objects.get(pk=fresh.pk).status, "open")
        VisitCheckIn.objects.filter(pk=fresh.pk).update(checked_in_at=timezone.now() - timedelta(hours=13))
        close_abandoned_visits()
        self.assertEqual(close_abandoned_visits(), 0)

    def test_an_abandoned_visit_never_counts_and_frees_the_scout(self):
        stale = VisitCheckIn.objects.get(pk=self.check_in().data["id"])
        VisitCheckIn.objects.filter(pk=stale.pk).update(checked_in_at=timezone.now() - timedelta(hours=13))
        close_abandoned_visits()
        self.as_staff(self.kwame)
        body = self.client.get(VISITS).data
        self.assertEqual(body["results"], [])
        self.assertEqual(body["summary"]["done"], 0)
        self.assertEqual(self.check_in().status_code, 201)
        self.assertEqual(health.last_contact(self._annotated(self.adwoa)), None)

    def _annotated(self, owner):
        return health.with_health_inputs(BusinessOwner.objects.filter(pk=owner.pk), timezone.now()).get()

    def test_the_job_is_scheduled_hourly(self):
        from django.conf import settings

        self.assertEqual(
            settings.CELERY_BEAT_SCHEDULE["field-close-abandoned-visits"]["task"], "field.tasks.close_abandoned_visits",
        )


class OutsideRadiusFraudTests(VisitApiBase):
    def outside_visits(self, count, scout=None):
        scout = scout or self.kwame
        for index in range(count):
            owner = pin_business(f"Far Shop {scout.pk}-{index}", scout)
            self.as_staff(scout)
            response = self.client.post(
                VISITS, {"business_owner": owner.pk, "purpose": "prospecting", **fix(160)}, format="json",
            )
            self.assertEqual(response.status_code, 201)
            self.client.post(f"{VISITS}{response.data['id']}/check-out/", fix(160), format="json")

    def flags(self, scout=None):
        return FraudFlag.objects.filter(kind=FraudFlag.OUTSIDE_RADIUS, staff_subject=scout or self.kwame)

    def test_two_flagged_check_ins_open_nothing(self):
        self.outside_visits(2)
        self.assertEqual(self.flags().count(), 0)

    def test_the_third_in_seven_days_opens_one_case(self):
        self.outside_visits(3)
        flag = self.flags().get()
        self.assertEqual(flag.status, FraudFlag.OPEN)
        self.assertEqual(flag.source, FraudFlag.SYSTEM)
        self.assertIsNone(flag.business_owner)
        self.assertTrue(flag.dedupe_key.startswith(f"outside-radius:{self.kwame.pk}:"))

    def test_further_flagged_check_ins_do_not_open_a_second_case(self):
        self.outside_visits(5)
        self.assertEqual(self.flags().count(), 1)

    def test_old_flagged_check_ins_do_not_count(self):
        self.outside_visits(2)
        VisitCheckIn.objects.filter(scout=self.kwame).update(checked_in_at=timezone.now() - timedelta(days=8))
        self.outside_visits(1)
        self.assertEqual(self.flags().count(), 0)

    def test_inside_the_radius_never_counts(self):
        for index in range(4):
            owner = pin_business(f"Near Shop {index}", self.kwame)
            self.as_staff(self.kwame)
            response = self.client.post(
                VISITS, {"business_owner": owner.pk, "purpose": "prospecting", **fix(50)}, format="json",
            )
            self.client.post(f"{VISITS}{response.data['id']}/check-out/", fix(50), format="json")
        self.assertEqual(self.flags().count(), 0)

    def test_the_count_is_per_scout(self):
        self.outside_visits(2)
        self.outside_visits(2, scout=self.efua)
        self.assertEqual(FraudFlag.objects.filter(kind=FraudFlag.OUTSIDE_RADIUS).count(), 0)

    def test_the_scout_cannot_decide_a_case_about_themselves(self):
        self.outside_visits(3)
        self.assertEqual(self.flags().get().staff_subject_id, self.kwame.pk)


class VisitListTests(VisitApiBase):
    def done_visit(self, owner, *, days_ago=0, minutes=20, outside=False, scout=None):
        scout = scout or self.kwame
        start = timezone.now() - timedelta(days=days_ago, minutes=minutes)
        return VisitCheckIn.objects.create(
            scout=scout, business_owner=owner, purpose="prospecting", status="done", checked_in_at=start,
            checked_out_at=start + timedelta(minutes=minutes), lat=PIN[0], lng=PIN[1], accuracy_m=5,
            distance_m=160 if outside else 20, outside_radius=outside,
        )

    def get(self, who, query=""):
        self.as_staff(who)
        return self.client.get(f"{VISITS}{query}")

    def test_the_week_lists_this_weeks_visits_with_a_summary(self):
        self.done_visit(self.adwoa, minutes=20)
        self.done_visit(self.adwoa, minutes=30, outside=True)
        self.done_visit(self.adwoa, days_ago=40, minutes=99)
        body = self.get(self.kwame).data
        self.assertEqual(body["count"], 2)
        self.assertEqual(body["summary"], {"done": 2, "avg_minutes": 25, "flagged": 1})

    def test_a_scout_sees_only_their_own(self):
        self.done_visit(self.adwoa)
        self.assertEqual(self.get(self.efua).data["count"], 0)

    def test_flagged_lists_every_flagged_visit_and_month_reaches_further_back(self):
        self.done_visit(self.adwoa, outside=True)
        self.done_visit(self.adwoa, days_ago=3, outside=False)
        self.assertEqual(self.get(self.kwame, "?range=flagged").data["count"], 1)
        self.assertGreaterEqual(self.get(self.kwame, "?range=month").data["count"], 1)

    def test_an_open_visit_is_listed_but_not_counted_as_done(self):
        self.check_in()
        body = self.get(self.kwame).data
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["status"], "open")
        self.assertEqual(body["summary"]["done"], 0)
        self.assertIsNone(body["summary"]["avg_minutes"])

    def test_pages_are_sized_by_page_size(self):
        for _ in range(3):
            self.done_visit(self.adwoa)
        body = self.get(self.kwame, "?page_size=2").data
        self.assertEqual(len(body["results"]), 2)
        self.assertEqual(body["count"], 3)

    def test_operations_reads_a_scouts_visits_read_only(self):
        self.done_visit(self.adwoa)
        self.assertEqual(self.get(self.lead, f"?scout={self.kwame.pk}").data["count"], 1)
        self.assertEqual(self.get(self.lead).status_code, 400)
        # Operations has no scout permission, so cannot check in for anyone.
        self.as_staff(self.lead)
        body = {"business_owner": self.adwoa.pk, "purpose": "prospecting", **fix(10)}
        self.assertEqual(self.client.post(VISITS, body, format="json").status_code, 403)

    def test_a_scout_cannot_read_another_scout_with_the_parameter(self):
        self.done_visit(self.adwoa)
        self.assertEqual(self.get(self.efua, f"?scout={self.kwame.pk}").status_code, 404)

    def test_other_roles_are_refused(self):
        support = make_staff("support", "esi@example.com")
        self.assertEqual(self.get(support).status_code, 403)

    def test_anonymous_is_refused(self):
        self.client.credentials()
        self.assertIn(self.client.get(VISITS).status_code, (401, 403))

    def check_in(self):
        self.as_staff(self.kwame)
        return self.client.post(
            VISITS, {"business_owner": self.adwoa.pk, "purpose": "prospecting", **fix(10)}, format="json",
        )


class VisitTargetsTests(VisitApiBase):
    def test_lists_managed_businesses_and_open_assignments_only(self):
        pinless = pin_business("Pinless Shop", self.kwame, pinned=False)
        rejected = make_business("Rejected Shop", manager=self.kwame, kyc=BusinessOwner.REJECTED)
        theirs = pin_business("Efua's Shop", self.efua)
        other = pin_business("Yaw's Garage", None)
        ScoutAssignment.objects.create(business_owner=other, scout=self.kwame)
        done = pin_business("Old Check", None)
        ScoutAssignment.objects.create(business_owner=done, scout=self.kwame, status=ScoutAssignment.VISITED)
        self.as_staff(self.kwame)
        items = self.client.get("/api/field/visit-targets/").data
        names = [item["name"] for item in items]
        self.assertEqual(names, ["Adwoa Fabrics", "Pinless Shop", "Yaw's Garage"])
        by_name = {item["name"]: item for item in items}
        self.assertEqual(by_name["Adwoa Fabrics"]["kind"], "business")
        self.assertAlmostEqual(by_name["Adwoa Fabrics"]["lat"], PIN[0], places=5)
        self.assertEqual(by_name["Yaw's Garage"]["kind"], "verification")
        self.assertIsNotNone(by_name["Yaw's Garage"]["scout_assignment"])
        self.assertIsNone(by_name["Pinless Shop"]["lat"])
        self.assertFalse(by_name["Pinless Shop"]["has_pin"])
        self.assertNotIn(rejected.display_name, names)
        self.assertNotIn(theirs.display_name, names)

    def test_other_roles_are_refused(self):
        self.as_staff(make_staff("support", "esi@example.com"))
        self.assertEqual(self.client.get("/api/field/visit-targets/").status_code, 403)


class LastContactTests(VisitApiBase):
    def annotated(self):
        return health.with_health_inputs(BusinessOwner.objects.filter(pk=self.adwoa.pk), timezone.now()).get()

    def make_visit(self, days_ago, status="done"):
        start = timezone.now() - timedelta(days=days_ago, hours=1)
        return VisitCheckIn.objects.create(
            scout=self.kwame, business_owner=self.adwoa, purpose="prospecting", status=status, checked_in_at=start,
            checked_out_at=start + timedelta(minutes=30) if status == "done" else None, lat=PIN[0], lng=PIN[1],
            accuracy_m=5,
        )

    def test_a_visit_alone_is_the_last_contact(self):
        self.make_visit(2)
        contact = health.last_contact(self.annotated())
        self.assertEqual(contact["kind"], "visit")

    def test_the_later_of_call_and_visit_wins(self):
        from portfolio.tests.health_fixtures import log_call

        self.make_visit(5)
        log_call(self.adwoa, self.kwame, days_ago=1)
        self.assertEqual(health.last_contact(self.annotated())["kind"], "call")
        self.make_visit(0)
        self.assertEqual(health.last_contact(self.annotated())["kind"], "visit")

    def test_an_open_visit_is_not_contact_yet(self):
        self.make_visit(1, status="open")
        self.assertIsNone(health.last_contact(self.annotated()))

    def test_a_recent_visit_clears_no_contact_in_30_days(self):
        make_healthy(self.adwoa, self.kwame, call_days_ago=None)
        now = timezone.now()
        rated = lambda: health.rate(health.with_health_inputs(BusinessOwner.objects.filter(pk=self.adwoa.pk), now).get(), now)
        self.assertIn("No contact in 30 days", rated()[1])
        self.make_visit(3)
        self.assertEqual(rated(), (health.HEALTHY, []))

    def test_the_portfolio_item_and_business_page_show_visits(self):
        self.make_visit(2)
        self.as_staff(self.kwame)
        listed = self.client.get("/api/portfolio/businesses/").data["results"][0]
        self.assertEqual(listed["last_contact"]["kind"], "visit")
        detail = self.client.get(f"/api/portfolio/businesses/{self.adwoa.pk}/").data
        self.assertEqual(len(detail["recent_visits"]), 1)
        recent = detail["recent_visits"][0]
        self.assertEqual(recent["purpose_label"], "Prospecting")
        self.assertEqual(recent["minutes"], 30)
        self.assertIn("outside_radius", recent)

    def test_recent_visits_keeps_the_last_five_and_skips_abandoned(self):
        for days in range(7):
            self.make_visit(days)
        self.make_visit(0, status="abandoned")
        self.as_staff(self.kwame)
        detail = self.client.get(f"/api/portfolio/businesses/{self.adwoa.pk}/").data
        self.assertEqual(len(detail["recent_visits"]), 5)
        self.assertNotIn("abandoned", [row["status"] for row in detail["recent_visits"]])
