from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from commission.models import CommissionAccrual, CommissionPolicy
from contact.models import ContactMessage
from disputes.models import Dispute
from fraud.models import FraudFlag
from messaging.models import Conversation, Message
from orders.models import DeliveryAssignment, Order
from portfolio.tests.health_fixtures import add_listings, add_order, make_business


class ServiceIssuesBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.other_lead = make_staff("operations", "kojo@example.com")
        self.support = make_staff("support", "esi@example.com", manager=self.lead)
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.kwaku = make_staff("scout", "kwaku@example.com", manager=self.other_lead)
        self.mine = make_business("Adwoa Fabrics", manager=self.kwame, email="adwoa@example.com")
        self.theirs = make_business("Suame Auto Parts", manager=self.kwaku, email="suame@example.com")
        add_listings(self.mine, 1, status="published")
        add_listings(self.theirs, 1, status="published")

    def get(self, who, url, **params):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who)}")
        return self.client.get(url, params)


class ServiceIssuesTests(ServiceIssuesBase):
    URL = "/api/operations/service-issues/"

    def test_needs_the_read_permission_which_support_does_not_hold(self):
        self.assertEqual(self.get(self.support, self.URL).status_code, 403)
        self.assertEqual(self.get(self.kwame, self.URL).status_code, 403)
        self.assertEqual(self.get(self.lead, self.URL).status_code, 200)

    def test_contact_message_is_matched_by_email_or_phone_and_scoped_to_the_team(self):
        ContactMessage.objects.create(category="support", name="Adwoa", email="ADWOA@example.com", subject="Renew fails", message="payment failed")
        ContactMessage.objects.create(category="support", name="Phone", email="x@example.com", phone=self.mine.login_phone[-9:], subject="By phone", message="hi")
        ContactMessage.objects.create(category="support", name="Other", email="suame@example.com", subject="Not mine", message="hi")
        ContactMessage.objects.create(category="general", name="Nobody", email="nobody@example.com", subject="Unmatched", message="hi")
        rows = self.get(self.lead, self.URL).data["issues"]
        self.assertEqual(sorted(r["what"].split(" · ")[0] for r in rows), ["By phone", "Renew fails"])
        self.assertTrue(all(r["business"] == "Adwoa Fabrics" and r["account_manager"] == "Kwame" for r in rows))
        self.assertEqual({r["handled_by"] for r in rows}, {"Not picked up yet"})

    def test_dispute_on_an_order_with_the_teams_business_only(self):
        order = add_order(self.mine, days_ago=2)
        elsewhere = add_order(self.theirs, days_ago=2)
        Dispute.objects.create(order=order, raised_by=order.customer, reason="quality_issue", description="Wrong item")
        Dispute.objects.create(order=elsewhere, raised_by=elsewhere.customer, reason="quality_issue", description="Other team")
        data = self.get(self.lead, self.URL).data
        self.assertEqual([r["type"] for r in data["issues"]], ["dispute"])
        self.assertIn(f"Order #{order.pk}", data["issues"][0]["what"])
        self.assertEqual(data["counts"], {"contact": 0, "dispute": 1, "chat": 0})

    def test_owner_conversation_is_listed_and_closed_ones_are_resolved(self):
        chat = Conversation.objects.create(business_owner=self.mine, subject="we paid on Saturday")
        Message.objects.create(conversation=chat, sender_type="business_owner", body="We paid the subscription on Saturday")
        done = Conversation.objects.create(business_owner=self.mine, subject="old", status=Conversation.CLOSED)
        Conversation.objects.create(customer=Customer.objects.create(full_name="C", phone="+233200000001", password_hash="x"), subject="Re: Adwoa Fabrics")
        opened = self.get(self.lead, self.URL).data
        self.assertEqual([r["key"] for r in opened["issues"]], [f"chat-{chat.pk}"])
        self.assertEqual(opened["issues"][0]["detail"], "We paid the subscription on Saturday")
        self.assertEqual(opened["issues"][0]["handled_by"], "Support")
        self.assertEqual(opened["resolved_this_week"], 1)
        resolved = self.get(self.lead, self.URL, status="resolved").data["issues"]
        self.assertEqual([r["key"] for r in resolved], [f"chat-{done.pk}"])

    def test_filters_by_type_and_account_manager(self):
        Conversation.objects.create(business_owner=self.mine, subject="x")
        ContactMessage.objects.create(category="support", name="A", email="adwoa@example.com", subject="s", message="m")
        self.assertEqual(len(self.get(self.lead, self.URL, type="chat").data["issues"]), 1)
        self.assertEqual(len(self.get(self.lead, self.URL, manager=self.kwame.pk).data["issues"]), 2)
        self.assertEqual(len(self.get(self.lead, self.URL, manager=self.kwaku.pk).data["issues"]), 0)

    def test_super_admin_sees_every_team(self):
        admin = make_staff("super_admin", "simon@example.com")
        Conversation.objects.create(business_owner=self.mine, subject="x")
        Conversation.objects.create(business_owner=self.theirs, subject="y")
        self.assertEqual(len(self.get(admin, self.URL).data["issues"]), 2)

    def test_read_only(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.lead)}")
        self.assertEqual(self.client.post(self.URL, {}).status_code, 405)
        # No reply route is opened to Operations.
        chat = Conversation.objects.create(business_owner=self.mine, subject="x")
        reply = self.client.post(f"/api/messaging/staff/{chat.pk}/reply/", {"body": "hi"})
        self.assertIn(reply.status_code, (403, 404))


