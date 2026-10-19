"""A scout's check-in to verify a business's detail change request on site (plan 7F-C Task 7)."""
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from field import services
from field.models import VisitCheckIn
from portfolio.models import BusinessDetailChangeRequest as Request
from portfolio.tests.change_fixtures import make_business

VISITS = "/api/field/visits/"
TARGETS = "/api/field/visit-targets/"
PIN = (6.700000, -1.610000)


def fix(metres_north=0.0, accuracy=12):
    return {"lat": PIN[0] + metres_north / 111195.0, "lng": PIN[1], "accuracy_m": accuracy}


class ChangeVerificationVisitTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.registrar = make_staff("scout", "kofi.scout@example.com", phone="0501112223")
        self.scout = make_staff("scout", "ama.scout@example.com", phone="0501112225")
        self.other_scout = make_staff("scout", "yaw.scout@example.com", phone="0501112226")
        self.ops = make_staff("operations", "ops.lead@example.com", phone="0501112224")
        self.owner = make_business(self.registrar)
        self.change = Request.objects.create(
            business_owner=self.owner, field="login_phone", new_value="+233207654321", reason="Lost my SIM.",
            status=Request.ASSIGNED, assigned_scout=self.scout, assigned_by=self.ops, assigned_at=timezone.now(),
        )

    def check_in(self, scout=None, metres=30, **body):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(scout or self.scout)}")
        return self.client.post(VISITS, {"change_request": self.change.pk, **fix(metres), **body}, format="json")

    def test_check_in_sets_purpose_and_request(self):
        response = self.check_in(purpose="subscription_follow_up")  # the request decides the purpose
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["purpose"], VisitCheckIn.CHANGE_VERIFICATION)
        self.assertEqual(response.data["change_request_id"], self.change.pk)
        self.assertEqual(response.data["business"]["id"], self.owner.pk)
        self.assertAlmostEqual(response.data["distance_m"], 30, delta=1)
        self.assertFalse(response.data["outside_radius"])
        visit = VisitCheckIn.objects.get()
        self.assertEqual(visit.change_request, self.change)
        self.assertEqual(visit.business_owner, self.owner)
        event = ActivityEvent.objects.get(verb="visit.check_in")
        self.assertEqual(event.after["change_request_id"], self.change.pk)

    def test_outside_radius_is_measured_as_for_any_visit(self):
        response = self.check_in(metres=300)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["outside_radius"])

    def test_scout_cannot_check_in_for_someone_elses_request(self):
        response = self.check_in(self.other_scout)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["code"], "not_found")
        self.assertFalse(VisitCheckIn.objects.exists())

    def test_only_a_request_waiting_for_its_visit(self):
        for status in (Request.REQUESTED, Request.VERIFIED, Request.WITHDRAWN, Request.NOT_VERIFIED):
            Request.objects.filter(pk=self.change.pk).update(status=status)
            self.assertEqual(self.check_in().status_code, 404, status)

    def test_change_verification_purpose_needs_a_request(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.registrar)}")
        response = self.client.post(
            VISITS, {"business_owner": self.owner.pk, "purpose": "change_verification", **fix(20)}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        visit = services.check_in(
            self.registrar, business_owner_id=self.owner.pk, purpose="info_update", lat=PIN[0], lng=PIN[1],
            accuracy_m=10,
        )
        with self.assertRaises(services.VisitError):
            services.update_open_visit(visit, purpose=VisitCheckIn.CHANGE_VERIFICATION)

    def test_change_verification_visit_keeps_its_purpose(self):
        visit = VisitCheckIn.objects.get(pk=self.check_in().data["id"])
        with self.assertRaises(services.VisitError):
            services.update_open_visit(visit, purpose=VisitCheckIn.INFO_UPDATE)

    def test_visit_target_returns_the_request(self):
        target = services.visit_target(self.scout, change_request_id=self.change.pk)
        self.assertEqual(target, (self.owner, None, None, self.change))
        with self.assertRaises(services.VisitError):
            services.visit_target(self.other_scout, change_request_id=self.change.pk)

    def test_visit_targets_list_the_scouts_requests(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.scout)}")
        items = self.client.get(TARGETS).data
        changes = [item for item in items if item["kind"] == "change_verification"]
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["change_request"], self.change.pk)
        self.assertEqual(changes[0]["business_id"], self.owner.pk)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.other_scout)}")
        self.assertFalse([item for item in self.client.get(TARGETS).data if item["kind"] == "change_verification"])
