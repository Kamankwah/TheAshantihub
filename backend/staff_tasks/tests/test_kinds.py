import datetime as dt
import importlib

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from calls.models import CallLog
from field.models import Prospect
from staff_tasks.models import Task
from staff_tasks.services import create_task


class TaskKindTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = BusinessOwner.objects.create(full_name="Abena", login_phone="+233244100200", password_hash="x")
        BusinessOwnerProfile.objects.create(business_owner=self.owner, business_name="Abena Kente House")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.scout, 'staff')}")

    def get(self, view="open"):
        response = self.client.get(f"/api/tasks/?view={view}")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_a_task_with_no_kind_or_source_is_manual(self):
        self.assertEqual(create_task(self.scout, "Call", timezone.now()).kind, Task.MANUAL)

    def test_the_kind_follows_the_source_when_not_given(self):
        prospect = Prospect.objects.create(scout=self.scout, name="Waakye Joint", phone="0241112223")
        self.assertEqual(create_task(self.scout, "x", timezone.now(), source=prospect).kind, Task.PROSPECT_FOLLOW_UP)

    def test_the_serializer_names_the_business_the_prospect_and_who_it_is_from(self):
        now = timezone.now()
        prospect = Prospect.objects.create(scout=self.scout, name="Waakye Joint", phone="0241112223")
        create_task(self.scout, "Renew", now + dt.timedelta(hours=1), kind=Task.SUBSCRIPTION_OVERDUE, business=self.owner)
        create_task(self.scout, "Visit", now + dt.timedelta(hours=2), created_by=self.lead, kind=Task.OPS_FOLLOW_UP,
                    business=self.owner)
        create_task(self.scout, "Waakye", now + dt.timedelta(hours=3), source=prospect, created_by=self.scout)
        rows = {row["title"]: row for row in self.get()}
        self.assertEqual(rows["Renew"]["business"], {"id": self.owner.pk, "name": "Abena Kente House"})
        self.assertEqual(rows["Renew"]["kind"], "subscription_overdue")
        self.assertIsNone(rows["Renew"]["created_by_name"])
        self.assertEqual(rows["Visit"]["created_by_name"], "Ama")
        self.assertEqual(rows["Waakye"]["prospect"], {"id": prospect.pk, "name": "Waakye Joint"})
        self.assertIsNone(rows["Waakye"]["business"])
        self.assertIsNone(rows["Waakye"]["created_by_name"])  # your own task is not "from" anyone

    def test_a_subscription_task_says_how_overdue_and_whether_the_pause_is_on(self):
        from billing.models import Subscription, SubscriptionPlan

        now = timezone.now()
        sub = Subscription.objects.create(
            business_owner=self.owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=now - dt.timedelta(days=40), current_period_end=now - dt.timedelta(days=4),
            overdue_since=now - dt.timedelta(days=4),
        )
        create_task(self.scout, "Renew", now + dt.timedelta(hours=1), source=sub, business=self.owner)
        with self.settings(SUBSCRIPTION_PAUSE_ENABLED=False):
            row = self.get()[0]
        self.assertEqual(row["kind"], "subscription_overdue")
        self.assertEqual(row["overdue"], {"day": 5, "pause_enabled": False, "hide_on": None, "grace_days": 14})
        with self.settings(SUBSCRIPTION_PAUSE_ENABLED=True):
            row = self.get()[0]
        self.assertTrue(row["overdue"]["pause_enabled"])
        self.assertEqual(row["overdue"]["day"], 5)
        self.assertIsNotNone(row["overdue"]["hide_on"])

    def test_a_subscription_task_that_is_no_longer_overdue_says_nothing(self):
        from billing.models import Subscription, SubscriptionPlan

        now = timezone.now()
        sub = Subscription.objects.create(
            business_owner=self.owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=now, current_period_end=now + dt.timedelta(days=30),
        )
        create_task(self.scout, "Renew", now, source=sub, business=self.owner)
        self.assertIsNone(self.get()[0]["overdue"])

    def test_a_delivery_task_carries_the_order_id_and_nothing_about_the_customer(self):
        class Order:  # a stand-in with the label create_task reads
            pk = 31

            class _meta:
                label_lower = "orders.order"

        create_task(self.scout, "Delivery problem", timezone.now(), source=Order, kind=Task.DELIVERY_PROBLEM)
        row = self.get()[0]
        self.assertEqual(row["order_id"], 31)
        self.assertEqual(set(row), {
            "id", "title", "notes", "due_at", "status", "done_at", "kind", "business", "prospect", "order_id",
            "overdue", "created_by_name", "source_type", "source_id", "created_at",
        })

    def test_a_task_added_by_hand_is_manual_and_cannot_set_its_kind(self):
        due = (timezone.now() + dt.timedelta(days=1)).isoformat()
        response = self.client.post("/api/tasks/", {"title": "Mine", "due_at": due, "kind": "delivery_problem"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["kind"], "manual")

    def test_due_today_is_from_now_to_midnight_so_overdue_and_today_never_overlap(self):
        now = timezone.now()
        end = timezone.make_aware(dt.datetime.combine(timezone.localdate() + dt.timedelta(days=1), dt.time.min))
        create_task(self.scout, "overdue", now - dt.timedelta(minutes=1))
        later_today = create_task(self.scout, "later today", now + dt.timedelta(seconds=30))
        create_task(self.scout, "midnight", end)
        create_task(self.scout, "tomorrow", end + dt.timedelta(hours=3))
        if later_today.due_at >= end:  # the test ran in the last 30 seconds of the day
            self.skipTest("too close to midnight")
        self.assertEqual([r["title"] for r in self.get("due_today")], ["later today"])
        self.assertEqual([r["title"] for r in self.get("overdue")], ["overdue"])
        self.assertEqual([r["title"] for r in self.get("upcoming")], ["midnight", "tomorrow"])


class BackfillTests(TestCase):
    def test_existing_tasks_get_a_kind_and_business_from_their_source(self):
        from django.apps import apps

        lead = make_staff("operations", "ama@example.com")
        scout = make_staff("scout", "kwame@example.com", manager=lead)
        owner = BusinessOwner.objects.create(full_name="Abena", login_phone="+233244100200", password_hash="x")
        now = timezone.now()
        call = CallLog.objects.create(
            staff=scout, direction="out", purpose="onboarding", outcome="connected", counterpart_type="business_owner",
            related_type="business_owner", related_id=str(owner.pk), started_at=now,
        )
        prospect = Prospect.objects.create(scout=scout, name="P", phone="0241112223")

        def old(title, source_type, source_id, created_by=None):
            task = Task.objects.create(
                owner=scout, title=title, due_at=now, source_type=source_type, source_id=str(source_id), created_by=created_by,
            )
            Task.objects.filter(pk=task.pk).update(kind="manual", business_owner=None)
            return task

        from billing.models import Subscription, SubscriptionPlan

        sub = Subscription.objects.create(
            business_owner=owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=now, current_period_end=now,
        )
        tasks = {
            "sub": old("sub", "billing.subscription", sub.pk),
            "call": old("call", "calls.calllog", call.pk),
            "prospect": old("prospect", "field.prospect", prospect.pk),
            "lead": old("lead", "accounts.businessowner", owner.pk, created_by=lead),
            "mine": old("mine", "accounts.businessowner", owner.pk, created_by=scout),
            "plain": old("plain", "", ""),
        }
        migration = importlib.import_module("staff_tasks.migrations.0003_backfill_task_kind")
        migration.backfill(apps, None)
        got = {name: Task.objects.get(pk=task.pk) for name, task in tasks.items()}
        self.assertEqual((got["sub"].kind, got["sub"].business_owner), (Task.SUBSCRIPTION_OVERDUE, owner))
        self.assertEqual((got["call"].kind, got["call"].business_owner), (Task.CALL_FOLLOW_UP, owner))
        self.assertEqual((got["prospect"].kind, got["prospect"].business_owner), (Task.PROSPECT_FOLLOW_UP, None))
        self.assertEqual((got["lead"].kind, got["lead"].business_owner), (Task.OPS_FOLLOW_UP, owner))
        self.assertEqual((got["mine"].kind, got["mine"].business_owner), (Task.MANUAL, owner))
        self.assertEqual((got["plain"].kind, got["plain"].business_owner), (Task.MANUAL, None))
