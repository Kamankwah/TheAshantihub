from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.test import TestCase

from accounts import hours
from accounts.models import BusinessHours, BusinessOwner

ACCRA = ZoneInfo("Africa/Accra")


def week(opens="09:00", closes="17:00", closed=()):
    return [
        {"weekday": d, "closed": d in closed, "opens": None if d in closed else opens, "closes": None if d in closed else closes}
        for d in range(7)
    ]


def at(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=ACCRA)


class HoursTests(TestCase):
    def setUp(self):
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233201110000", email="k@example.com")

    # 2026-10-19 is a Monday, 2026-10-25 a Sunday.
    def test_closed_at_exact_closing_time(self):
        hours.set_week(self.owner, week())
        self.assertTrue(hours.is_open(self.owner, at(2026, 10, 19, 16, 59)))
        self.assertFalse(hours.is_open(self.owner, at(2026, 10, 19, 17, 0)))
        self.assertTrue(hours.is_open(self.owner, at(2026, 10, 19, 9, 0)))
        self.assertEqual(hours.next_open(self.owner, at(2026, 10, 19, 17, 0)), at(2026, 10, 20, 9, 0))

    def test_closed_sunday_rolls_to_monday(self):
        hours.set_week(self.owner, week(closed=(6,)))
        self.assertEqual(hours.next_open(self.owner, at(2026, 10, 25, 10, 0)), at(2026, 10, 26, 9, 0))
        self.assertEqual(hours.next_open(self.owner, at(2026, 10, 24, 18, 0)), at(2026, 10, 26, 9, 0))

    def test_before_opening_returns_same_day_opening(self):
        hours.set_week(self.owner, week())
        self.assertEqual(hours.next_open(self.owner, at(2026, 10, 19, 6, 0)), at(2026, 10, 19, 9, 0))

    def test_all_days_closed_refused(self):
        with self.assertRaises(hours.HoursError):
            hours.set_week(self.owner, week(closed=range(7)))

    def test_overnight_refused(self):
        with self.assertRaises(hours.HoursError):
            hours.set_week(self.owner, week(opens="20:00", closes="02:00"))
        with self.assertRaises(hours.HoursError):
            hours.set_week(self.owner, week(opens="09:00", closes="09:00"))

    def test_missing_weekday_refused(self):
        with self.assertRaises(hours.HoursError):
            hours.set_week(self.owner, week()[:6])

    def test_refused_write_leaves_existing_hours(self):
        hours.set_week(self.owner, week())
        with self.assertRaises(hours.HoursError):
            hours.set_week(self.owner, week(closed=range(7)))
        self.assertEqual(BusinessHours.objects.filter(business_owner=self.owner).count(), 7)

    def test_set_week_replaces(self):
        hours.set_week(self.owner, week())
        hours.set_week(self.owner, week(opens="08:00", closes="12:00"))
        self.assertEqual(BusinessHours.objects.filter(business_owner=self.owner).count(), 7)
        self.assertEqual(BusinessHours.objects.get(business_owner=self.owner, weekday=0).opens, time(8, 0))

    def test_open_returns_same_instant(self):
        hours.set_week(self.owner, week())
        now = at(2026, 10, 19, 12, 0)
        self.assertIs(hours.next_open(self.owner, now), now)

    def test_utc_input_converted_to_accra(self):
        hours.set_week(self.owner, week())
        result = hours.next_open(self.owner, datetime(2026, 10, 19, 18, 0, tzinfo=ZoneInfo("UTC")))
        self.assertEqual(result, at(2026, 10, 20, 9, 0))
        self.assertEqual(result.utcoffset(), timedelta(0))

    def test_has_hours(self):
        self.assertFalse(hours.has_hours(self.owner))
        hours.set_week(self.owner, week())
        self.assertTrue(hours.has_hours(self.owner))

    def test_no_hours_uses_platform_fallback(self):
        # defaults 07:00-20:00 when no limits row is live
        self.assertEqual(hours.next_open(self.owner, at(2026, 10, 19, 21, 0)), at(2026, 10, 20, 7, 0))
        self.assertTrue(hours.is_open(self.owner, at(2026, 10, 19, 8, 0)))
        self.assertFalse(hours.is_open(self.owner, at(2026, 10, 19, 20, 0)))

    def test_no_hours_uses_live_platform_limits(self):
        from delivery.models import ConfigVersion, TimeLimits
        TimeLimits.objects.create(status=ConfigVersion.LIVE, version=1, opens_at=time(8, 30), closes_at=time(18, 0))
        self.assertEqual(hours.next_open(self.owner, at(2026, 10, 19, 7, 0)), at(2026, 10, 19, 8, 30))
        self.assertFalse(hours.is_open(self.owner, at(2026, 10, 19, 18, 0)))
