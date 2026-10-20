import json
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from accounts import hours
from accounts.models import BusinessHours, BusinessOwner
from accounts.tests.test_hours import week


class SetBusinessHoursTests(TestCase):
    def setUp(self):
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233201110001", email="k1@example.com")

    def run_cmd(self, payload, *extra):
        out = StringIO()
        call_command("set_business_hours", str(self.owner.pk), json.dumps(payload), *extra, stdout=out)
        return out.getvalue()

    def test_sets_hours_for_a_business_without_any(self):
        self.run_cmd(week())
        self.assertEqual(BusinessHours.objects.filter(business_owner=self.owner).count(), 7)

    def test_refuses_a_business_that_has_hours_unless_replace(self):
        hours.set_week(self.owner, week("09:00", "17:00"))
        with self.assertRaises(CommandError):
            self.run_cmd(week("10:00", "16:00"))
        self.assertEqual(str(BusinessHours.objects.get(business_owner=self.owner, weekday=0).opens), "09:00:00")
        self.run_cmd(week("10:00", "16:00"), "--replace")
        self.assertEqual(str(BusinessHours.objects.get(business_owner=self.owner, weekday=0).opens), "10:00:00")

    def test_invalid_week_writes_nothing(self):
        with self.assertRaises(CommandError):
            self.run_cmd(week()[:6])
        self.assertFalse(hours.has_hours(self.owner))

    def test_unknown_business(self):
        with self.assertRaises(CommandError):
            call_command("set_business_hours", "999999", json.dumps(week()))
