from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import hours
from accounts.authentication import issue_token
from accounts.models import BusinessHours, BusinessOwner, BusinessOwnerProfile
from billing.models import Subscription, SubscriptionPlan

URL = "/api/accounts/business/hours/"


def week(opens="09:00", closes="17:00", closed=()):
    return [
        {"weekday": d, "closed": d in closed, "opens": None if d in closed else opens, "closes": None if d in closed else closes}
        for d in range(7)
    ]


def make_owner(phone="+233201110001", **profile):
    owner = BusinessOwner.objects.create(full_name="Efua", login_phone=phone, password_hash="x")
    BusinessOwnerProfile.objects.create(business_owner=owner, **profile)
    return owner


def client_for(owner):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
    return client


class HoursApiTests(TestCase):
    def test_put_hours_saves_and_returns(self):
        owner = make_owner()
        response = client_for(owner).put(URL, {"days": week(closed=(6,))}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(len(body["days"]), 7)
        self.assertEqual(body["days"][0], {"weekday": 0, "closed": False, "opens": "09:00", "closes": "17:00"})
        self.assertEqual(body["days"][6], {"weekday": 6, "closed": True, "opens": None, "closes": None})
        self.assertTrue(body["has_hours"])
        self.assertEqual(client_for(owner).get(URL).json(), body)

    def test_get_without_hours_is_empty_not_invented(self):
        response = client_for(make_owner()).get(URL)
        self.assertEqual(response.json(), {"days": [], "has_hours": False})

    def test_string_false_is_not_treated_as_closed(self):
        owner = make_owner()
        days = week()
        days[2]["closed"] = "false"
        response = client_for(owner).put(URL, {"days": days}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(BusinessHours.objects.get(business_owner=owner, weekday=2).closed)

    def test_put_invalid_returns_400_with_message(self):
        owner = make_owner()
        days = week()
        days[1]["opens"], days[1]["closes"] = "18:00", "09:00"
        response = client_for(owner).put(URL, {"days": days}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("before closing", response.json()["detail"])
        self.assertFalse(hours.has_hours(owner))

    def test_put_without_days_is_400(self):
        response = client_for(make_owner()).put(URL, {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_other_owner_cannot_edit(self):
        mine, theirs = make_owner(), make_owner("+233201110002")
        hours.set_week(theirs, week())
        client_for(mine).put(URL, {"days": week("08:00", "12:00")}, format="json")
        self.assertEqual(BusinessHours.objects.get(business_owner=theirs, weekday=0).opens.hour, 9)

    def test_anonymous_and_customers_are_refused(self):
        self.assertIn(APIClient().put(URL, {"days": week()}, format="json").status_code, (401, 403))

    def test_profile_exposes_hours(self):
        owner = make_owner()
        client = client_for(owner)
        profile = client.get("/api/accounts/business-owners/me/profile/").json()
        self.assertEqual((profile["hours"], profile["has_hours"]), ([], False))
        hours.set_week(owner, week())
        profile = client.get("/api/accounts/business-owners/me/profile/").json()
        self.assertTrue(profile["has_hours"])
        self.assertEqual(len(profile["hours"]), 7)


class RegistrationHoursTests(TestCase):
    def _ready_owner(self):
        owner = make_owner(
            ghana_card_number="GHA-222333444-5", gps_address="AK-039-6000", business_contact_phone="+233206665599",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg",
            default_payout_method="momo", payout_momo_number="+233206665599", business_kind="product",
        )
        plan = SubscriptionPlan.objects.create(
            tier="hours_plan", name="P", kind="product", monthly_price=10, status=SubscriptionPlan.ACTIVE_STATUS,
        )
        Subscription.objects.create(
            business_owner=owner, plan=plan, cycle_months=1, is_trial=True, status=Subscription.ACTIVE,
            current_period_start=timezone.now(), current_period_end=timezone.now() + timezone.timedelta(days=30),
        )
        return owner

    def test_registration_requires_hours(self):
        owner = self._ready_owner()
        response = client_for(owner).post("/api/accounts/business-owners/me/terms/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "hours_required")
        owner.profile.refresh_from_db()
        self.assertIsNone(owner.profile.terms_accepted_at)

    def test_registration_submits_once_hours_are_set(self):
        owner = self._ready_owner()
        hours.set_week(owner, week())
        response = client_for(owner).post("/api/accounts/business-owners/me/terms/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["registration_step"], "complete")

    def test_report_missing_hours_lists_only_businesses_without_hours(self):
        from io import StringIO
        from django.core.management import call_command
        with_hours, without = make_owner("+233201110003"), make_owner("+233201110004")
        hours.set_week(with_hours, week())
        out = StringIO()
        call_command("report_missing_hours", stdout=out)
        text = out.getvalue()
        self.assertIn("+233201110004", text)
        self.assertNotIn("+233201110003", text)
