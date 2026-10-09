"""The subscription overdue clock (staff phase 2A, Task 3): overdue, grace,
reminders on day 7 and 13, the pause at the start of day 15 — and only a real
payment stopping it."""
import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from itertools import count

from asgiref.sync import async_to_sync
from celery.schedules import crontab
from channels.layers import get_channel_layer
from django.conf import settings
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from activity.models import ActivityEvent
from activity.services import record
from billing import clock
from billing.models import Subscription, SubscriptionPlan
from billing.serializers import StartTrialSerializer
from billing.tasks import run_subscription_clock
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from payments.models import CheckoutSession
from payments.services import _finalize_subscription
from staff_tasks.models import Task

# A Thursday. Africa/Accra is UTC+0, so local dates equal UTC dates.
NOW = datetime(2026, 10, 8, 10, 0, tzinfo=dt_timezone.utc)
WEBHOOK_SECRET = "test-webhook-secret"
_phones = count(100)


def make_owner(business_name="Adwoa Fabrics", *, email=None, manager=None):
    n = next(_phones)
    owner = BusinessOwner.objects.create(
        full_name=f"Owner {n}", login_phone=f"+233207550{n:03d}", email=email,
        password_hash="x", account_manager=manager,
    )
    BusinessOwnerProfile.objects.create(business_owner=owner, business_name=business_name)
    return owner


def make_subscription(owner, *, period_end, plan_tier="product_basic", **clock_fields):
    return Subscription.objects.create(
        business_owner=owner, plan=SubscriptionPlan.objects.get(tier=plan_tier), cycle_months=1,
        current_period_start=period_end - timedelta(days=30), current_period_end=period_end,
        **clock_fields,
    )


def make_listing(owner, name="Kente stole"):
    return Listing.objects.create(
        business_owner=owner, category=Category.objects.get(slug="hotels"),
        zone=Zone.objects.get(name="Manhyia"), name=name, description="D.",
        contact_phone="+233207550999", price_amount="150.00", status=Listing.PUBLISHED,
    )


def public_listing_ids():
    return [item["id"] for item in APIClient().get("/api/listings/").json()["results"]]


STATE_KEYS = {
    "state", "is_trial", "plan_name", "monthly_price", "current_period_end", "overdue_since",
    "overdue_day", "pause_at", "hide_on", "renew_by", "paused_at", "pause_enabled",
}


