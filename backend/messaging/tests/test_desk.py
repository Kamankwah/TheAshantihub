"""The Support desk (package B): scopes and counts, round-robin and capacity, bulk
assign, snooze and wake, resolve and auto-reopen, escalation, hand-offs, mentions,
limits, and the note-leak contract for every new endpoint."""

import datetime
from unittest import mock

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from messaging import services
from messaging.models import Conversation, ConversationTag, Message, SupportAgentState, SupportSettings
from notifications.models import Notification
from staff_tasks.models import Task
from targets.models import Leave

BASE = "/api/messaging/staff/"
SECRET = "INTERNAL-ONLY-do-not-leak"
GUEST = "g" * 36


class DeskBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ama = make_staff("operations", "ama@example.com")
        self.esi = make_staff("support", "esi@example.com", manager=self.ama)
        self.nana = make_staff("support", "nana@example.com", manager=self.ama)
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.ama)
        self.admin = make_staff("super_admin", "root@example.com")
        self.marketing = make_staff("marketing", "mkt@example.com")
        self.customer = Customer.objects.create(full_name="Yaw Mensah", phone="+233245553553", password_hash="x")
        self.owner = BusinessOwner.objects.create(
            full_name="Adwoa Pokuaa", login_phone="+233207111222", password_hash="x", account_manager=self.kwame,
        )
        self.tokens = {}

    def sign_in(self, *people):
        for person in people:
            self.tokens[person.pk] = staff_token(person)

    def as_staff(self, person):
        token = self.tokens.get(person.pk) or staff_token(person)
        self.tokens[person.pk] = token
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def as_customer(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")

    def as_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def thread(self, **fields):
        fields.setdefault("customer", self.customer)
        conversation = Conversation.objects.create(**fields)
        services.stamp_clocks(conversation)
        Message.objects.create(conversation=conversation, sender_type="customer" if conversation.customer_id else "business_owner" if conversation.business_owner_id else "guest", body="Where is my order?")
        return conversation

    def post(self, path, data=None):
        return self.client.post(BASE + path, data or {}, format="json")


class PermissionTests(DeskBase):
    def test_every_endpoint_needs_messaging_manage(self):
        conversation = self.thread()
        gets = ["", "team/", "limits/", f"{conversation.pk}/", f"{conversation.pk}/context/"]
        posts = [
            "assign/", "me/away/", f"{conversation.pk}/reply/", f"{conversation.pk}/note/", f"{conversation.pk}/assign/",
            f"{conversation.pk}/priority/", f"{conversation.pk}/snooze/", f"{conversation.pk}/wake/", f"{conversation.pk}/resolve/",
            f"{conversation.pk}/reopen/", f"{conversation.pk}/tags/", f"{conversation.pk}/loop-in/",
            f"{conversation.pk}/ask-accounting/", f"{conversation.pk}/escalate/",
        ]
        for who in ("anon", "customer", "marketing"):
            if who == "anon":
                self.client.credentials()
            elif who == "customer":
                self.as_customer()
            else:
                self.as_staff(self.marketing)
            expected = 401 if who == "anon" else 403
            for path in gets:
                self.assertEqual(self.client.get(BASE + path).status_code, expected, (who, path))
            for path in posts:
                self.assertEqual(self.client.post(BASE + path, {}, format="json").status_code, expected, (who, path))
            self.assertEqual(self.client.patch(BASE + "limits/", {}, format="json").status_code, expected, who)

    def test_only_support_limits_can_change_the_limits(self):
        self.as_staff(self.esi)
        self.assertEqual(self.client.get(BASE + "limits/").status_code, 200)
        self.assertEqual(self.client.patch(BASE + "limits/", {"capacity_per_agent": 9}, format="json").status_code, 403)


class RoundRobinTests(DeskBase):
    def start(self, subject="Help"):
        self.as_customer()
        response = self.client.post("/api/messaging/conversations/", {"subject": subject, "body": "Hello"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return Conversation.objects.get(pk=response.json()["id"])

    def test_goes_to_the_signed_in_agent_with_the_fewest_open(self):
        self.sign_in(self.esi, self.nana)
        Conversation.objects.create(customer=self.customer, assignee=self.esi)
        conversation = self.start()
        self.assertEqual(conversation.assignee, self.nana)
        self.assertIsNotNone(conversation.first_reply_due)
        self.assertEqual(conversation.unassigned_reason, "")

    def test_skips_agents_who_are_not_signed_in_away_or_on_leave(self):
        self.sign_in(self.esi)
        Notification.objects.all().delete()
        self.assertEqual(self.start().assignee, self.esi)  # nana never signed in
        SupportAgentState.objects.create(staff=self.esi, away=True)
        unassigned = self.start()
        self.assertIsNone(unassigned.assignee)
        self.assertEqual(unassigned.unassigned_reason, "Nobody is signed in and available.")
        SupportAgentState.objects.filter(staff=self.esi).update(away=False)
        today = timezone.localdate()
        Leave.objects.create(staff=self.esi, start=today, end=today, recorded_by=self.ama)
        self.assertIsNone(self.start().assignee)

    def test_away_with_a_past_until_no_longer_counts(self):
        self.sign_in(self.esi)
        SupportAgentState.objects.create(staff=self.esi, away=True, away_until=timezone.now() - datetime.timedelta(minutes=1))
        self.assertEqual(self.start().assignee, self.esi)

    def test_capacity_stops_assignment_and_says_why(self):
        self.sign_in(self.esi, self.nana)
        rules = SupportSettings.load()
        rules.capacity_per_agent = 1
        rules.save()
        first, second, third = self.start("1"), self.start("2"), self.start("3")
        self.assertEqual({first.assignee, second.assignee}, {self.esi, self.nana})
        self.assertIsNone(third.assignee)
        self.assertEqual(third.unassigned_reason, "Everyone on shift is at their limit.")

    def test_a_snoozed_conversation_frees_room(self):
        self.sign_in(self.esi)
        rules = SupportSettings.load()
        rules.capacity_per_agent = 1
        rules.save()
        held = self.start()
        Conversation.objects.filter(pk=held.pk).update(snoozed_until=timezone.now() + datetime.timedelta(hours=2))
        self.assertEqual(self.start().assignee, self.esi)

    def test_round_robin_off_leaves_it_unassigned(self):
        self.sign_in(self.esi)
        rules = SupportSettings.load()
        rules.round_robin = False
        rules.save()
        conversation = self.start()
        self.assertIsNone(conversation.assignee)
        self.assertIn("switched off", conversation.unassigned_reason)

    def test_only_the_assignee_is_notified(self):
        self.sign_in(self.esi, self.nana)
        Conversation.objects.create(customer=self.customer, assignee=self.esi)
        Notification.objects.all().delete()
        conversation = self.start()
        self.assertEqual(conversation.assignee, self.nana)
        self.assertEqual(Notification.objects.filter(staff=self.nana, kind="new_message").count(), 1)
        self.assertFalse(Notification.objects.filter(staff=self.esi).exists())
        self.assertFalse(Notification.objects.filter(staff=self.admin).exists())

    def test_unassigned_tells_only_agents_on_shift(self):
        self.sign_in(self.esi, self.nana)
        SupportAgentState.objects.create(staff=self.nana, away=True)
        SupportAgentState.objects.create(staff=self.esi, away=True)
        Notification.objects.all().delete()
        self.start()
        self.assertFalse(Notification.objects.exists())  # both Away: nobody is on shift to tell
        SupportAgentState.objects.filter(staff=self.nana).update(away=False)
        self.assertEqual(self.start().assignee, self.nana)

    def test_capacity_board_reports_room_and_never_shift_times(self):
        self.sign_in(self.esi)
        board = {row["name"]: row for row in services.capacity_board()}
        self.assertTrue(board["Esi"]["available"])
        self.assertFalse(board["Nana"]["signed_in"])
        self.assertIn("Not signed in", board["Nana"]["note"])
        self.assertNotIn("shift", " ".join(row["note"] for row in board.values()).lower())


class ListAndScopeTests(DeskBase):
    def setUp(self):
        super().setUp()
        self.mine = self.thread(assignee=self.esi, subject="Mine one")
        self.theirs = self.thread(assignee=self.nana, subject="Nana one")
        self.free = self.thread(subject="Nobody")
        self.snoozed = self.thread(assignee=self.esi, snoozed_until=timezone.now() + datetime.timedelta(hours=3), snoozed_by=self.esi)
        self.done = self.thread(assignee=self.esi, status="closed", resolved_at=timezone.now(), resolved_by=self.esi, resolution_code="answered")
        self.late = self.thread(assignee=self.nana, subject="Late")
        Conversation.objects.filter(pk=self.late.pk).update(first_reply_due=timezone.now() - datetime.timedelta(minutes=8))
        self.as_staff(self.esi)

    def ids(self, **params):
        response = self.client.get(BASE, params)
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()["results"]], response.json()

    def test_scopes(self):
        self.assertEqual(self.ids(scope="mine")[0], [self.mine.pk])
        self.assertEqual(self.ids(scope="unassigned")[0], [self.free.pk])
        self.assertEqual(sorted(self.ids(scope="all")[0]), sorted([self.mine.pk, self.theirs.pk, self.free.pk, self.late.pk]))
        self.assertEqual(self.ids(scope="past")[0], [self.late.pk])
        self.assertEqual(self.ids(scope="past", mine="1")[0], [])
        self.assertEqual(self.ids(scope="snoozed")[0], [self.snoozed.pk])
        self.assertEqual(self.ids(scope="resolved")[0], [self.done.pk])
        everything, _ = self.ids()  # no scope: the older list of every conversation
        self.assertEqual(len(everything), 6)

    def test_counts_and_summary(self):
        _, body = self.ids(scope="mine")
        counts = body["counts"]
        self.assertEqual((counts["mine"], counts["unassigned"], counts["all_open"], counts["past_limit"], counts["snoozed"]), (1, 1, 4, 1, 1))
        _, past = self.ids(scope="past")
        self.assertEqual(past["summary"]["past_limit"], 1)
        self.assertIsNone(past["summary"]["first_reply_today_avg_seconds"])  # nobody answered anything: no average

    def test_sort_time_limit_soonest_first_and_priority(self):
        order, _ = self.ids(scope="all")
        self.assertEqual(order[0], self.late.pk)  # the one past its limit comes first
        Conversation.objects.filter(pk=self.free.pk).update(priority="high")
        order, _ = self.ids(scope="all", sort="priority")
        self.assertEqual(order[0], self.free.pk)

    def test_search_finds_people_threads_and_message_text(self):
        self.assertIn(self.mine.pk, self.ids(q="Yaw")[0])
        self.assertEqual(self.ids(q=f"#{self.free.pk}")[0], [self.free.pk])
        self.assertEqual(self.ids(q="zzzz-nothing")[0], [])
        self.assertIn(self.free.pk, self.ids(q="where is my order")[0])

    def test_a_row_names_a_guest_without_any_contact_data(self):
        guest = self.thread(customer=None, guest_token=GUEST)
        rows = {row["id"]: row for row in self.client.get(BASE, {"scope": "all"}).json()["results"]}
        row = rows[guest.pk]
        self.assertEqual(row["kind"], "guest")
        self.assertEqual(row["display_name"], f"Guest · thread {guest.pk}")
        text = str(row).lower()
        for banned in ("phone", "email", GUEST, "@"):
            self.assertNotIn(banned, text)

    def test_the_last_message_ignores_notes_and_events(self):
        Message.objects.create(conversation=self.mine, sender_type="staff", kind="note", body=SECRET, author=self.esi)
        row = next(r for r in self.client.get(BASE, {"scope": "mine"}).json()["results"] if r["id"] == self.mine.pk)
        self.assertEqual(row["last_message"]["body"], "Where is my order?")
        self.assertTrue(row["needs_reply"])

    def test_reads_write_nothing(self):
        before = (Conversation.objects.count(), Message.objects.count(), Task.objects.count(), Notification.objects.count(), SupportSettings.objects.count(), ActivityEvent.objects.count())
        SupportSettings.objects.all().delete()
        before = before[:4] + (0,) + before[5:]
        with CaptureQueriesContext(connection) as queries:
            for path in ("", "?scope=mine", f"{self.mine.pk}/", f"{self.mine.pk}/context/", "team/", "limits/"):
                self.assertEqual(self.client.get(BASE + path).status_code, 200, path)
        writes = [q["sql"] for q in queries if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) and "staffsession" not in q["sql"].lower()]
        self.assertEqual(writes, [])
        after = (Conversation.objects.count(), Message.objects.count(), Task.objects.count(), Notification.objects.count(), SupportSettings.objects.count(), ActivityEvent.objects.count())
        self.assertEqual(before[:5], after[:5])


class ReplyNoteAssignTests(DeskBase):
    def test_reply_stamps_the_first_reply_and_takes_an_unassigned_thread(self):
        conversation = self.thread()
        self.as_staff(self.esi)
        response = self.post(f"{conversation.pk}/reply/", {"body": "On it."})
        self.assertEqual(response.status_code, 201)
        conversation.refresh_from_db()
        self.assertIsNotNone(conversation.first_reply_at)
        self.assertEqual(conversation.assignee, self.esi)
        self.assertEqual(response.json().keys(), {"id", "conversation", "sender_type", "body", "created_at"})
        self.assertTrue(Notification.objects.filter(customer=self.customer, kind="support_reply").exists())

    def test_replying_to_a_resolved_thread_is_refused(self):
        conversation = self.thread(status="closed", resolved_at=timezone.now())
        self.as_staff(self.esi)
        self.assertEqual(self.post(f"{conversation.pk}/reply/", {"body": "hi"}).status_code, 409)

    def test_assign_and_hand_back(self):
        conversation = self.thread()
        self.as_staff(self.esi)
        response = self.post(f"{conversation.pk}/assign/", {"assignee": self.nana.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["assignee"]["name"], "Nana")
        self.assertTrue(Notification.objects.filter(staff=self.nana, kind="assignment").exists())
        response = self.post(f"{conversation.pk}/assign/", {"assignee": None})
        self.assertIsNone(response.json()["assignee"])
        self.assertIn("Handed back", response.json()["unassigned_reason"])
        self.assertEqual(self.post(f"{conversation.pk}/assign/", {"assignee": self.marketing.pk}).status_code, 400)

    def test_assign_to_someone_at_capacity_is_refused_unless_a_lead_overrides(self):
        rules = SupportSettings.load()
        rules.capacity_per_agent = 1
        rules.save()
        Conversation.objects.create(customer=self.customer, assignee=self.nana)
        conversation = self.thread()
        self.as_staff(self.esi)
        refused = self.post(f"{conversation.pk}/assign/", {"assignee": self.nana.pk, "override": True})
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "at_capacity"))  # Support has no support.limits
        self.as_staff(self.admin)
        self.assertEqual(self.post(f"{conversation.pk}/assign/", {"assignee": self.nana.pk, "override": True}).status_code, 200)

    def test_bulk_assign_is_all_or_nothing_against_the_capacity(self):
        rules = SupportSettings.load()
        rules.capacity_per_agent = 2
        rules.save()
        a, b, c = self.thread(), self.thread(), self.thread()
        self.as_staff(self.esi)
        refused = self.post("assign/", {"ids": [a.pk, b.pk, c.pk], "assignee": self.nana.pk})
        self.assertEqual((refused.status_code, refused.json()["code"], refused.json()["free"]), (409, "at_capacity", 2))
        self.assertFalse(Conversation.objects.filter(assignee=self.nana).exists())
        ok = self.post("assign/", {"ids": [a.pk, b.pk], "assignee": self.nana.pk})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(sorted(ok.json()["assigned"]), sorted([a.pk, b.pk]))
        self.assertEqual(Conversation.objects.filter(assignee=self.nana).count(), 2)
        self.assertEqual(ActivityEvent.objects.filter(verb="support.conversations_bulk_assigned").count(), 1)

    def test_bulk_assign_skips_resolved_conversations(self):
        open_one = self.thread()
        done = self.thread(status="closed", resolved_at=timezone.now())
        self.as_staff(self.esi)
        response = self.post("assign/", {"ids": [open_one.pk, done.pk, 99999], "assignee": self.nana.pk})
        self.assertEqual(response.json()["assigned"], [open_one.pk])
        self.assertEqual(sorted(response.json()["skipped"]), sorted([done.pk, 99999]))

    def test_state_changes_lock_the_row(self):
        conversation = self.thread(assignee=self.esi)
        self.as_staff(self.esi)
        until = (timezone.now() + datetime.timedelta(hours=2)).isoformat()
        calls = [
            (f"{conversation.pk}/reply/", {"body": "x"}), (f"{conversation.pk}/note/", {"body": "n"}),
            (f"{conversation.pk}/assign/", {"assignee": self.nana.pk}), (f"{conversation.pk}/priority/", {"priority": "high"}),
            (f"{conversation.pk}/snooze/", {"until": until}), (f"{conversation.pk}/wake/", {}),
            (f"{conversation.pk}/resolve/", {"code": "answered"}), (f"{conversation.pk}/reopen/", {}),
            ("assign/", {"ids": [conversation.pk], "assignee": self.esi.pk}),
        ]
        for path, data in calls:
            with CaptureQueriesContext(connection) as queries:
                self.post(path, data)
            self.assertTrue(any("FOR UPDATE" in q["sql"] for q in queries), path)

    def test_priority_restamps_the_limits(self):
        conversation = self.thread()
        self.as_staff(self.esi)
        before = Conversation.objects.get(pk=conversation.pk).first_reply_due
        self.assertEqual(self.post(f"{conversation.pk}/priority/", {"priority": "high"}).status_code, 200)
        after = Conversation.objects.get(pk=conversation.pk)
        self.assertEqual(after.priority, "high")
        self.assertLess(after.first_reply_due, before)
        self.assertEqual(self.post(f"{conversation.pk}/priority/", {"priority": "urgent"}).status_code, 400)

    def test_tags_replace_but_keep_archived_ones(self):
        conversation = self.thread()
        old = ConversationTag.objects.create(name="zz-old", archived_at=timezone.now())
        late, food = ConversationTag.objects.create(name="zz-late"), ConversationTag.objects.create(name="zz-food")
        retired = ConversationTag.objects.create(name="zz-retired", archived_at=timezone.now())
        conversation.tags.add(old)
        self.as_staff(self.esi)
        response = self.post(f"{conversation.pk}/tags/", {"tags": [late.pk, food.pk, retired.pk]})
        self.assertEqual(sorted(t["name"] for t in response.json()["tags"]), ["zz-food", "zz-late", "zz-old"])


