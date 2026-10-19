import datetime

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts import claims, hours
from accounts.models import BusinessHours, BusinessOwner
from accounts.testing import make_staff, session_of, staff_token
from accounts.tests.test_hours_api import client_for, make_owner
from accounts.tests.test_owner_claim import PASSWORD, scout_owner
from activity.models import ActivityEvent


def week(**override):
    days = [{"weekday": d, "closed": d == 6, "opens": "08:00", "closes": "18:00"} for d in range(7)]
    for weekday, patch in override.items():
        days[int(weekday.lstrip("d"))].update(patch)
    return days


class StaffHoursTests(TestCase):
    def setUp(self):
        cache.clear()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = scout_owner(self.scout)
        BusinessHours.objects.filter(business_owner=self.owner).delete()
        self.url = f"/api/portfolio/businesses/{self.owner.pk}/hours/"
        self.client = APIClient()

    def as_(self, staff):
        token = staff_token(staff)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return token

    def test_staff_can_set_hours_for_an_hourless_business_and_it_is_logged(self):
        self.assertFalse(hours.has_hours(self.owner))
        self.as_(self.scout)
        response = self.client.put(self.url, {"days": week()}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["has_hours"])
        self.assertEqual(body["days"][0], {"weekday": 0, "closed": False, "opens": "08:00", "closes": "18:00"})
        self.assertEqual(body["days"][6]["closed"], True)
        self.assertTrue(hours.has_hours(self.owner))
        events = ActivityEvent.objects.filter(verb="business.hours_set")
        self.assertEqual(events.count(), 1)
        event = events.get()
        self.assertEqual((event.actor_id, event.target_id), (self.scout.pk, str(self.owner.pk)))
        self.assertEqual(event.before, {"days": []})
        self.assertEqual(len(event.after["days"]), 7)
        # A second edit logs the old week as "before"; the newest event is the last in the chain.
        self.as_(self.lead)
        self.client.put(self.url, {"days": week(d0={"opens": "09:00"})}, format="json")
        last = ActivityEvent.objects.filter(verb="business.hours_set").order_by("-id").first()
        self.assertEqual((last.actor_id, last.before["days"][0]["opens"], last.after["days"][0]["opens"]),
                         (self.lead.pk, "08:00", "09:00"))
        self.assertEqual(ActivityEvent.objects.filter(verb="business.hours_set").count(), 2)

    def test_the_new_hours_apply_to_new_orders_only(self):
        self.as_(self.scout)
        self.client.put(self.url, {"days": week(d0={"opens": "10:00", "closes": "12:00"})}, format="json")
        monday_9 = datetime.datetime(2026, 10, 19, 9, 0, tzinfo=hours.ACCRA)
        self.assertEqual(hours.next_open(self.owner, monday_9).time(), datetime.time(10, 0))

    def test_invalid_week_400_with_the_failing_day(self):
        self.as_(self.scout)
        bad = week(d2={"opens": "18:00", "closes": "08:00"})
        response = self.client.put(self.url, {"days": bad}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["weekday"], 2)
        self.assertTrue(response.json()["detail"].startswith("Wednesday:"), response.json())
        junk = self.client.put(self.url, {"days": week(d4={"opens": "soon"})}, format="json")
        self.assertEqual(junk.status_code, 400)
        self.assertTrue(junk.json()["detail"].startswith("Friday:"), junk.json())
        self.assertEqual(self.client.put(self.url, {"days": week()[:3]}, format="json").status_code, 400)
        self.assertFalse(hours.has_hours(self.owner))
        self.assertFalse(ActivityEvent.objects.filter(verb="business.hours_set").exists())

    def test_permission_required(self):
        self.client.credentials()
        self.assertEqual(self.client.put(self.url, {"days": week()}, format="json").status_code, 401)
        self.as_(make_staff("support", "esi@example.com"))
        self.assertEqual(self.client.put(self.url, {"days": week()}, format="json").status_code, 403)
        self.as_(make_staff("scout", "yaw@example.com", manager=self.lead))  # another scout's business
        self.assertEqual(self.client.put(self.url, {"days": week()}, format="json").status_code, 404)
        self.client.credentials(**client_for(make_owner(phone="+233201110099"))._credentials)
        self.assertIn(self.client.put(self.url, {"days": week()}, format="json").status_code, (401, 403))
        self.assertFalse(hours.has_hours(self.owner))
        self.as_(self.lead)  # portfolio.manage
        self.assertEqual(self.client.put(self.url, {"days": week()}, format="json").status_code, 200)

    def test_owner_endpoint_edits_only_the_signed_in_owner_and_owner_token_is_refused_on_the_staff_url(self):
        other = make_owner(phone="+233201110098", business_name="Other shop")
        response = client_for(other).put("/api/accounts/business/hours/", {"days": week()}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(hours.has_hours(other))
        self.assertFalse(hours.has_hours(self.owner))
        self.assertEqual(BusinessHours.objects.filter(business_owner=self.owner).count(), 0)
        # The owner token is refused on the staff endpoint, for another business and for their own.
        owner_client = client_for(other)
        for target in (self.owner.pk, other.pk):
            with self.subTest(target=target):
                before = BusinessHours.objects.filter(business_owner=target).count()
                refused = owner_client.put(f"/api/portfolio/businesses/{target}/hours/", {"days": week(d0={"opens": "11:00"})}, format="json")
                self.assertIn(refused.status_code, (401, 403))
                self.assertEqual(BusinessHours.objects.filter(business_owner=target).count(), before)
        self.assertEqual(BusinessHours.objects.get(business_owner=other, weekday=0).opens.strftime("%H:%M"), "08:00")

    def test_list_exposes_has_hours_and_filters_businesses_without_hours(self):
        with_hours = scout_owner(self.scout, phone="+233241230000")
        self.as_(self.scout)
        listing = self.client.get("/api/portfolio/businesses/?scope=mine").json()["results"]
        by_id = {row["id"]: row["has_hours"] for row in listing}
        self.assertEqual(by_id, {self.owner.pk: False, with_hours.pk: True})
        missing = self.client.get("/api/portfolio/businesses/?scope=mine&flag=no_hours").json()["results"]
        self.assertEqual([row["id"] for row in missing], [self.owner.pk])

    def test_blocked_scout_claim_becomes_claimable_after_staff_set_hours(self):
        token = self.as_(self.scout)
        raw, _ = claims.start_handover(self.owner, self.scout, session_of(token))
        body = {"token": raw, "password": PASSWORD, "password_confirm": PASSWORD, "accept_terms": True}
        claim_url = "/api/accounts/business-owners/claim/"
        blocked = self.client.post(claim_url, body, format="json")
        self.assertEqual((blocked.status_code, blocked.json()["code"]), (400, "hours_required"))
        self.assertEqual(self.client.put(self.url, {"days": week()}, format="json").status_code, 200)
        claimed = self.client.post(claim_url, body, format="json")
        self.assertEqual(claimed.status_code, 200, claimed.content)
        self.owner.refresh_from_db()
        self.assertIsNotNone(self.owner.claimed_at)