class BadgesAndOverviewTests(ServiceIssuesBase):
    def test_badges_count_open_issues_and_open_disputes(self):
        Conversation.objects.create(business_owner=self.mine, subject="x")
        order = add_order(self.theirs, days_ago=1)
        Dispute.objects.create(order=order, raised_by=order.customer, reason="delivery_issue", description="late")
        data = self.get(self.lead, "/api/notifications/staff-badges/").data
        self.assertEqual(data["support_issues"], 1)  # the dispute is another team's
        self.assertEqual(data["deliveries_open"], 1)  # but every business's disputes are on screen 17
        self.assertEqual(self.get(self.support, "/api/notifications/staff-badges/").data["support_issues"], 0)

    def test_overview_counts_and_lists_service_issues(self):
        Conversation.objects.create(business_owner=self.mine, subject="owner chat")
        FraudFlag.objects.create(kind="duplicate", source="staff", title="Dup", business_owner=self.mine)
        data = self.get(self.lead, "/api/operations/overview/").data
        self.assertEqual(data["kpis"]["issues"], {"total": 2, "fraud": 1, "support": 1, "delivery": 0})
        self.assertEqual({i["type"] for i in data["issues"]}, {"fraud", "chat"})


class DeliveriesTests(ServiceIssuesBase):
    URL = "/api/operations/deliveries/"

    def test_lists_todays_assignments_and_open_disputes_for_every_business(self):
        dispatch = make_staff("dispatch", "rider@example.com")
        order = add_order(self.theirs, days_ago=0)
        order.delivery_address = "Bantama, Kumasi"
        order.save()
        DeliveryAssignment.objects.create(order=order, dispatch=dispatch, status="picked_up", picked_up_at=timezone.now())
        old = add_order(self.mine, days_ago=3)
        DeliveryAssignment.objects.create(order=old, dispatch=dispatch, status="confirmed")
        Dispute.objects.create(order=old, raised_by=old.customer, reason="delivery_issue", description="never came")
        Dispute.objects.create(order=old, raised_by=old.customer, reason="other", description="done", status="resolved")
        data = self.get(self.lead, self.URL).data
        self.assertEqual(len(data["assignments"]), 2)  # the old one was assigned today in the test clock
        row = next(r for r in data["assignments"] if r["order_id"] == order.pk)
        self.assertEqual((row["rider"], row["status"], row["to"], row["last_update_label"]), ("Rider", "picked_up", "Bantama, Kumasi", "Picked up"))
        self.assertEqual(row["businesses"], [{"id": self.theirs.pk, "name": "Suame Auto Parts"}])
        self.assertEqual([d["description"] for d in data["disputes"]], ["never came"])
        self.assertEqual(data["dispute_total"], 1)

    def test_needs_the_read_permission(self):
        self.assertEqual(self.get(self.support, self.URL).status_code, 403)

    def test_operations_can_update_a_delivery_status_with_the_existing_permission(self):
        order = add_order(self.mine, days_ago=0)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.lead)}")
        response = self.client.patch(f"/api/orders/{order.pk}/delivery-status/", {"delivery_status": "shipped"}, format="json")
        self.assertEqual(response.status_code, 200)