class NoteAndMentionTests(DeskBase):
    def test_a_note_notifies_only_eligible_teammates_who_were_mentioned(self):
        conversation = self.thread()
        self.as_staff(self.esi)
        response = self.post(f"{conversation.pk}/note/", {"body": SECRET, "mentions": [self.nana.pk, self.marketing.pk, self.esi.pk, 99999]})
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual([n["name"] for n in body["notified"]], ["Nana"])
        self.assertEqual(sorted(body["not_notified"]), sorted([self.marketing.pk, 99999]))
        self.assertEqual(Notification.objects.filter(kind="mention").count(), 1)
        self.assertTrue(Notification.objects.filter(staff=self.nana, kind="mention").exists())
        message = Message.objects.get(pk=body["message"]["id"])
        self.assertEqual((message.kind, message.is_internal), ("note", True))

    def test_a_note_never_reaches_the_customer_after_any_action(self):
        conversation = self.thread()
        self.as_staff(self.esi)
        self.post(f"{conversation.pk}/note/", {"body": SECRET})
        self.post(f"{conversation.pk}/assign/", {"assignee": self.nana.pk})
        self.post(f"{conversation.pk}/priority/", {"priority": "high"})
        self.post(f"{conversation.pk}/resolve/", {"code": "other", "note": SECRET + " resolve"})
        self.post(f"{conversation.pk}/reopen/")
        self.post(f"{conversation.pk}/escalate/", {"message": SECRET + " esc"})
        self.post(f"{conversation.pk}/ask-accounting/", {"note": SECRET + " acc"})
        self.as_customer()
        for response in (
            self.client.get("/api/messaging/conversations/"),
        ):
            text = response.content.decode()
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("INTERNAL-ONLY", text)
            self.assertNotIn("Assigned to", text)
            self.assertNotIn("reopened", text.lower())
        reply = self.client.post(f"/api/messaging/conversations/{conversation.pk}/messages/", {"body": "thanks"}, format="json")
        self.assertNotIn("INTERNAL-ONLY", reply.content.decode())

    def test_the_guest_poll_and_owner_list_hide_events_and_notes(self):
        guest = self.thread(customer=None, guest_token=GUEST)
        owner_thread = self.thread(customer=None, business_owner=self.owner)
        self.as_staff(self.esi)
        for conversation in (guest, owner_thread):
            self.post(f"{conversation.pk}/note/", {"body": SECRET})
            self.post(f"{conversation.pk}/assign/", {"assignee": self.nana.pk})
        self.client.credentials()
        text = self.client.get("/api/messaging/conversations/", {"guest_token": GUEST}).content.decode()
        self.assertNotIn("INTERNAL-ONLY", text)
        self.assertNotIn("Assigned to", text)
        self.as_owner()
        text = self.client.get("/api/messaging/conversations/").content.decode()
        self.assertNotIn("INTERNAL-ONLY", text)
        self.assertNotIn("Assigned to", text)

    def test_the_context_pane_and_handoffs_carry_no_internal_note_text(self):
        conversation = self.thread(customer=None, business_owner=self.owner)
        self.as_staff(self.esi)
        self.post(f"{conversation.pk}/note/", {"body": SECRET})
        self.post(f"{conversation.pk}/loop-in/", {"note": "Please call her."})
        self.post(f"{conversation.pk}/ask-accounting/", {})
        context = self.client.get(BASE + f"{conversation.pk}/context/").content.decode()
        self.assertNotIn("INTERNAL-ONLY", context)
        for task in Task.objects.all():
            self.assertNotIn("INTERNAL-ONLY", task.notes + task.title)
        for notice in Notification.objects.all():
            self.assertNotIn("INTERNAL-ONLY", notice.body + notice.title)