@override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
class SubscriptionStateTests(TestCase):
    def setUp(self):
        self.owner = make_owner()

    def test_no_subscription_is_state_none(self):
        self.assertEqual(clock.subscription_state(None, now=NOW), {
            "state": "none", "is_trial": False, "plan_name": None, "monthly_price": None,
            "current_period_end": None, "overdue_since": None, "overdue_day": None,
            "pause_at": None, "hide_on": None, "renew_by": None, "paused_at": None, "pause_enabled": True,
        })

    def test_a_running_period_is_active_or_trial(self):
        sub = make_subscription(self.owner, period_end=NOW + timedelta(days=10))
        state = clock.subscription_state(sub, now=NOW)
        self.assertEqual(set(state), STATE_KEYS)
        self.assertEqual(state["state"], "active")
        self.assertFalse(state["is_trial"])
        self.assertEqual(state["plan_name"], sub.plan.name)
        self.assertEqual(state["monthly_price"], str(sub.plan.monthly_price))
        self.assertEqual(parse_datetime(state["current_period_end"]), NOW + timedelta(days=10))
        for key in ("overdue_since", "overdue_day", "pause_at", "hide_on", "renew_by", "paused_at"):
            self.assertIsNone(state[key], key)
        sub.is_trial = True
        trial = clock.subscription_state(sub, now=NOW)
        self.assertEqual(trial["state"], "trial")
        self.assertTrue(trial["is_trial"])

    def test_a_marked_overdue_subscription_reports_its_day_and_dates(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=9),
            overdue_since=NOW - timedelta(days=8, hours=3),
        )
        state = clock.subscription_state(sub, now=NOW)
        self.assertEqual(state["state"], "overdue")
        self.assertEqual(state["overdue_day"], 9)
        self.assertEqual(parse_datetime(state["overdue_since"]), NOW - timedelta(days=8, hours=3))
        self.assertEqual(parse_datetime(state["pause_at"]), NOW + timedelta(days=5, hours=21))
        self.assertEqual(state["hide_on"], "2026-10-14")
        self.assertEqual(state["renew_by"], "2026-10-13")
        self.assertIsNone(state["paused_at"])

    def test_the_day_never_reads_past_14_before_the_job_pauses(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=20),
            overdue_since=NOW - timedelta(days=14, minutes=30),
        )
        self.assertEqual(clock.subscription_state(sub, now=NOW)["overdue_day"], 14)

    def test_a_lapse_the_job_has_not_seen_yet_reads_as_overdue_from_the_period_end(self):
        sub = make_subscription(self.owner, period_end=NOW - timedelta(hours=3))
        state = clock.subscription_state(sub, now=NOW)
        self.assertEqual(state["state"], "overdue")
        self.assertEqual(parse_datetime(state["overdue_since"]), NOW - timedelta(hours=3))
        self.assertEqual(state["overdue_day"], 1)
        self.assertEqual(state["hide_on"], "2026-10-22")
        self.assertEqual(state["renew_by"], "2026-10-21")

    def test_a_long_unseen_lapse_reads_as_day_one_as_the_job_will_mark_it(self):
        sub = make_subscription(self.owner, period_end=NOW - timedelta(days=60))
        state = clock.subscription_state(sub, now=NOW)
        self.assertEqual(state["state"], "overdue")
        self.assertEqual(parse_datetime(state["overdue_since"]), NOW)
        self.assertEqual(state["overdue_day"], 1)
        self.assertEqual(state["hide_on"], "2026-10-22")

    def test_paused_reports_when_the_pause_took_effect(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=20),
            overdue_since=NOW - timedelta(days=16), paused_at=NOW - timedelta(days=2),
        )
        state = clock.subscription_state(sub, now=NOW)
        self.assertEqual(state["state"], "paused")
        self.assertEqual(parse_datetime(state["paused_at"]), NOW - timedelta(days=2))
        self.assertEqual(parse_datetime(state["pause_at"]), NOW - timedelta(days=2))
        self.assertEqual(parse_datetime(state["overdue_since"]), NOW - timedelta(days=16))
        self.assertEqual(state["hide_on"], "2026-10-06")
        self.assertIsNone(state["overdue_day"])
        self.assertIsNone(state["renew_by"])

    def test_the_owner_sees_the_clock_on_their_subscription(self):
        started = timezone.now() - timedelta(days=3)
        make_subscription(self.owner, period_end=started, overdue_since=started)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = client.get("/api/billing/subscriptions/me/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(response.json()["clock"]), STATE_KEYS)
        self.assertEqual(response.json()["clock"]["state"], "overdue")
        self.assertEqual(response.json()["clock"]["overdue_day"], 4)


@override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
class SubscriptionClockTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = make_owner("Adwoa Fabrics", manager=self.scout)

    def owner_notes(self, kind):
        return Notification.objects.filter(business_owner=self.owner, kind=kind)

    def test_nothing_happens_while_the_period_runs(self):
        make_subscription(self.owner, period_end=NOW + timedelta(minutes=1))
        self.assertEqual(clock.tick(now=NOW), {"overdue": 0, "reminders": 0, "paused": 0})
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(Task.objects.exists())
        self.assertFalse(ActivityEvent.objects.filter(verb__startswith="subscription.").exists())

    def test_a_fresh_lapse_starts_the_clock_at_the_period_end(self):
        sub = make_subscription(self.owner, period_end=NOW - timedelta(hours=3))
        self.assertEqual(clock.tick(now=NOW), {"overdue": 1, "reminders": 0, "paused": 0})
        sub.refresh_from_db()
        self.assertEqual(sub.overdue_since, NOW - timedelta(hours=3))
        self.assertEqual(sub.overdue_notice_at, NOW)
        self.assertIsNone(sub.paused_at)
        note = self.owner_notes("subscription_overdue").get()
        self.assertEqual(note.link, "/business-dashboard")
        self.assertIn("Wednesday 21 October", note.body)
        task = Task.objects.get(owner=self.scout)
        self.assertEqual((task.source_type, task.source_id), ("billing.subscription", str(sub.pk)))
        self.assertEqual(task.due_at, NOW + timedelta(days=1))
        self.assertIsNone(task.created_by)
        self.assertIn("Adwoa Fabrics", task.title)
        self.assertIn("day 1 of 14", task.title)
        self.assertIn("scouts never collect cash", task.notes)
        event = ActivityEvent.objects.get(verb="subscription.overdue")
        self.assertEqual(event.actor_type, ActivityEvent.SYSTEM)
        self.assertEqual((event.target_type, event.target_id), ("accounts.businessowner", str(self.owner.pk)))
        self.assertEqual(event.after["hide_on"], "2026-10-22")
        self.assertFalse(event.after["started_late"])
        self.assertEqual(event.after["account_manager_id"], self.scout.pk)

    def test_a_subscription_that_lapsed_long_ago_gets_the_full_grace(self):
        # Review Focus 4: the first run after this ships must not hide anyone at once.
        sub = make_subscription(self.owner, period_end=NOW - timedelta(days=60))
        listing = make_listing(self.owner)
        self.assertEqual(clock.tick(now=NOW), {"overdue": 1, "reminders": 0, "paused": 0})
        sub.refresh_from_db()
        self.assertEqual(sub.overdue_since, NOW)
        self.assertIsNone(sub.paused_at)
        self.assertIn(listing.id, public_listing_ids())
        self.assertTrue(ActivityEvent.objects.get(verb="subscription.overdue").after["started_late"])
        self.assertEqual(clock.tick(now=NOW + timedelta(days=13, hours=23))["paused"], 0)
        self.assertIn(listing.id, public_listing_ids())
        self.assertEqual(clock.tick(now=NOW + timedelta(days=14))["paused"], 1)
        self.assertNotIn(listing.id, public_listing_ids())

    def test_up_to_a_day_late_still_counts_from_the_period_end(self):
        on_time = make_subscription(self.owner, period_end=NOW - timedelta(hours=23))
        late = make_subscription(make_owner("Bantama Shoe Palace", manager=self.scout),
                                 period_end=NOW - timedelta(hours=25))
        self.assertEqual(clock.tick(now=NOW)["overdue"], 2)
        on_time.refresh_from_db()
        late.refresh_from_db()
        self.assertEqual(on_time.overdue_since, NOW - timedelta(hours=23))
        self.assertEqual(late.overdue_since, NOW)

    def test_reminders_go_on_day_7_and_day_13_once_each(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=7),
            overdue_since=NOW - timedelta(days=6), overdue_notice_at=NOW - timedelta(days=6),
        )
        self.assertEqual(clock.tick(now=NOW - timedelta(minutes=1))["reminders"], 0)  # still day 6
        self.assertEqual(clock.tick(now=NOW)["reminders"], 1)  # day 7
        self.assertEqual(clock.tick(now=NOW + timedelta(hours=1))["reminders"], 0)
        sub.refresh_from_db()
        self.assertEqual(sub.reminder_day7_at, NOW)
        self.assertIsNone(sub.reminder_day13_at)
        reminder = self.owner_notes("subscription_reminder").get()
        self.assertEqual(reminder.link, "/business-dashboard")
        self.assertIn("Thursday 15 October", reminder.title)
        self.assertIn("Friday 16 October", reminder.body)
        self.assertEqual(clock.tick(now=NOW + timedelta(days=6))["reminders"], 1)  # day 13
        self.assertEqual(clock.tick(now=NOW + timedelta(days=6, hours=1))["reminders"], 0)
        sub.refresh_from_db()
        self.assertEqual(sub.reminder_day13_at, NOW + timedelta(days=6))
        self.assertEqual(self.owner_notes("subscription_reminder").count(), 2)
        tasks = Task.objects.filter(owner=self.scout, source_type="billing.subscription", source_id=str(sub.pk))
        self.assertEqual(sorted(task.due_at for task in tasks), [NOW + timedelta(days=1), NOW + timedelta(days=7)])
        days = sorted(event.after["day"] for event in ActivityEvent.objects.filter(verb="subscription.reminder_sent"))
        self.assertEqual(days, [7, 13])
        self.assertFalse(ActivityEvent.objects.filter(verb="subscription.reminder_sent").exclude(actor_type=ActivityEvent.SYSTEM).exists())

    def test_a_late_run_sends_only_the_latest_reminder(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=13),
            overdue_since=NOW - timedelta(days=12), overdue_notice_at=NOW - timedelta(days=12),
        )
        self.assertEqual(clock.tick(now=NOW)["reminders"], 1)
        sub.refresh_from_db()
        self.assertEqual(sub.reminder_day13_at, NOW)
        self.assertIsNone(sub.reminder_day7_at)
        self.assertEqual(clock.tick(now=NOW + timedelta(hours=1))["reminders"], 0)
        self.assertEqual(self.owner_notes("subscription_reminder").count(), 1)

    def test_the_pause_starts_at_day_15_and_hides_the_business(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=15),
            overdue_since=NOW - timedelta(days=14), overdue_notice_at=NOW - timedelta(days=14),
            reminder_day7_at=NOW - timedelta(days=8), reminder_day13_at=NOW - timedelta(days=2),
        )
        listing = make_listing(self.owner)
        self.assertEqual(clock.tick(now=NOW - timedelta(minutes=1)), {"overdue": 0, "reminders": 0, "paused": 0})
        self.assertIn(listing.id, public_listing_ids())
        self.assertEqual(clock.tick(now=NOW), {"overdue": 0, "reminders": 0, "paused": 1})
        sub.refresh_from_db()
        self.assertEqual(sub.paused_at, NOW)
        self.assertNotIn(listing.id, public_listing_ids())
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PUBLISHED)  # hidden, never unpublished
        note = self.owner_notes("subscription_paused").get()
        self.assertEqual(note.link, "/business-dashboard")
        self.assertIn("Nothing has been deleted", note.body)
        event = ActivityEvent.objects.get(verb="subscription.paused")
        self.assertEqual(event.actor_type, ActivityEvent.SYSTEM)
        self.assertEqual(event.target_id, str(self.owner.pk))
        self.assertEqual(clock.tick(now=NOW + timedelta(days=1)), {"overdue": 0, "reminders": 0, "paused": 0})

    def test_running_twice_in_the_same_hour_changes_nothing_more(self):
        make_subscription(self.owner, period_end=NOW - timedelta(hours=1))
        clock.tick(now=NOW)
        counts = (Notification.objects.count(), Task.objects.count(), ActivityEvent.objects.count())
        self.assertEqual(clock.tick(now=NOW + timedelta(minutes=30)), {"overdue": 0, "reminders": 0, "paused": 0})
        self.assertEqual((Notification.objects.count(), Task.objects.count(), ActivityEvent.objects.count()), counts)

    def test_without_an_account_manager_operations_are_told_instead(self):
        owner = make_owner("Suame Auto Parts")
        make_subscription(owner, period_end=NOW - timedelta(hours=2))
        clock.tick(now=NOW)
        self.assertFalse(Task.objects.exists())
        note = Notification.objects.get(staff=self.lead, kind="subscription_overdue_unmanaged")
        self.assertEqual(note.link, "subscriptions-due")
        self.assertIn("Suame Auto Parts", note.title)
        self.assertFalse(Notification.objects.filter(staff=self.scout).exists())

    def test_a_suspended_account_manager_counts_as_none(self):
        self.scout.is_suspended = True
        self.scout.save(update_fields=["is_suspended"])
        make_subscription(self.owner, period_end=NOW - timedelta(hours=2))
        clock.tick(now=NOW)
        self.assertFalse(Task.objects.exists())
        self.assertTrue(
            Notification.objects.filter(staff=self.lead, kind="subscription_overdue_unmanaged").exists()
        )

    def test_owners_with_an_email_are_emailed_after_commit(self):
        self.owner.email = "adwoa@example.com"
        self.owner.save(update_fields=["email"])
        make_subscription(self.owner, period_end=NOW - timedelta(hours=3))
        make_subscription(make_owner("No Email Shop", manager=self.scout), period_end=NOW - timedelta(hours=3))
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(clock.tick(now=NOW)["overdue"], 2)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["adwoa@example.com"])
        self.assertEqual(mail.outbox[0].subject, "Your AshantiHub subscription has ended")
        self.assertIn("Wednesday 21 October", mail.outbox[0].body)
        self.assertIn("Adwoa Fabrics", mail.outbox[0].body)

    def test_reminder_and_pause_emails_say_when_and_what_happens(self):
        self.owner.email = "adwoa@example.com"
        self.owner.save(update_fields=["email"])
        make_subscription(
            self.owner, period_end=NOW - timedelta(days=7),
            overdue_since=NOW - timedelta(days=6), overdue_notice_at=NOW - timedelta(days=6),
        )
        with self.captureOnCommitCallbacks(execute=True):
            clock.tick(now=NOW)
        reminder = mail.outbox[-1]
        self.assertEqual(reminder.subject, "Reminder: renew your AshantiHub subscription by Thursday 15 October")
        self.assertIn("day 7 of 14", reminder.body)
        self.assertIn("Friday 16 October", reminder.body)
        with self.captureOnCommitCallbacks(execute=True):
            clock.tick(now=NOW + timedelta(days=8))
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(mail.outbox[-1].subject, "Your AshantiHub listings are hidden until you renew")
        self.assertIn("Nothing has been deleted", mail.outbox[-1].body)


