"""Screen 17: the Support agent's report numbers come from stamps and real rows."""
import datetime as dt

from django.test import TestCase
from django.utils import timezone

from accounts.models import Customer, Role, StaffUser
from calls.models import CallLog
from contact.models import ContactMessage
from messaging.models import Conversation, Message
from reports import providers, services


def rows(sections, key):
    return {r["label"]: r["value"] for r in next(s for s in sections if s["key"] == key)["rows"]}


class SupportReportProviderTests(TestCase):
    def setUp(self):
        self.esi = StaffUser.objects.create(full_name="Esi", email="esi-r@example.com", password_hash="x", role=Role.objects.get(name="support"))
        self.nana = StaffUser.objects.create(full_name="Nana", email="nana-r@example.com", password_hash="x", role=Role.objects.get(name="support"))
        self.customer = Customer.objects.create(full_name="Ama", phone="0200000001", password_hash="x")
        self.today = timezone.localdate()

    def thread(self, reply_by, minutes=10, **extra):
        start = timezone.now() - dt.timedelta(minutes=minutes + 5)
        conversation = Conversation.objects.create(customer=self.customer, **extra)
        Conversation.objects.filter(pk=conversation.pk).update(created_at=start)
        Message.objects.create(conversation=conversation, sender_type=Message.CUSTOMER, body="hi")
        Message.objects.create(conversation=conversation, sender_type=Message.STAFF, body="hello", author=reply_by)
        Conversation.objects.filter(pk=conversation.pk).update(first_reply_at=start + dt.timedelta(minutes=minutes))
        return Conversation.objects.get(pk=conversation.pk)

    def test_provider_is_registered_for_support_only(self):
        keys = [s["key"] for s in providers.system_sections(self.esi, self.today, self.today)]
        self.assertIn("support_calls_outcome", keys)
        scout = StaffUser.objects.create(full_name="K", email="k-r@example.com", password_hash="x", role=Role.objects.get(name="scout"))
        self.assertNotIn("support_desk", [s["key"] for s in providers.system_sections(scout, self.today, self.today)])

    def test_nothing_recorded_reads_zero_and_no_average_is_invented(self):
        sections = providers.system_sections(self.esi, self.today, self.today)
        desk = rows(sections, "support_desk")
        self.assertEqual(desk["Conversations handled"], 0)
        self.assertNotIn("First reply, average (clock time)", desk)

    def test_first_reply_handled_resolved_and_past_limit(self):
        self.thread(self.esi, minutes=10)
        self.thread(self.esi, minutes=20)
        self.thread(self.nana, minutes=5)
        done = self.thread(self.esi, minutes=1)
        Conversation.objects.filter(pk=done.pk).update(resolved_by=self.esi, resolved_at=timezone.now(), status="closed")
        late = self.thread(self.esi, minutes=1, assignee=self.esi)
        Conversation.objects.filter(pk=late.pk).update(resolve_due=timezone.now() - dt.timedelta(minutes=3))
        desk = rows(providers.system_sections(self.esi, self.today, self.today), "support_desk")
        self.assertEqual(desk["Conversations handled"], 4)
        self.assertEqual(desk["Resolved"], 1)
        self.assertEqual(desk["Yours past the time limit now"], 1)
        self.assertEqual(desk["Conversations answered first"], 4)
        self.assertEqual(desk["First reply, average (clock time)"], "8 min")

    def test_calls_by_outcome_exclude_promised_to_pay_and_other_agents(self):
        for outcome, who in (("connected", self.esi), ("connected", self.esi), ("no_answer", self.esi), ("busy", self.nana)):
            CallLog.objects.create(staff=who, direction="out", counterpart_type="guest", purpose="other", outcome=outcome, started_at=timezone.now())
        calls = rows(providers.system_sections(self.esi, self.today, self.today), "support_calls_outcome")
        self.assertEqual((calls["Connected"], calls["No answer"], calls["Busy"]), (2, 1, 0))
        self.assertNotIn("Promised to pay", calls)

    def test_queue_numbers_from_stamps(self):
        ContactMessage.objects.create(category="general", name="X", email="x@example.com", subject="s", message="m",
                                      status="resolved", resolved_by=self.esi, resolved_at=timezone.now())
        queue = rows(providers.system_sections(self.esi, self.today, self.today), "support_queues")
        self.assertEqual(queue["Contact messages cleared"], 1)
        self.assertEqual(queue["Reviews published"], 0)

    def test_linked_records_accept_conversation_order_call_and_dispute(self):
        links = [{"type": t, "id": "1", "label": t} for t in ("conversation", "order", "call", "dispute")]
        report = services.save_draft(self.esi, "day", self.today, {"linked_targets": links})
        self.assertEqual([row["type"] for row in report.linked_targets], ["conversation", "order", "call", "dispute"])