class SnoozeResolveTests(DeskBase):
    def test_snooze_hides_the_thread_and_makes_a_task_for_the_snoozer(self):
        conversation = self.thread(assignee=self.esi)
        self.as_staff(self.esi)
        until = timezone.now() + datetime.timedelta(hours=3)
        response = self.post(f"{conversation.pk}/snooze/", {"until": until.isoformat()})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["snoozed"])
        task = Task.objects.get(kind=Task.SNOOZE_WAKE)
        self.assertEqual((task.owner, task.source_type, task.source_id), (self.esi, "messaging.conversation", str(conversation.pk)))
        self.assertEqual(self.client.get(BASE, {"scope": "mine"}).json()["results"], [])
        self.assertEqual(len(self.client.get(BASE, {"scope": "snoozed"}).json()["results"]), 1)
        # changing the time replaces the reminder
        later = until + datetime.timedelta(hours=1)
        self.post(f"{conversation.pk}/snooze/", {"until": later.isoformat()})
        self.assertEqual(Task.objects.filter(kind=Task.SNOOZE_WAKE, status=Task.OPEN).count(), 1)
        self.assertEqual(Task.objects.filter(kind=Task.SNOOZE_WAKE, status=Task.CANCELLED).count(), 1)

    def test_snooze_times_are_bounded(self):
        conversation = self.thread()
        self.as_staff(self.esi)
        for until in (timezone.now(), timezone.now() + datetime.timedelta(days=40)):
            self.assertEqual(self.post(f"{conversation.pk}/snooze/", {"until": until.isoformat()}).status_code, 400)
        self.assertEqual(self.post(f"{conversation.pk}/snooze/", {}).status_code, 400)

    def test_snoozing_an_unassigned_thread_takes_it(self):
        conversation = self.thread()
        self.as_staff(self.esi)
        self.post(f"{conversation.pk}/snooze/", {"until": (timezone.now() + datetime.timedelta(hours=1)).isoformat()})
        conversation.refresh_from_db()
        self.assertEqual(conversation.assignee, self.esi)

    def test_wake_now_and_not_snoozed(self):
        conversation = self.thread(assignee=self.esi)
        self.as_staff(self.esi)
        self.assertEqual(self.post(f"{conversation.pk}/wake/").status_code, 409)
        self.post(f"{conversation.pk}/snooze/", {"until": (timezone.now() + datetime.timedelta(hours=1)).isoformat()})
        response = self.post(f"{conversation.pk}/wake/")
        self.assertFalse(response.json()["snoozed"])
        self.assertFalse(Task.objects.filter(kind=Task.SNOOZE_WAKE, status=Task.OPEN).exists())

    def test_the_beat_job_wakes_due_snoozes_and_tells_the_assignee(self):
        due = self.thread(assignee=self.esi, snoozed_until=timezone.now() - datetime.timedelta(minutes=1), snoozed_by=self.esi)
        later = self.thread(assignee=self.esi, snoozed_until=timezone.now() + datetime.timedelta(hours=1))
        orphan = self.thread(snoozed_until=timezone.now() - datetime.timedelta(minutes=1))
        self.sign_in(self.nana)
        Notification.objects.all().delete()
        self.assertEqual(services.wake_due_snoozes(), 2)
        due.refresh_from_db(), later.refresh_from_db(), orphan.refresh_from_db()
        self.assertIsNone(due.snoozed_until)
        self.assertIsNotNone(later.snoozed_until)
        self.assertIsNone(orphan.snoozed_until)
        self.assertEqual(orphan.assignee, self.nana)  # nobody owned it: round-robin took it
        self.assertTrue(Notification.objects.filter(staff=self.esi, title="A snoozed conversation woke up").exists())
        self.assertEqual(services.wake_due_snoozes(), 0)
        self.assertTrue(due.messages.filter(kind="event", body__contains="Snooze ended").exists())

    def test_the_beat_task_is_registered_and_runs(self):
        from messaging import tasks

        self.assertEqual(tasks.wake_snoozed(), 0)

    def test_a_customer_reply_wakes_a_snoozed_thread_early(self):
        conversation = self.thread(assignee=self.esi, snoozed_until=timezone.now() + datetime.timedelta(hours=5), snoozed_by=self.esi)
        self.as_customer()
        response = self.client.post(f"/api/messaging/conversations/{conversation.pk}/messages/", {"body": "Any news?"}, format="json")
        self.assertEqual(response.status_code, 201)
        conversation.refresh_from_db()
        self.assertIsNone(conversation.snoozed_until)
        self.assertTrue(Notification.objects.filter(staff=self.esi, title="New reply in a conversation").exists())

    def test_resolve_needs_a_known_code_and_closes_the_thread(self):
        conversation = self.thread(assignee=self.esi)
        self.as_staff(self.esi)
        self.assertEqual(self.post(f"{conversation.pk}/resolve/", {"code": "nope"}).status_code, 400)
        self.assertEqual(self.post(f"{conversation.pk}/resolve/").status_code, 400)
        response = self.post(f"{conversation.pk}/resolve/", {"code": "item_sent", "note": "Sent by courier"})
        self.assertEqual(response.status_code, 200)
        conversation.refresh_from_db()
        self.assertEqual((conversation.status, conversation.resolved_by, conversation.resolution_code), ("closed", self.esi, "item_sent"))
        self.assertEqual(self.post(f"{conversation.pk}/resolve/", {"code": "other"}).status_code, 409)
        self.assertEqual([r["id"] for r in self.client.get(BASE, {"scope": "resolved"}).json()["results"]], [conversation.pk])
        for code in ("answered", "item_sent", "return_booked", "refund_accounting", "duplicate", "other"):
            other = self.thread()
            self.assertEqual(self.post(f"{other.pk}/resolve/", {"code": code}).status_code, 200, code)

    def test_reopen(self):
        conversation = self.thread(assignee=self.esi)
        self.as_staff(self.esi)
        self.assertEqual(self.post(f"{conversation.pk}/reopen/").status_code, 409)
        self.post(f"{conversation.pk}/resolve/", {"code": "answered"})
        response = self.post(f"{conversation.pk}/reopen/")
        self.assertEqual(response.json()["status"], "open")
        self.assertIsNone(response.json()["resolved_at"])

    def test_a_reply_within_seven_days_reopens_and_goes_back_to_the_resolver(self):
        conversation = self.thread(
            assignee=self.nana, status="closed", resolved_at=timezone.now() - datetime.timedelta(days=6), resolved_by=self.esi,
            resolution_code="answered",
        )
        self.as_customer()
        response = self.client.post(f"/api/messaging/conversations/{conversation.pk}/messages/", {"body": "Still broken"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["conversation"], conversation.pk)
        conversation.refresh_from_db()
        self.assertEqual((conversation.status, conversation.assignee, conversation.resolution_code), ("open", self.esi, ""))
        self.assertTrue(conversation.messages.filter(kind="event", body__contains="Reopened").exists())
        self.assertIsNone(conversation.resolved_at)

    def test_a_reply_after_seven_days_starts_a_new_linked_conversation(self):
        self.sign_in(self.esi)
        conversation = self.thread(
            status="closed", resolved_at=timezone.now() - datetime.timedelta(days=8), resolved_by=self.nana,
            subject="Late order", about_order=None,
        )
        self.as_customer()
        response = self.client.post(f"/api/messaging/conversations/{conversation.pk}/messages/", {"body": "It broke again"}, format="json")
        self.assertEqual(response.status_code, 201)
        new_id = response.json()["conversation"]
        self.assertNotEqual(new_id, conversation.pk)
        follow_up = Conversation.objects.get(pk=new_id)
        self.assertEqual((follow_up.previous_conversation, follow_up.customer, follow_up.status, follow_up.subject), (conversation, self.customer, "open", "Late order"))
        self.assertEqual(follow_up.assignee, self.esi)
        conversation.refresh_from_db()
        self.assertEqual(conversation.status, "closed")
        self.assertEqual(conversation.messages.filter(body="It broke again").count(), 0)

    def test_a_closed_thread_never_resolved_through_the_desk_also_links_instead_of_reopening(self):
        conversation = self.thread(status="closed")
        self.as_customer()
        response = self.client.post(f"/api/messaging/conversations/{conversation.pk}/messages/", {"body": "Hi again"}, format="json")
        self.assertNotEqual(response.json()["conversation"], conversation.pk)


class EscalationAndHandoffTests(DeskBase):
    def test_escalation_goes_to_the_assignees_manager_as_a_task_and_a_notice(self):
        conversation = self.thread(assignee=self.nana)
        self.as_staff(self.esi)
        response = self.post(f"{conversation.pk}/escalate/", {"message": "Shop is not answering"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["escalated_to"], [{"id": self.ama.pk, "name": self.ama.full_name}])
        task = Task.objects.get(kind=Task.ESCALATION_FOLLOW_UP)
        self.assertEqual((task.owner, task.source_type, task.source_id), (self.ama, "messaging.conversation", str(conversation.pk)))
        self.assertTrue(Notification.objects.filter(staff=self.ama, kind="support_escalation").exists())
        conversation.refresh_from_db()
        self.assertEqual(conversation.assignee, self.nana)  # the owner does not change
        self.assertEqual(self.post(f"{conversation.pk}/escalate/", {}).status_code, 400)

    def test_escalation_falls_back_to_the_super_admin_without_a_manager(self):
        lonely = make_staff("support", "lone@example.com")
        conversation = self.thread(assignee=lonely)
        self.as_staff(lonely)
        response = self.post(f"{conversation.pk}/escalate/", {"message": "Please look"})
        self.assertEqual([p["id"] for p in response.json()["escalated_to"]], [self.admin.pk])
        self.assertEqual(Task.objects.get(kind=Task.ESCALATION_FOLLOW_UP).owner, self.admin)

    def test_loop_in_gives_the_account_manager_a_task_and_notice_with_the_owners_question_only(self):
        conversation = self.thread(customer=None, business_owner=self.owner)
        Message.objects.filter(conversation=conversation).update(body="We paid on Saturday but it says unpaid")
        self.as_staff(self.esi)
        self.post(f"{conversation.pk}/note/", {"body": SECRET})
        response = self.post(f"{conversation.pk}/loop-in/", {"note": "She pays in the app only."})
        self.assertEqual(response.status_code, 200)
        task = Task.objects.get(kind=Task.HANDOVER)
        self.assertEqual((task.owner, task.business_owner, task.created_by), (self.kwame, self.owner, self.esi))
        self.assertIn("We paid on Saturday but it says unpaid", task.notes)
        self.assertIn("She pays in the app only.", task.notes)
        self.assertNotIn("INTERNAL", task.notes)
        notice = Notification.objects.get(staff=self.kwame, kind="support_handover")
        self.assertIn("We paid on Saturday", notice.body)
        self.assertNotIn("INTERNAL", notice.body)
        self.assertEqual(self.post(f"{conversation.pk}/loop-in/", {}).status_code, 409)
        # the scout got a task, not the thread
        self.as_staff(self.kwame)
        self.assertEqual(self.client.get(BASE + f"{conversation.pk}/").status_code, 403)

    def test_loop_in_is_for_owner_threads_with_a_working_account_manager(self):
        customer_thread = self.thread()
        self.as_staff(self.esi)
        self.assertEqual(self.post(f"{customer_thread.pk}/loop-in/", {}).json()["code"], "not_owner_thread")
        BusinessOwner.objects.filter(pk=self.owner.pk).update(account_manager=None)
        owner_thread = self.thread(customer=None, business_owner=self.owner)
        self.assertEqual(self.post(f"{owner_thread.pk}/loop-in/", {}).json()["code"], "no_account_manager")
        BusinessOwner.objects.filter(pk=self.owner.pk).update(account_manager=self.kwame)
        self.kwame.is_suspended = True
        self.kwame.save()
        self.assertEqual(self.post(f"{owner_thread.pk}/loop-in/", {}).json()["code"], "no_account_manager")

    def test_ask_accounting_tells_holders_of_the_transaction_duty_honestly(self):
        conversation = self.thread(customer=None, business_owner=self.owner)
        self.as_staff(self.esi)
        with mock.patch("messaging.desk_views.notify_staff_role", return_value=[]):
            none = self.post(f"{conversation.pk}/ask-accounting/", {})
        self.assertEqual(none.json()["notified"], 0)
        self.assertIn("Nobody holds Accounting duties", none.json()["message"])
        accountant = make_staff("accountant", "acc@example.com")
        done = self.post(f"{conversation.pk}/ask-accounting/", {"note": "Trace the 3 Oct payment"})
        self.assertEqual(done.json()["notified"] >= 1, True)
        self.assertIn("no shared Accounting queue yet", done.json()["message"])
        notice = Notification.objects.get(staff=accountant, kind="support_question")
        self.assertIn("Trace the 3 Oct payment", notice.body)


class AwayLimitsContextTests(DeskBase):
    def test_away_toggle_and_team_card(self):
        self.as_staff(self.esi)
        self.assertEqual(self.post("me/away/", {"away": True}).json()["away"], True)
        team = self.client.get(BASE + "team/").json()
        self.assertTrue(team["me"]["away"])
        esi = next(a for a in team["agents"] if a["id"] == self.esi.pk)
        self.assertTrue(esi["away"])
        self.assertFalse(esi["available"])
        self.assertEqual(self.post("me/away/", {"away": False}).json()["away"], False)
        self.assertEqual(self.post("me/away/", {"away": True, "until": (timezone.now() - datetime.timedelta(hours=1)).isoformat()}).status_code, 400)

    def test_limits_editor_validates_saves_and_is_logged(self):
        self.as_staff(self.ama)
        self.assertEqual(self.client.get(BASE + "limits/").json()["first_reply_minutes"], {"high": 15, "medium": 30, "low": 120})
        self.assertEqual(SupportSettings.objects.count(), 0)  # reading did not create the row
        body = {
            "first_reply_minutes": {"high": 10, "medium": 20, "low": 90}, "resolve_minutes": {"high": 240, "medium": 480, "low": 1440},
            "open_days": [0, 1, 2, 3, 4], "opens_at": "09:00", "closes_at": "17:30", "capacity_per_agent": 4, "round_robin": False,
        }
        response = self.client.patch(BASE + "limits/", body, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        rules = SupportSettings.load()
        self.assertEqual((rules.capacity_per_agent, rules.round_robin, rules.updated_by), (4, False, self.ama))
        self.assertEqual(rules.first_reply_minutes["high"], 10)
        event = ActivityEvent.objects.get(verb="support.limits_changed")
        self.assertEqual(event.after["capacity_per_agent"], 4)
        self.assertEqual(event.before["capacity_per_agent"], 6)
        for bad in (
            {"closes_at": "08:00"}, {"capacity_per_agent": 0}, {"open_days": []}, {"open_days": [9]},
            {"first_reply_minutes": {"high": 5}}, {"resolve_minutes": {"high": -1, "medium": 1, "low": 1}},
        ):
            self.assertEqual(self.client.patch(BASE + "limits/", bad, format="json").status_code, 400, bad)

    def test_new_limits_apply_to_new_conversations_only(self):
        existing = self.thread()
        due = Conversation.objects.get(pk=existing.pk).first_reply_due
        self.as_staff(self.ama)
        self.client.patch(BASE + "limits/", {"first_reply_minutes": {"high": 1, "medium": 1, "low": 1}}, format="json")
        self.assertEqual(Conversation.objects.get(pk=existing.pk).first_reply_due, due)

    def test_context_for_a_customer_masks_the_phone(self):
        conversation = self.thread(assignee=self.esi)
        self.as_staff(self.esi)
        context = self.client.get(BASE + f"{conversation.pk}/context/").json()
        self.assertEqual(context["party"]["kind"], "customer")
        self.assertEqual(context["party"]["phone_masked"], "024 *** 3553")
        self.assertNotIn("245553553", str(context))

    def test_context_for_a_guest_has_no_contact_data(self):
        guest = self.thread(customer=None, guest_token=GUEST)
        self.as_staff(self.esi)
        context = self.client.get(BASE + f"{guest.pk}/context/").json()
        self.assertEqual(context["party"]["kind"], "guest")
        self.assertIsNone(context["party"]["phone_masked"])
        self.assertIn("SMS is not connected", context["party"]["note"])
        self.assertNotIn(GUEST, str(context))

    def test_context_for_an_owner_thread_names_the_account_manager_and_no_payout_data(self):
        owner_thread = self.thread(customer=None, business_owner=self.owner)
        self.as_staff(self.esi)
        context = self.client.get(BASE + f"{owner_thread.pk}/context/").json()
        self.assertEqual(context["owner"]["account_manager"]["name"], self.kwame.full_name)
        self.assertEqual(context["owner"]["subscription"]["state"], "none")
        self.assertFalse(context["owner"]["looped_in"])
        text = str(context).lower()
        for banned in ("payout", "momo", "ghana_card", "'tin'"):
            self.assertNotIn(banned, text)
        self.post(f"{owner_thread.pk}/loop-in/", {})
        self.assertTrue(self.client.get(BASE + f"{owner_thread.pk}/context/").json()["owner"]["looped_in"])


class OpsSupportTeamTests(DeskBase):
    def test_support_team_shows_real_per_agent_figures(self):
        self.sign_in(self.esi)
        now = timezone.now()
        a = self.thread(assignee=self.esi)
        Conversation.objects.filter(pk=a.pk).update(first_reply_due=now - datetime.timedelta(minutes=5))
        answered = self.thread(assignee=self.esi)
        Conversation.objects.filter(pk=answered.pk).update(created_at=now - datetime.timedelta(minutes=30), first_reply_at=now - datetime.timedelta(minutes=10))
        Message.objects.create(conversation=answered, sender_type="staff", body="Hi", author=self.esi)
        self.thread(assignee=self.esi, status="closed", resolved_at=now, resolved_by=self.esi)
        self.thread()  # unassigned
        self.as_staff(self.ama)
        data = self.client.get("/api/operations/support-team/").json()
        esi = next(a for a in data["agents"] if a["name"] == "Esi")
        self.assertEqual((esi["open"], esi["awaiting_reply"], esi["past_limit"], esi["resolved_week"]), (2, 1, 1, 1))
        self.assertEqual(esi["first_reply_count"], 1)
        self.assertTrue(1190 <= esi["first_reply_avg_seconds"] <= 1210)  # 20 minutes
        self.assertTrue(esi["signed_in"])
        nana = next(a for a in data["agents"] if a["name"] == "Nana")
        self.assertEqual((nana["open"], nana["first_reply_avg_seconds"], nana["signed_in"]), (0, None, False))
        self.assertEqual((data["queue"]["unassigned"], data["queue"]["past_limit"]), (1, 1))
