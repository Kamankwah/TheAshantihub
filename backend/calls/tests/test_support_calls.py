"""Support's side of the Call log: teammates' calls, the filters, the KPI row,
the export, the "Find them" search, and the conversation/order links."""
import csv
import datetime as dt
import io

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from activity.models import ActivityEvent
from calls.models import CallLog
from messaging.models import Conversation
from orders.models import Order


def staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x", role=Role.objects.get(name=role), **extra
    )


class SupportCallTests(TestCase):
    def setUp(self):
        self.esi = staff("support", "esi@example.com")
        self.nana = staff("support", "nana@example.com")
        self.scout = staff("scout", "kwame@example.com")
        self.client = APIClient()
        self.as_(self.esi)
        self.customer = Customer.objects.create(full_name="Yaw Mensah", phone="0245000553", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Nana Chop", login_phone="0320000118", password_hash="x")
        self.order = Order.objects.create(customer=self.customer, total_amount="450.00")
        self.conversation = Conversation.objects.create(customer=self.customer)

    def as_(self, who):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who, 'staff')}")

    def make(self, who, **extra):
        data = dict(direction="out", counterpart_type="customer", counterpart_name="Afua", counterpart_phone="0201234615",
                    purpose="order_question", outcome="connected", started_at=timezone.now(), duration_seconds=120)
        data.update(extra)
        return CallLog.objects.create(staff=who, **data)

    def payload(self, **extra):
        data = {"direction": "in", "channel": "phone", "counterpart_type": "guest", "counterpart_name": "Guest",
                "counterpart_phone": "0541234377", "purpose": "account_help", "outcome": "connected", "duration_seconds": 180}
        data.update(extra)
        return data

    def test_support_sees_teammates_but_not_other_roles(self):
        mine, theirs, scouts = self.make(self.esi), self.make(self.nana), self.make(self.scout)
        ids = {c["id"] for c in self.client.get("/api/calls/").json()["results"]}
        self.assertEqual(ids, {mine.id, theirs.id})
        self.assertNotIn(scouts.id, ids)
        self.assertEqual([c["id"] for c in self.client.get("/api/calls/?scope=peers").json()["results"]], [theirs.id])
        self.assertEqual([c["id"] for c in self.client.get("/api/calls/?scope=mine").json()["results"]], [mine.id])
        self.assertEqual([c["id"] for c in self.client.get(f"/api/calls/?staff={self.nana.id}").json()["results"]], [theirs.id])

    def test_teammates_numbers_are_masked_and_a_business_number_is_never_full_for_support(self):
        peer = self.make(self.nana, counterpart_phone="0201234615")
        own_business = self.make(self.esi, counterpart_type="business_owner", counterpart_phone="0320000118")
        own = self.make(self.esi, counterpart_phone="0245000553")
        rows = {c["id"]: c["counterpart_phone"] for c in self.client.get("/api/calls/").json()["results"]}
        self.assertEqual(rows[own.id], "0245000553")
        self.assertNotEqual(rows[peer.id], "0201234615")
        self.assertTrue(rows[peer.id].endswith("615"))
        self.assertNotEqual(rows[own_business.id], "0320000118")
        self.assertTrue(rows[own_business.id].endswith("118"))

    def test_purpose_date_range_and_counterpart_filters(self):
        old = self.make(self.esi, purpose="payment", started_at=timezone.now() - dt.timedelta(days=10), counterpart_id=5)
        new = self.make(self.nana, purpose="delivery", counterpart_id=9)
        today = timezone.localdate().isoformat()
        self.assertEqual([c["id"] for c in self.client.get("/api/calls/?purpose=payment").json()["results"]], [old.id])
        self.assertEqual([c["id"] for c in self.client.get(f"/api/calls/?from={today}").json()["results"]], [new.id])
        self.assertEqual([c["id"] for c in self.client.get(f"/api/calls/?to={today}&counterpart_id=5").json()["results"]], [old.id])
        self.assertEqual(self.client.get("/api/calls/?from=yesterday").status_code, 400)
        self.assertEqual(self.client.get("/api/calls/?counterpart_id=x").status_code, 400)

    def test_kpis_cover_not_reached_and_the_average_of_measured_connected_calls(self):
        self.make(self.esi, duration_seconds=120)
        self.make(self.nana, duration_seconds=240)
        self.make(self.nana, duration_seconds=0)  # connected, no typed length: left out of the average
        self.make(self.esi, outcome="no_answer", duration_seconds=0)
        self.make(self.esi, outcome="voicemail", duration_seconds=0)
        self.make(self.esi, outcome="busy", direction="in", duration_seconds=0, follow_up_at=timezone.now() + dt.timedelta(minutes=1))
        data = self.client.get("/api/calls/?day=today").json()
        self.assertEqual(data["summary"], {"logged": 6, "connected": 3})
        self.assertEqual(data["kpis"]["not_reached"], 3)
        self.assertEqual(data["kpis"]["avg_connected_seconds"], 180)
        self.assertEqual((data["kpis"]["inbound"], data["kpis"]["outbound"]), (1, 5))
        self.assertEqual(data["kpis"]["follow_ups"], 1)
        self.assertNotIn("kpis", self.client.get("/api/calls/").json())
        none = self.client.get("/api/calls/?day=today&purpose=payment").json()
        self.assertIsNone(none["kpis"]["avg_connected_seconds"])

    def test_export_is_csv_or_xlsx_masked_audited_and_scoped(self):
        self.make(self.esi, counterpart_phone="0245000553", notes="=HYPERLINK(1)")
        self.make(self.nana, counterpart_phone="0201234615")
        self.make(self.scout)
        response = self.client.get("/api/calls/export/?format=csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        body = b"".join(response.streaming_content).decode("utf-8-sig")
        rows = list(csv.DictReader(io.StringIO(body)))
        self.assertEqual(len(rows), 2)
        numbers = {r["Logged by"]: r["Number"] for r in rows}
        self.assertEqual(numbers["Esi"], "0245000553")
        self.assertNotEqual(numbers["Nana"], "0201234615")
        self.assertIn("'=HYPERLINK(1)", body)
        self.assertEqual(ActivityEvent.objects.filter(verb="report.exported", actor_id=self.esi.pk).count(), 1)
        xlsx = self.client.get("/api/calls/export/?format=xlsx")
        self.assertEqual(xlsx.status_code, 200)
        self.assertTrue(xlsx.content.startswith(b"PK"))
        self.assertEqual(self.client.get("/api/calls/export/?format=pdf").status_code, 400)
        self.assertEqual(self.client.get("/api/calls/export/").status_code, 400)

    def test_export_needs_a_calls_permission(self):
        self.as_(staff("dispatch", "kofi@example.com"))
        self.assertEqual(self.client.get("/api/calls/export/?format=csv").status_code, 403)

    def test_find_them_searches_customers_businesses_and_orders_masked(self):
        found = self.client.get("/api/calls/counterparts/?q=yaw").json()
        self.assertEqual([c["name"] for c in found["customers"]], ["Yaw Mensah"])
        self.assertEqual(found["customers"][0]["phone_masked"], "024 *** 553")
        self.assertNotIn("0245000553", str(found))
        by_phone = self.client.get("/api/calls/counterparts/?q=118").json()
        self.assertEqual(by_phone["businesses"][0]["owner_name"], "Nana Chop")
        self.assertEqual(by_phone["businesses"][0]["phone_masked"], "032 *** 118")
        self.assertNotIn("0320000118", str(by_phone))
        by_order = self.client.get(f"/api/calls/counterparts/?q=%23{self.order.pk}").json()
        self.assertEqual(by_order["orders"][0]["id"], self.order.pk)
        self.assertEqual([c["name"] for c in by_order["customers"]], ["Yaw Mensah"])
        self.assertEqual(self.client.get("/api/calls/counterparts/?q=y").json()["customers"], [])

    def test_phone_fragments_find_nothing_but_tail_and_whole_number_do(self):
        for q in ("000118", "4500", "245000", "00055"):
            found = self.client.get(f"/api/calls/counterparts/?q={q}").json()
            self.assertEqual((found["customers"], found["businesses"]), ([], []), q)
        self.assertEqual(len(self.client.get("/api/calls/counterparts/?q=553").json()["customers"]), 1)
        self.assertEqual(len(self.client.get("/api/calls/counterparts/?q=0245000553").json()["customers"]), 1)
        self.assertTrue(ActivityEvent.objects.filter(verb="call.counterpart_phone_search", actor_id=self.esi.pk).exists())
        self.assertNotIn("0245000553", str(list(ActivityEvent.objects.filter(verb="call.counterpart_phone_search").values_list("after", flat=True))))

    def test_linking_needs_the_permission_for_that_record_and_the_label_has_no_name(self):
        self.as_(self.scout)
        for kind, pk in (("messaging.conversation", self.conversation.pk), ("orders.order", self.order.pk)):
            refused = self.client.post("/api/calls/", self.payload(related_type=kind, related_id=str(pk), purpose="other"), format="json")
            self.assertEqual(refused.status_code, 400, kind)
        self.as_(self.esi)
        ok = self.client.post("/api/calls/", self.payload(related_type="orders.order", related_id=str(self.order.pk), related_label="Yaw Mensah"), format="json")
        self.assertEqual(ok.json()["related_label"], f"Order #{self.order.pk}")

    def test_search_is_for_support_not_scouts(self):
        self.as_(self.scout)
        self.assertEqual(self.client.get("/api/calls/counterparts/?q=yaw").json()["customers"], [])

    def test_logging_a_call_with_a_customer_record_stores_no_full_number(self):
        response = self.client.post("/api/calls/", self.payload(
            counterpart_type="customer", counterpart_id=self.customer.pk, counterpart_phone="",
            related_type="orders.order", related_id=str(self.order.pk), purpose="delivery"), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        call = CallLog.objects.get(pk=response.json()["id"])
        self.assertEqual(call.counterpart_name, "Yaw Mensah")
        self.assertEqual(call.counterpart_phone, "024 *** 553")
        self.assertEqual(call.related_label, f"Order #{self.order.pk}")

    def test_a_business_owner_can_be_logged_but_is_never_stored_in_full_for_support(self):
        response = self.client.post("/api/calls/", self.payload(
            counterpart_type="business_owner", counterpart_id=self.owner.pk, counterpart_phone="", purpose="business_question"), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(CallLog.objects.get(pk=response.json()["id"]).counterpart_phone, "032 *** 118")

    def test_a_scout_cannot_use_the_customer_lookup(self):
        self.as_(self.scout)
        response = self.client.post("/api/calls/", self.payload(
            counterpart_type="customer", counterpart_id=self.customer.pk, purpose="other"), format="json")
        self.assertEqual(response.status_code, 400)

    def test_related_conversation_and_order_must_exist(self):
        ok = self.client.post("/api/calls/", self.payload(related_type="messaging.conversation", related_id=str(self.conversation.pk)), format="json")
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.json()["related_label"], f"Conversation #{self.conversation.pk}")
        for kind in ("messaging.conversation", "orders.order"):
            missing = self.client.post("/api/calls/", self.payload(related_type=kind, related_id="999999"), format="json")
            self.assertEqual(missing.status_code, 400)
            self.assertIn("related_id", missing.json())
        junk = self.client.post("/api/calls/", self.payload(related_type="orders.order", related_id="abc"), format="json")
        self.assertEqual(junk.status_code, 400)

    def test_support_purposes_have_no_promised_to_pay_outcome_requirement_in_the_server(self):
        # The outcome list is a UI filter; the purposes are the Support ones.
        labels = [row["value"] for row in self.client.get("/api/calls/purposes/").json()]
        self.assertIn("order_question", labels)
        self.assertNotIn("prospecting", labels)
