from datetime import datetime, timezone as dt_timezone

from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework import serializers


class ServerTimezoneTests(SimpleTestCase):
    """AshantiHub runs in Ghana (GMT, no DST). Without an explicit TIME_ZONE
    Django falls back to America/Chicago, which made every API timestamp
    carry a -05:00 offset and put staff panels five hours behind."""

    def test_api_datetimes_are_rendered_in_ghana_time(self):
        moment = datetime(2026, 10, 5, 9, 24, tzinfo=dt_timezone.utc)
        rendered = serializers.DateTimeField().to_representation(moment)
        self.assertEqual(rendered, "2026-10-05T09:24:00Z")

    def test_local_dates_follow_ghana_not_chicago(self):
        # 02:00 GMT is still the previous day in Chicago.
        moment = datetime(2026, 10, 5, 2, 0, tzinfo=dt_timezone.utc)
        self.assertEqual(timezone.localdate(moment).isoformat(), "2026-10-05")