class SupportTeamTests(ServiceIssuesBase):
    URL = "/api/operations/support-team/"

    def test_agents_are_the_leads_real_reports_and_the_queue_is_counted(self):
        make_staff("support", "nana@example.com", manager=self.other_lead)
        waiting = Conversation.objects.create(customer=Customer.objects.create(full_name="C", phone="+233200000002", password_hash="x"), subject="Re: x")
        Message.objects.create(conversation=waiting, sender_type="customer", body="hello")
        answered = Conversation.objects.create(guest_token="g" * 20)
        Message.objects.create(conversation=answered, sender_type="guest", body="hi")
        Message.objects.create(conversation=answered, sender_type="staff", body="hello")
        Conversation.objects.create(business_owner=self.mine, status="closed")
        data = self.get(self.lead, self.URL).data
        self.assertEqual([a["name"] for a in data["agents"]], ["Esi"])
        self.assertEqual(data["agents"][0]["calls_today"], 0)
        queue = data["queue"]
        self.assertEqual((queue["open"], queue["awaiting_reply"], queue["closed_total"]), (2, 1, 1))
        self.assertEqual(queue["by_starter"], {"customers": 1, "business_owners": 0, "guests": 1})
        self.assertEqual(self.get(self.support, self.URL).status_code, 403)


class ContactMessageStaffTests(ServiceIssuesBase):
    URL = "/api/core/contact-messages/"

    def test_list_carries_the_matched_business_and_filters(self):
        ContactMessage.objects.create(category="support", name="A", email="adwoa@example.com", subject="s1", message="m")
        ContactMessage.objects.create(category="sales", name="B", email="b@example.com", subject="s2", message="m", status="resolved")
        rows = self.get(self.lead, self.URL).data["results"]
        matched = next(r for r in rows if r["subject"] == "s1")
        self.assertEqual(matched["match"]["business"], "Adwoa Fabrics")
        self.assertEqual(matched["match"]["account_manager"], "Kwame")
        self.assertIsNone(next(r for r in rows if r["subject"] == "s2")["match"])
        self.assertEqual([r["subject"] for r in self.get(self.lead, self.URL, status="open").data["results"]], ["s1"])
        self.assertEqual([r["subject"] for r in self.get(self.lead, self.URL, category="sales").data["results"]], ["s2"])


class FraudConsequenceTests(ServiceIssuesBase):
    def test_open_duplicate_case_previews_the_commission_it_would_reverse(self):
        now = timezone.now()
        policy = CommissionPolicy.objects.create(
            kind="registration", amount="50.00", effective_from=now.date(), proposed_by=self.lead, approved_by=self.lead,
        )
        CommissionAccrual.objects.create(
            staff=self.kwame, business_owner=self.mine, kind=policy.kind, amount="50.00", policy=policy,
            earned_at=now, hold_until=now + timedelta(days=30),
        )
        flag = FraudFlag.objects.create(kind="duplicate", source="staff", title="Dup", business_owner=self.mine)
        other = FraudFlag.objects.create(kind="other", source="staff", title="Other", business_owner=self.mine)
        rows = {r["id"]: r for r in self.get(self.lead, "/api/fraud/flags/").data["results"]}
        self.assertEqual(rows[flag.pk]["commission_reversal"]["amount"], "50.00")
        self.assertEqual(rows[flag.pk]["commission_reversal"]["staff"], ["Kwame"])
        self.assertIsNone(rows[other.pk]["commission_reversal"])
