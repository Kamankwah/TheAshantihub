from datetime import date, datetime, time, timedelta
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from targets.models import Leave, PublicHoliday, TargetLimit, TargetPlan, WorkPattern

MON = date(2026, 10, 5)  # a Monday
WED = date(2026, 10, 7)
SAT = date(2026, 10, 10)
SUN = date(2026, 10, 11)


def at(day, hour=10):
    return timezone.make_aware(datetime.combine(day, time(hour)))


class TargetsBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = make_staff("super_admin", "root@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.other_lead = make_staff("operations", "yaw@example.com")
        self.outsider = make_staff("scout", "outsider@example.com", manager=self.other_lead)
        self.today = mock.patch("django.utils.timezone.localdate", return_value=WED)
        self.today.start()
        self.addCleanup(self.today.stop)

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def plan(self, staff, metric, value, effective_from=date(2026, 10, 1), set_by=None):
        return TargetPlan.objects.create(staff=staff, metric=metric, daily_value=value, effective_from=effective_from, set_by=set_by or self.lead)

    def plan_all(self, staff, **values):
        for metric, value in values.items():
            self.plan(staff, metric, value)
