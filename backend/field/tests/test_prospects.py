from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from accounts.testing import make_staff, staff_token
from calls.models import CallLog
from field.models import Prospect, VisitCheckIn
from field.tests.test_visits import PIN, fix
from listings.models import Zone
from portfolio.tests.health_fixtures import make_business
from portfolio.tests.test_registration import RegistrationBase, existing_business
from staff_tasks.models import Task

PROSPECTS = "/api/field/prospects/"


def soon(days=2):
    return (timezone.now() + timedelta(days=days)).isoformat()


class ProspectBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.zone = Zone.objects.get_or_create(name="Asafo")[0]

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def add(self, who=None, **overrides):
        self.as_staff(who or self.kwame)
        body = {"name": "Ohemaa Waakye Joint", "phone": "024 123 4567", "zone": self.zone.pk, **overrides}
        return self.client.post(PROSPECTS, body, format="json")


class ProspectApiTests(ProspectBase):
    def test_add_normalises_the_phone_and_never_needs_a_location(self):
        response = self.add()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["phone"], "+233241234567")
        self.assertEqual(response.data["status"], "new")
        self.assertEqual(response.data["area"], "Asafo")
        self.assertFalse(response.data["has_pin"])

    def test_a_phone_that_belongs_to_a_business_is_refused_however_it_is_written(self):
        existing_business("Adwoa Fabrics", phone="+233 24 123 4567", gps="AK-112-0384")
        response = self.add(phone="0241234567")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "This phone number already belongs to another business.")
        self.assertFalse(Prospect.objects.exists())

    def test_a_scout_cannot_add_the_same_phone_twice(self):
        self.add()
        self.assertEqual(self.add(name="Another").status_code, 400)
        # another scout's list is private, so it is not a duplicate for them
        self.assertEqual(self.add(who=self.efua).status_code, 201)

    def test_a_bad_phone_gets_the_hint(self):
        response = self.add(phone="12345")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Ghana phone number", response.data["detail"])

    def test_a_follow_up_date_makes_a_task_and_moving_it_moves_the_task(self):
        created = self.add(next_follow_up_at=soon(2), status="interested")
        task = Task.objects.get(owner=self.kwame)
        self.assertEqual(task.title, "Follow up: Ohemaa Waakye Joint")
        self.assertEqual(task.source_type, "field.prospect")
        later = timezone.now() + timedelta(days=5)
        response = self.client.patch(f"{PROSPECTS}{created.data['id']}/", {"next_follow_up_at": later.isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Task.objects.filter(owner=self.kwame).count(), 1)
        task.refresh_from_db()
        self.assertEqual(task.due_at, later)

    def test_not_interested_cancels_the_open_task_and_clears_the_date(self):
        created = self.add(next_follow_up_at=soon(2))
        response = self.client.patch(f"{PROSPECTS}{created.data['id']}/", {"status": "not_interested"}, format="json")
        self.assertEqual(response.data["status"], "not_interested")
        self.assertIsNone(response.data["next_follow_up_at"])
        self.assertEqual(Task.objects.get(owner=self.kwame).status, Task.CANCELLED)

    def test_a_follow_up_in_the_past_is_refused(self):
        response = self.add(next_follow_up_at=(timezone.now() - timedelta(days=1)).isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Pick a follow-up time in the future.")

    def test_registered_cannot_be_set_by_hand(self):
        created = self.add()
        response = self.client.patch(f"{PROSPECTS}{created.data['id']}/", {"status": "registered"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_another_scouts_prospect_is_a_404(self):
        created = self.add()
        self.as_staff(self.efua)
        self.assertEqual(self.client.patch(f"{PROSPECTS}{created.data['id']}/", {"note": "x"}, format="json").status_code, 404)
        self.assertEqual(self.client.get(PROSPECTS).data["results"], [])

    def test_a_hand_placed_pin_must_be_in_ghana(self):
        created = self.add()
        url = f"{PROSPECTS}{created.data['id']}/"
        self.assertEqual(self.client.patch(url, {"lat": 51.5, "lng": -0.12}, format="json").status_code, 400)
        response = self.client.patch(url, {"lat": PIN[0], "lng": PIN[1]}, format="json")
        self.assertTrue(response.data["has_pin"])

    def test_the_list_counts_orders_and_filters(self):
        self.add(name="Closed", phone="0241111111", status="not_interested")
        self.add(name="Later", phone="0242222222", next_follow_up_at=soon(5))
        self.add(name="Soon", phone="0243333333", next_follow_up_at=soon(1))
        self.add(name="Nothing", phone="0244444444")
        data = self.client.get(PROSPECTS).data
        self.assertEqual([p["name"] for p in data["results"]], ["Soon", "Later", "Nothing", "Closed"])
        self.assertEqual(data["counts"]["all"], 4)
        self.assertEqual(data["counts"]["not_interested"], 1)
        self.assertEqual(data["counts"]["new"], 3)
        only = self.client.get(PROSPECTS + "?status=not_interested").data["results"]
        self.assertEqual([p["name"] for p in only], ["Closed"])

    def test_the_gate_is_businesses_register(self):
        self.as_staff(self.lead)
        self.assertEqual(self.client.get(PROSPECTS).status_code, 200)  # operations may register businesses
        driver = make_staff("dispatch", "yaw@example.com", manager=self.lead)
        self.as_staff(driver)
        self.assertEqual(self.client.get(PROSPECTS).status_code, 403)

    def test_last_visit_is_the_latest_done_visit(self):
        created = self.add()
        self.as_staff(self.kwame)
        visit = self.client.post("/api/field/visits/", {"prospect": created.data["id"], "purpose": "prospecting", **fix(0)}, format="json")
        self.assertEqual(visit.status_code, 201, visit.content)
        self.assertIsNone(self.client.get(PROSPECTS).data["results"][0]["last_visit_at"])  # still open
        self.client.post(f"/api/field/visits/{visit.data['id']}/check-out/", fix(0), format="json")
        self.assertIsNotNone(self.client.get(PROSPECTS).data["results"][0]["last_visit_at"])


class ProspectVisitTests(ProspectBase):
    def check_in(self, prospect_id, who=None, **position):
        self.as_staff(who or self.kwame)
        return self.client.post("/api/field/visits/", {"prospect": prospect_id, "purpose": "prospecting", **(position or fix(0))}, format="json")

    def test_the_first_check_in_gives_the_prospect_its_pin_and_no_distance(self):
        pid = self.add().data["id"]
        response = self.check_in(pid)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(response.data["distance_m"])
        self.assertFalse(response.data["outside_radius"])
        self.assertEqual(response.data["prospect"]["name"], "Ohemaa Waakye Joint")
        prospect = Prospect.objects.get(pk=pid)
        self.assertAlmostEqual(float(prospect.lat), PIN[0], places=4)

    def test_later_check_ins_measure_from_the_prospect_pin(self):
        pid = self.add().data["id"]
        first = self.check_in(pid)
        self.client.post(f"/api/field/visits/{first.data['id']}/check-out/", fix(0), format="json")
        second = self.check_in(pid, **fix(180))
        self.assertTrue(second.data["outside_radius"])
        self.assertAlmostEqual(second.data["distance_m"], 180, delta=1)

    def test_another_scouts_prospect_is_not_found(self):
        pid = self.add().data["id"]
        self.assertEqual(self.check_in(pid, who=self.efua).status_code, 404)

    def test_visit_targets_list_open_prospects(self):
        self.add()
        self.add(name="Gone", phone="0245555555")
        Prospect.objects.filter(name="Gone").update(status=Prospect.REGISTERED)
        self.as_staff(self.kwame)
        rows = [r for r in self.client.get("/api/field/visit-targets/").data if r["kind"] == "prospect"]
        self.assertEqual([r["name"] for r in rows], ["Ohemaa Waakye Joint"])
        self.assertFalse(rows[0]["has_pin"])


class RegisterFromProspectTests(RegistrationBase):
    def setUp(self):
        super().setUp()
        self.prospect = Prospect.objects.create(
            scout=self.scout, name="Asafo Hair & Beauty", phone="+233241234567", zone=self.zone,
            status=Prospect.INTERESTED, next_follow_up_at=timezone.now() + timedelta(days=2),
        )
        from staff_tasks.services import create_task
        self.prospect.follow_up_task = create_task(self.scout, "Follow up", self.prospect.next_follow_up_at, source=self.prospect)
        self.prospect.save()
        self.visit = VisitCheckIn.objects.create(
            scout=self.scout, prospect=self.prospect, purpose="prospecting", status="done", checked_in_at=timezone.now(),
            checked_out_at=timezone.now(), lat=6.6885, lng=-1.6244, accuracy_m=10,
        )
        self.call = CallLog.objects.create(
            staff=self.scout, direction="out", counterpart_type="prospect", counterpart_id=self.prospect.pk,
            counterpart_name="Asafo Hair & Beauty", related_type="prospect", related_id=str(self.prospect.pk),
            related_label="Asafo Hair & Beauty", purpose="prospecting", outcome="connected", started_at=timezone.now(),
        )

    def test_registering_links_the_prospect_its_visits_and_its_calls(self):
        response = self.register(prospect_id=str(self.prospect.pk))
        self.assertEqual(response.status_code, 201, response.content)
        owner = BusinessOwner.objects.get(pk=response.data["id"])
        self.prospect.refresh_from_db()
        self.assertEqual(self.prospect.status, "registered")
        self.assertEqual(self.prospect.registered_business, owner)
        self.assertIsNotNone(self.prospect.registered_at)
        self.visit.refresh_from_db()
        self.assertEqual(self.visit.business_owner, owner)
        self.call.refresh_from_db()
        self.assertEqual((self.call.related_type, self.call.related_id), ("business_owner", str(owner.pk)))
        self.assertEqual(self.call.related_label, "Asafo Hair & Beauty")
        self.assertEqual(Task.objects.get(pk=self.prospect.follow_up_task_id).status, Task.CANCELLED)

    def test_another_scouts_prospect_is_refused_and_nothing_is_created(self):
        other = make_staff("scout", "efua@example.com", manager=self.lead)
        response = self.register(staff=other, prospect_id=str(self.prospect.pk))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["code"], "prospect")
        self.assertFalse(BusinessOwner.objects.filter(login_phone__endswith="241234567").exists())
        self.prospect.refresh_from_db()
        self.assertEqual(self.prospect.status, "interested")

    def test_an_already_registered_prospect_cannot_be_used_again(self):
        self.register(prospect_id=str(self.prospect.pk))
        again = self.register(prospect_id=str(self.prospect.pk), owner_phone="0245550000", gps_address="AK-113-0384",
                              ghana_card_number="GHA-1-1", owner_email="other@example.com")
        self.assertEqual(again.status_code, 404, again.content)

    def test_signed_up_this_month_counts_it(self):
        self.register(prospect_id=str(self.prospect.pk))
        self.as_(self.scout)
        data = self.client.get(PROSPECTS).data
        self.assertEqual(data["signed_up_this_month"], 1)
        self.assertEqual(data["counts"]["all"], 0)
