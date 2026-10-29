from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest import mock

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Customer
from events.models import Event
from events.windows import event_window
from listings.models import Category, Zone


def at(y, m, d, h=0, mi=0):
    """An aware instant; Africa/Accra is UTC+0 all year, so UTC reads as local time."""
    return datetime(y, m, d, h, mi, tzinfo=dt_timezone.utc)


class EventWindowTests(SimpleTestCase):
    def window(self, when, now):
        start, end = event_window(when, now=now)
        return start, end

    def test_today_runs_midnight_to_midnight(self):
        self.assertEqual(self.window("today", at(2026, 10, 29, 23, 59)), (at(2026, 10, 29), at(2026, 10, 30)))
        self.assertEqual(self.window("today", at(2026, 10, 29, 0, 0)), (at(2026, 10, 29), at(2026, 10, 30)))

    def test_week_ends_at_next_monday(self):
        # Thursday 29 Oct 2026 -> Monday 2 Nov.
        self.assertEqual(self.window("week", at(2026, 10, 29, 15)), (at(2026, 10, 29), at(2026, 11, 2)))

    def test_week_on_monday_runs_to_next_monday(self):
        self.assertEqual(self.window("week", at(2026, 11, 2, 9)), (at(2026, 11, 2), at(2026, 11, 9)))

    def test_week_on_sunday_equals_today(self):
        self.assertEqual(self.window("week", at(2026, 11, 1, 22)), (at(2026, 11, 1), at(2026, 11, 2)))

    def test_month_ends_on_the_first_of_next_month(self):
        self.assertEqual(self.window("month", at(2026, 10, 29, 15)), (at(2026, 10, 29), at(2026, 11, 1)))

    def test_month_on_last_day_is_just_today(self):
        self.assertEqual(self.window("month", at(2026, 10, 31, 23, 59)), (at(2026, 10, 31), at(2026, 11, 1)))

    def test_december_rolls_into_january(self):
        self.assertEqual(self.window("month", at(2026, 12, 15)), (at(2026, 12, 15), at(2027, 1, 1)))

    def test_unknown_value_has_no_window(self):
        self.assertIsNone(event_window("year", now=at(2026, 10, 29)))
        self.assertIsNone(event_window("", now=at(2026, 10, 29)))
        self.assertIsNone(event_window(None, now=at(2026, 10, 29)))


class EventWhenFilterTests(TestCase):
    NOW = at(2026, 10, 29, 12)  # a Thursday

    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200771166", password_hash="x")
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")

    def make(self, name, when):
        return Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer, name=name,
            description="D.", address="Kumasi", lat="6.7", lng="-1.62", event_date=when, visibility_days=14,
            status=Event.APPROVED, paid_at=timezone.now(), expires_at=timezone.now() + timedelta(days=60),
        )

    def names(self, query):
        with mock.patch("django.utils.timezone.now", return_value=self.NOW):
            response = self.client.get(f"/api/events/?{query}")
        self.assertEqual(response.status_code, 200)
        return {e["name"] for e in response.json()["results"]}

    def seed(self):
        self.make("Tonight", at(2026, 10, 29, 20))
        self.make("Sunday", at(2026, 11, 1, 10))
        self.make("Next Monday", at(2026, 11, 2, 0, 0))
        self.make("Month End", at(2026, 10, 31, 23, 59))
        self.make("Next Month", at(2026, 11, 1, 0, 0))
        self.make("Earlier Today", at(2026, 10, 29, 0, 0))
        self.make("Yesterday", at(2026, 10, 28, 23, 59))

    def test_windows(self):
        self.seed()
        self.assertEqual(self.names("when=today"), {"Tonight", "Earlier Today"})
        self.assertEqual(self.names("when=week"), {"Tonight", "Earlier Today", "Month End", "Next Month", "Sunday"})
        self.assertEqual(self.names("when=month"), {"Tonight", "Earlier Today", "Month End"})

    def test_bad_value_is_ignored(self):
        self.seed()
        everything = self.names("")
        self.assertEqual(self.names("when=year"), everything)
        self.assertEqual(self.names("when="), everything)
