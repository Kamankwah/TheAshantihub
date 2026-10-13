from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from notifications.models import Notification
from notifications.services import notify_staff


class CenterFilterTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.other = make_staff("operations", "ama@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss)}")
        notify_staff(self.boss, "approval_waiting", "Waiting 1")
        notify_staff(self.boss, "approval_waiting", "Waiting 2")
        notify_staff(self.boss, "fraud_flag_raised", "Case")
        notify_staff(self.other, "approval_waiting", "Not mine")
        Notification.objects.filter(title="Waiting 1").update(is_read=True)

    def titles(self, query=""):
        return [n["title"] for n in self.client.get(f"/api/notifications/{query}").json()["results"]]

    def test_the_plain_list_is_unchanged(self):
        body = self.client.get("/api/notifications/").json()
        self.assertEqual(set(body), {"unread_count", "results"})
        self.assertEqual(sorted(self.titles()), ["Case", "Waiting 1", "Waiting 2"])

    def test_filters_by_kind_and_unread_and_limit_never_cross_accounts(self):
        self.assertEqual(sorted(self.titles("?kind=approval_waiting")), ["Waiting 1", "Waiting 2"])
        self.assertEqual(sorted(self.titles("?kind=approval_waiting,fraud_flag_raised&unread=1")), ["Case", "Waiting 2"])
        self.assertEqual(len(self.titles("?limit=1")), 1)
        self.assertEqual(len(self.titles("?limit=abc")), 3)

    def test_kinds_are_counted_only_when_asked_for(self):
        body = self.client.get("/api/notifications/?kinds=1&kind=fraud_flag_raised").json()
        self.assertEqual(body["kinds"], [{"kind": "approval_waiting", "total": 2}, {"kind": "fraud_flag_raised", "total": 1}])
        self.assertEqual(body["unread_count"], 2)