class SubscriptionClockScheduleTests(TestCase):
    def test_the_clock_runs_hourly_at_five_past(self):
        entry = settings.CELERY_BEAT_SCHEDULE["billing-subscription-clock"]
        self.assertEqual(entry["task"], "billing.tasks.run_subscription_clock")
        self.assertEqual(entry["schedule"], crontab(minute=5))

    def test_the_task_runs_one_tick(self):
        make_subscription(make_owner(), period_end=timezone.now() - timedelta(hours=1))
        self.assertEqual(run_subscription_clock(), {"overdue": 1, "reminders": 0, "paused": 0})


@override_settings(PAYMENTS_PROVIDER="simulated", HUBTEL_WEBHOOK_SECRET=WEBHOOK_SECRET, SUBSCRIPTION_PAUSE_ENABLED=True)
class PaymentClearsTheClockTests(TestCase):
    CLOCK_FIELDS = ("overdue_since", "paused_at", "overdue_notice_at", "reminder_day7_at", "reminder_day13_at")

    def setUp(self):
        self.client = APIClient()
        self.owner = make_owner("Bantama Shoe Palace")
        self.listing = make_listing(self.owner)
        now = timezone.now()
        self.sub = make_subscription(
            self.owner, period_end=now - timedelta(days=16), overdue_since=now - timedelta(days=16),
            overdue_notice_at=now - timedelta(days=16), reminder_day7_at=now - timedelta(days=10),
            reminder_day13_at=now - timedelta(days=4), paused_at=now - timedelta(days=2),
        )

    def auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def assert_clock_cleared(self):
        self.sub.refresh_from_db()
        for field in self.CLOCK_FIELDS:
            self.assertIsNone(getattr(self.sub, field), field)

    def test_a_payment_during_the_pause_brings_the_listings_back(self):
        self.assertNotIn(self.listing.id, public_listing_ids())
        self.auth()
        response = self.client.post("/api/billing/transactions/mine/", {
            "kind": "subscription", "amount": "10.00", "purpose": "AshantiHub Product Basic — 1 month",
            "metadata": {"plan": "product_basic", "cycle_months": 1},
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assert_clock_cleared()
        self.assertGreater(self.sub.current_period_end, timezone.now())
        self.assertIn(self.listing.id, public_listing_ids())
        event = ActivityEvent.objects.get(verb="subscription.resumed")
        self.assertEqual((event.actor_type, event.actor_id), (ActivityEvent.BUSINESS_OWNER, self.owner.pk))
        self.assertEqual((event.target_type, event.target_id), ("accounts.businessowner", str(self.owner.pk)))
        self.assertEqual(event.after["was"], "paused")
        self.assertEqual(event.after["paid_on_day"], 17)
        self.assertEqual(event.after["business_name"], "Bantama Shoe Palace")
        note = Notification.objects.get(business_owner=self.owner, kind="subscription_resumed")
        self.assertEqual(note.link, "/business-dashboard")
        self.assertEqual(self.client.get("/api/billing/subscriptions/me/").json()["clock"]["state"], "active")

    def test_the_hubtel_webhook_payment_clears_it_too(self):
        session = CheckoutSession.objects.create(
            business_owner=self.owner, kind=CheckoutSession.SUBSCRIPTION, amount="10.00",
            purpose="AshantiHub Product Basic — 1 month", metadata={"plan": "product_basic", "cycle_months": 1},
        )
        raw = json.dumps({"ClientReference": session.reference, "Status": "Success"}).encode("utf-8")
        signature = hmac.new(WEBHOOK_SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        response = APIClient().generic(
            "POST", "/api/payments/webhook/hubtel/", data=raw, content_type="application/json",
            HTTP_X_HUBTEL_SIGNATURE=signature,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_clock_cleared()
        self.assertIn(self.listing.id, public_listing_ids())
        self.assertEqual(ActivityEvent.objects.filter(verb="subscription.resumed").count(), 1)

    def test_a_payment_while_the_tiers_plan_awaits_approval_renews_on_the_current_plan(self):
        # An edited plan waits for approval with no ACTIVE row for its tier; a
        # paid owner must still come back, not stay paused.
        SubscriptionPlan.objects.filter(tier="product_basic").update(status=SubscriptionPlan.PENDING_APPROVAL)
        session = CheckoutSession.objects.create(
            business_owner=self.owner, kind=CheckoutSession.SUBSCRIPTION, amount="10.00",
            purpose="AshantiHub Product Basic — 1 month", metadata={"plan": "product_basic", "cycle_months": 1},
        )
        with self.assertLogs("payments.services", level="WARNING") as logs:
            _finalize_subscription(session)
        self.assertIn("renewed on its current plan", logs.output[0])
        self.assert_clock_cleared()
        self.assertEqual(self.sub.plan.tier, "product_basic")
        self.assertGreater(self.sub.current_period_end, timezone.now() + timedelta(days=29))
        self.assertIn(self.listing.id, public_listing_ids())

    def test_a_payment_with_no_plan_to_renew_changes_nothing_and_says_so(self):
        SubscriptionPlan.objects.filter(tier="product_unlimited").update(status=SubscriptionPlan.PENDING_APPROVAL)
        other = make_owner("Asafo Fresh")
        session = CheckoutSession.objects.create(
            business_owner=other, kind=CheckoutSession.SUBSCRIPTION, amount="10.00",
            purpose="AshantiHub Product Unlimited — 1 month", metadata={"plan": "product_unlimited", "cycle_months": 1},
        )
        with self.assertLogs("payments.services", level="WARNING"):
            _finalize_subscription(session)
        self.assertFalse(Subscription.objects.filter(business_owner=other).exists())

    def test_a_payment_during_grace_reports_overdue_and_a_stopped_clock_reports_nothing(self):
        Subscription.objects.filter(pk=self.sub.pk).update(paused_at=None)
        self.sub.refresh_from_db()
        self.assertEqual(clock.clear_after_payment(self.sub, now=timezone.now()), "overdue")
        self.assert_clock_cleared()
        self.assertIsNone(clock.clear_after_payment(self.sub, now=timezone.now()))
        self.assertEqual(ActivityEvent.objects.filter(verb="subscription.resumed").count(), 1)
        self.assertEqual(
            ActivityEvent.objects.get(verb="subscription.resumed").after["was"], "overdue"
        )

    def test_a_payment_during_grace_says_so_in_the_log(self):
        Subscription.objects.filter(pk=self.sub.pk).update(paused_at=None)
        self.sub.refresh_from_db()
        clock.clear_after_payment(self.sub, now=timezone.now())
        self.assertEqual(ActivityEvent.objects.get(verb="subscription.resumed").summary, "Paid in the app during grace")

    def test_subscribing_without_a_payment_never_lifts_the_pause(self):
        # POST /api/billing/subscriptions/me/ grants a plan with no payment (an
        # existing hole, Decision 9) — it must never stop the clock.
        self.auth()
        response = self.client.post(
            "/api/billing/subscriptions/me/", {"plan": "product_basic", "cycle_months": 1}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.sub.refresh_from_db()
        self.assertIsNotNone(self.sub.paused_at)
        self.assertIsNotNone(self.sub.overdue_since)
        self.assertEqual(response.json()["clock"]["state"], "paused")
        self.assertNotIn(self.listing.id, public_listing_ids())
        self.assertFalse(ActivityEvent.objects.filter(verb="subscription.resumed").exists())

    def test_the_trial_path_never_lifts_the_pause_either(self):
        serializer = StartTrialSerializer(
            data={"business_kind": "product", "plan": "product_basic", "cycle_months": 1}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save(business_owner=self.owner)
        self.sub.refresh_from_db()
        self.assertTrue(self.sub.is_trial)
        self.assertIsNotNone(self.sub.paused_at)
        self.assertNotIn(self.listing.id, public_listing_ids())

    def test_an_unpaid_renewal_during_grace_does_not_stop_the_pause(self):
        started = timezone.now() - timedelta(days=10)
        Subscription.objects.filter(pk=self.sub.pk).update(
            paused_at=None, overdue_since=started, reminder_day13_at=None,
        )
        self.auth()
        self.client.post(
            "/api/billing/subscriptions/me/", {"plan": "product_basic", "cycle_months": 1}, format="json",
        )
        self.assertEqual(clock.tick(now=started + timedelta(days=14, minutes=1))["paused"], 1)
        self.assertNotIn(self.listing.id, public_listing_ids())


class ClockLiveUpdateTests(TestCase):
    """The clock's verbs (and kyc-, business., portfolio.) refresh the
    portfolio screens of everyone who manages portfolios."""

    KEYS = ["portfolio", "portfolio-business", "subscriptions-due"]

    def setUp(self):
        self.layer = get_channel_layer()
        async_to_sync(self.layer.flush)()

    def listen(self, group):
        channel = async_to_sync(self.layer.new_channel)()
        async_to_sync(self.layer.group_add)(group, channel)
        return channel

    def message(self, channel):
        async def receive():
            return await asyncio.wait_for(self.layer.receive(channel), timeout=2)

        return async_to_sync(receive)()

    def test_a_clock_run_refreshes_operations_and_scouts(self):
        operations = self.listen("perm.portfolio.manage")
        scouts = self.listen("perm.businesses.manage_portfolio")
        make_subscription(make_owner(), period_end=NOW - timedelta(hours=3))
        with self.captureOnCommitCallbacks(execute=True):
            clock.tick(now=NOW)
        self.assertEqual(self.message(operations)["payload"]["invalidate"], self.KEYS)
        self.assertEqual(self.message(scouts)["payload"]["invalidate"], self.KEYS)
        # The clock gives the account manager a task, so their task list and badges refresh too.
        self.assertEqual(self.message(scouts)["payload"]["invalidate"], ["my-tasks", "staff-badges"])

    def test_kyc_business_portfolio_and_subscription_verbs_all_refresh_them(self):
        for verb in ("kyc-approve", "business.registered", "portfolio.photo_staged", "subscription.resumed"):
            with self.subTest(verb=verb):
                operations = self.listen("perm.portfolio.manage")
                with self.captureOnCommitCallbacks(execute=True):
                    record(None, verb, target_type="accounts.businessowner", target_id="1")
                self.assertEqual(self.message(operations)["payload"]["invalidate"], self.KEYS)


class PauseSettingTests(TestCase):
    def test_the_pause_is_off_unless_the_environment_turns_it_on(self):
        # User decision U3: off until an in-app wallet can renew automatically.
        self.assertIs(settings.SUBSCRIPTION_PAUSE_ENABLED, False)


@override_settings(SUBSCRIPTION_PAUSE_ENABLED=False, PAYMENTS_PROVIDER="simulated")
class PauseSwitchedOffTests(TestCase):
    """User decision U3: with SUBSCRIPTION_PAUSE_ENABLED off the clock still
    marks overdue, reminds on days 7 and 13 and tasks the account manager, but
    never pauses or hides, and no message counts down to a pause."""

    # Copy the owner sees or staff read: none of it may count down or threaten hiding.
    PAUSE_WORDS = ("hidden", "hide", "of 14", "visible", "Renew by", "renew by", "paused")

    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = make_owner("Adwoa Fabrics", email="adwoa@example.com", manager=self.scout)

    def assert_no_pause_words(self, *texts):
        for text in texts:
            for word in self.PAUSE_WORDS:
                self.assertNotIn(word, text, text)

    def test_the_state_never_reads_paused_and_counts_days_past_14(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=21),
            overdue_since=NOW - timedelta(days=20, hours=3), paused_at=NOW - timedelta(days=6),
        )
        state = clock.subscription_state(sub, now=NOW)
        self.assertEqual(set(state), STATE_KEYS)
        self.assertEqual(state["state"], "overdue")
        self.assertIs(state["pause_enabled"], False)
        self.assertEqual(state["overdue_day"], 21)
        self.assertEqual(parse_datetime(state["overdue_since"]), NOW - timedelta(days=20, hours=3))
        for key in ("pause_at", "hide_on", "renew_by", "paused_at"):
            self.assertIsNone(state[key], key)
        self.assertIs(clock.subscription_state(None, now=NOW)["pause_enabled"], False)

    def test_a_fresh_lapse_reads_as_day_one_without_dates_to_hide_on(self):
        sub = make_subscription(self.owner, period_end=NOW - timedelta(hours=3))
        state = clock.subscription_state(sub, now=NOW)
        self.assertEqual((state["state"], state["overdue_day"]), ("overdue", 1))
        self.assertEqual((state["pause_at"], state["hide_on"], state["renew_by"]), (None, None, None))

    def test_nothing_is_paused_or_hidden_after_14_days(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=30),
            overdue_since=NOW - timedelta(days=20), overdue_notice_at=NOW - timedelta(days=20),
            reminder_day7_at=NOW - timedelta(days=14), reminder_day13_at=NOW - timedelta(days=8),
        )
        listing = make_listing(self.owner)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(clock.tick(now=NOW), {"overdue": 0, "reminders": 0, "paused": 0})
        sub.refresh_from_db()
        self.assertIsNone(sub.paused_at)
        self.assertIn(listing.id, public_listing_ids())
        self.assertFalse(Notification.objects.filter(kind="subscription_paused").exists())
        self.assertFalse(ActivityEvent.objects.filter(verb="subscription.paused").exists())
        self.assertEqual(mail.outbox, [])

    def test_a_row_paused_before_the_switch_stays_visible(self):
        make_subscription(
            self.owner, period_end=NOW - timedelta(days=30),
            overdue_since=NOW - timedelta(days=20), paused_at=NOW - timedelta(days=6),
        )
        listing = make_listing(self.owner)
        self.assertIn(listing.id, public_listing_ids())

    def test_the_overdue_notice_task_and_email_say_when_it_ended_and_nothing_about_hiding(self):
        sub = make_subscription(self.owner, period_end=NOW - timedelta(hours=3))
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(clock.tick(now=NOW), {"overdue": 1, "reminders": 0, "paused": 0})
        sub.refresh_from_db()
        self.assertEqual(sub.overdue_since, NOW - timedelta(hours=3))
        note = Notification.objects.get(business_owner=self.owner, kind="subscription_overdue")
        self.assertEqual(note.title, "Your subscription has ended")
        self.assertEqual(
            note.body, "Your Product Basic subscription ended on Thursday 8 October. Renew in your dashboard to keep your plan.",
        )
        task = Task.objects.get(owner=self.scout)
        self.assertEqual(task.title, "Subscription overdue — Adwoa Fabrics (since Thursday 8 October)")
        self.assertEqual(task.notes, "The owner pays in the app — scouts never collect cash.")
        self.assertEqual(task.due_at, NOW + timedelta(days=1))
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "Your AshantiHub subscription has ended")
        self.assertIn(
            "Your Product Basic subscription ended on Thursday 8 October. Renew in your dashboard to keep your plan.",
            mail.outbox[0].body,
        )
        event = ActivityEvent.objects.get(verb="subscription.overdue")
        self.assertEqual(event.summary, "Subscription overdue — ended on Thursday 8 October")
        self.assertNotIn("hide_on", event.after)
        self.assert_no_pause_words(note.title, note.body, task.title, task.notes, mail.outbox[0].subject,
                                   mail.outbox[0].body, event.summary)

    def test_the_day_7_and_day_13_reminders_drop_the_countdown(self):
        make_subscription(
            self.owner, period_end=NOW - timedelta(days=6),
            overdue_since=NOW - timedelta(days=6), overdue_notice_at=NOW - timedelta(days=6),
        )
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(clock.tick(now=NOW)["reminders"], 1)  # day 7
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(clock.tick(now=NOW + timedelta(days=6))["reminders"], 1)  # day 13
        reminders = list(Notification.objects.filter(business_owner=self.owner, kind="subscription_reminder"))
        self.assertEqual(len(reminders), 2)
        for note in reminders:
            self.assertEqual(note.title, "Reminder: renew your subscription")
            self.assertEqual(note.body, "Your Product Basic subscription ended on Friday 2 October and hasn't been renewed yet.")
        self.assertEqual(
            [message.subject for message in mail.outbox],
            ["Reminder: renew your AshantiHub subscription"] * 2,
        )
        for message in mail.outbox:
            self.assertIn("Your Product Basic subscription ended on Friday 2 October and hasn't been renewed yet.", message.body)
        tasks = list(Task.objects.filter(owner=self.scout))
        self.assertEqual(
            [task.title for task in tasks], ["Subscription overdue — Adwoa Fabrics (since Friday 2 October)"] * 2,
        )
        events = list(ActivityEvent.objects.filter(verb="subscription.reminder_sent"))
        self.assertEqual(sorted(event.after["day"] for event in events), [7, 13])
        self.assertFalse(any("hide_on" in event.after for event in events))
        self.assert_no_pause_words(
            *[text for note in reminders for text in (note.title, note.body)],
            *[text for message in mail.outbox for text in (message.subject, message.body)],
            *[text for task in tasks for text in (task.title, task.notes)],
        )

    def test_an_unmanaged_business_tells_operations_without_a_countdown(self):
        owner = make_owner("Suame Auto Parts")
        make_subscription(owner, period_end=NOW - timedelta(hours=2))
        clock.tick(now=NOW)
        note = Notification.objects.get(staff=self.lead, kind="subscription_overdue_unmanaged")
        self.assertEqual(note.title, "Suame Auto Parts: subscription overdue, no account manager")
        self.assertEqual(
            note.body,
            "Its Product Basic subscription ended on Thursday 8 October and hasn't been renewed. "
            "Assign a scout or follow it up.",
        )
        self.assert_no_pause_words(note.title, note.body)

    def test_paying_a_row_paused_before_the_switch_reports_overdue(self):
        sub = make_subscription(
            self.owner, period_end=NOW - timedelta(days=30),
            overdue_since=NOW - timedelta(days=20), paused_at=NOW - timedelta(days=6),
        )
        self.assertEqual(clock.clear_after_payment(sub, now=NOW), "overdue")
        sub.refresh_from_db()
        self.assertIsNone(sub.paused_at)
        note = Notification.objects.get(business_owner=self.owner, kind="subscription_resumed")
        self.assertEqual(note.body, "Thank you — your listings stay visible.")
        event = ActivityEvent.objects.get(verb="subscription.resumed")
        self.assertEqual(event.after["was"], "overdue")
        self.assertEqual(event.summary, "Paid in the app while overdue")

    def test_the_owner_sees_pause_enabled_on_their_subscription(self):
        started = timezone.now() - timedelta(days=20)
        make_subscription(self.owner, period_end=started, overdue_since=started, paused_at=started + timedelta(days=14))
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        body = client.get("/api/billing/subscriptions/me/").json()["clock"]
        self.assertEqual((body["state"], body["pause_enabled"], body["overdue_day"]), ("overdue", False, 21))
