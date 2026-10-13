from datetime import timedelta

from django.utils import timezone

from accounts.testing import make_staff
from approvals.models import ApprovalRequest
from delivery import config, report_provider
from delivery.models import CashHandover, Rider, Shift
from disputes.models import Dispute
from fraud.models import FraudFlag
from orders.models import DeliveryAssignment

from .base import DROP, DeliveryCase


class CaseTests(DeliveryCase):
    def failed_job(self):
        a = self.assign()
        self.run_to(a, "arrive-drop")
        self.step(a, "cant-deliver", {**self.at(DROP), "reason": "refused", "note": "Said no"})
        return a, Dispute.objects.get(order=a.order)

    def test_a_failed_delivery_makes_a_typed_case_with_the_rider(self):
        a, case = self.failed_job()
        self.assertEqual((case.case_type, case.rider), ("return", self.rider_staff))
        self.as_staff(self.manager)
        listing = self.client.get("/api/delivery/cases/").json()
        self.assertEqual(listing["open"], 1)
        self.assertEqual(listing["counts"]["return"], 1)
        self.assertEqual(listing["answer_limit"], "none")
        self.assertIsNone(listing["results"][0]["answer_due_at"])

    def test_evidence_is_assembled_from_the_stamps_and_has_no_codes(self):
        a, case = self.failed_job()
        self.as_staff(self.manager)
        detail = self.client.get(f"/api/delivery/cases/{case.pk}/").json()
        steps = [e["step"] for e in detail["evidence"]["timeline"]]
        self.assertIn("arrived_drop", steps)
        self.assertEqual(detail["evidence"]["failed"]["reason"], "refused")
        self.assertNotIn(a.drop_code + '"', str(detail).replace("'", '"'))
        self.assertIn("simulated", detail["payments"])

    def test_deciding_needs_sudo_a_note_and_records_a_refund_request_not_a_refund(self):
        a, case = self.failed_job()
        self.as_staff(self.manager)
        body = {"outcome": "refund", "fault": "customer", "note": "Customer refused", "refund_amount": "40"}
        self.assertEqual(self.client.post(f"/api/delivery/cases/{case.pk}/decide/", body, format="json").json()["code"], "sudo_required")
        self.as_staff(self.manager, sudo=True)
        self.assertEqual(self.client.post(f"/api/delivery/cases/{case.pk}/decide/", {**body, "note": ""}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/delivery/cases/{case.pk}/decide/", {**body, "refund_amount": "500"}, format="json").status_code, 400)
        ok = self.client.post(f"/api/delivery/cases/{case.pk}/decide/", {**body, "stop_rider_jobs": True, "send_to_operations": True}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        case.refresh_from_db()
        self.assertEqual((case.status, case.outcome, case.fault), ("resolved", "refund", "customer"))
        approval = ApprovalRequest.objects.get(pk=ok.json()["refund_approval_id"])
        self.assertEqual((approval.kind, approval.status), ("delivery.refund_request", "pending"))
        self.rider.refresh_from_db()
        self.assertTrue(self.rider.job_hold)
        self.assertTrue(FraudFlag.objects.filter(staff_subject=self.rider_staff).exists())
        again = self.client.post(f"/api/delivery/cases/{case.pk}/decide/", body, format="json")
        self.assertEqual(again.status_code, 409)

    def test_a_rider_cannot_read_cases(self):
        self.as_staff(self.rider_staff)
        self.assertEqual(self.client.get("/api/delivery/cases/").status_code, 403)


class CashTests(DeliveryCase):
    def test_no_cash_on_delivery_means_nothing_to_count(self):
        self.as_staff(self.manager)
        page = self.client.get("/api/delivery/cash/").json()
        self.assertFalse(page["cod"]["offered"])
        self.assertIn("not offered", page["cod"]["note"])
        self.assertEqual(page["over_cap"], 0)
        self.assertEqual(page["cap"]["amount"], "500.00")
        self.as_staff(self.manager, sudo=True)
        refused = self.client.post("/api/delivery/cash/", {"rider": self.rider.pk, "counted": "10"}, format="json")
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "nothing_owed"))

    def test_a_handover_counts_against_what_was_collected_and_a_shortfall_needs_a_note(self):
        a = self.assign()
        self.run_to(a, "deliver")
        DeliveryAssignment.objects.filter(pk=a.pk).update(cod_amount="230.00", cash_collected_at=timezone.now())
        self.as_staff(self.manager, sudo=True)
        page = self.client.get("/api/delivery/cash/").json()
        self.assertEqual(page["riders"][0]["holding"], "230.00") if page["riders"][0]["full_name"] == self.rider_staff.full_name else None
        short = self.client.post("/api/delivery/cash/", {"rider": self.rider.pk, "counted": "200"}, format="json")
        self.assertEqual(short.status_code, 400)
        ok = self.client.post("/api/delivery/cash/", {"rider": self.rider.pk, "counted": "200", "note": "GH₵ 30 short, change given"}, format="json")
        self.assertEqual((ok.status_code, ok.json()["difference"]), (201, "-30.00"))
        self.assertEqual(CashHandover.objects.count(), 1)
        self.as_staff(self.manager)
        self.assertEqual(self.client.get("/api/delivery/cash/").json()["shortfalls"], [CashHandover.objects.get().pk])

    def test_cash_over_the_cap_stops_new_jobs(self):
        from delivery import dispatching

        a = self.assign()
        DeliveryAssignment.objects.filter(pk=a.pk).update(cod_amount="600.00", cash_collected_at=timezone.now())
        self.assertTrue(dispatching.cod_over_cap(self.rider, {"cash_cap": "500"}))
        self.assertFalse(dispatching.cod_over_cap(self.rider, {"cash_cap": "700"}))


class ShiftTests(DeliveryCase):
    def week(self):
        today = timezone.localdate()
        return today - timedelta(days=today.weekday()) + timedelta(days=7)

    def at(self, day, hour):
        return timezone.make_aware(timezone.datetime(day.year, day.month, day.day, hour), timezone.get_current_timezone()).isoformat()

    def test_add_overlap_open_copy_and_publish(self):
        monday = self.week()
        self.as_staff(self.manager)
        made = self.client.post("/api/delivery/shifts/", {"rider": self.rider.pk, "starts_at": self.at(monday, 8), "ends_at": self.at(monday, 16)}, format="json")
        self.assertEqual(made.status_code, 201, made.content)
        self.assertEqual(made.json()["status"], "draft")
        clash = self.client.post("/api/delivery/shifts/", {"rider": self.rider.pk, "starts_at": self.at(monday, 15), "ends_at": self.at(monday, 20)}, format="json")
        self.assertEqual(clash.status_code, 409)
        open_shift = self.client.post("/api/delivery/shifts/", {"starts_at": self.at(monday, 8), "ends_at": self.at(monday, 16)}, format="json").json()
        self.assertEqual(open_shift["status"], "open")
        copied = self.client.post("/api/delivery/shifts/copy-week/", {"from": monday.isoformat(), "to": (monday + timedelta(days=7)).isoformat()}, format="json")
        self.assertEqual(copied.json()["copied"], 2)
        self.assertEqual(self.client.post("/api/delivery/shifts/copy-week/", {"from": monday.isoformat(), "to": (monday + timedelta(days=7)).isoformat()}, format="json").status_code, 409)
        pub = self.client.post("/api/delivery/shifts/publish/", {"week": monday.isoformat()}, format="json").json()
        self.assertEqual(pub, {"published": 1, "riders_told": 1})
        self.assertTrue(self.rider_staff.notifications.filter(kind="delivery_shift").exists())
        week = self.client.get(f"/api/delivery/shifts/?week={monday.isoformat()}").json()
        self.assertEqual(week["counts"], {"draft": 0, "published": 1, "open": 1, "swap": 0})

    def test_demand_is_not_invented_without_history(self):
        self.as_staff(self.manager)
        demand = self.client.get(f"/api/delivery/shifts/?week={self.week().isoformat()}").json()["demand"]
        self.assertTrue(all(d["enough_history"] is False and d["shifts_needed"] is None for d in demand))

    def test_demand_from_four_comparable_weekdays(self):
        monday = self.week()
        for weeks in range(1, 5):
            day = monday - timedelta(weeks=weeks)
            when = timezone.make_aware(timezone.datetime(day.year, day.month, day.day, 10), timezone.get_current_timezone())
            for _ in range(13):
                a = self.assign(self.make_order())
                DeliveryAssignment.objects.filter(pk=a.pk).update(assigned_at=when)
        self.as_staff(self.manager)
        first = self.client.get(f"/api/delivery/shifts/?week={monday.isoformat()}").json()["demand"][0]
        self.assertEqual((first["enough_history"], first["shifts_needed"], first["average_deliveries"]), (True, 2, 13.0))

    def test_swap_request_and_decision(self):
        monday = self.week()
        self.as_staff(self.manager)
        s = self.client.post("/api/delivery/shifts/", {"rider": self.rider.pk, "starts_at": self.at(monday, 8), "ends_at": self.at(monday, 16)}, format="json").json()
        self.client.post("/api/delivery/shifts/publish/", {"week": monday.isoformat()}, format="json")
        other = Rider.objects.get(staff=self.other_staff)
        self.as_staff(self.rider_staff)
        self.assertEqual(self.client.get("/api/delivery/rider/shifts/").json()["results"][0]["id"], s["id"])
        self.assertEqual(self.client.post(f"/api/delivery/rider/shifts/{s['id']}/swap/", {"with_rider": other.pk}, format="json").json()["status"], "swap")
        self.as_staff(self.manager)
        done = self.client.post(f"/api/delivery/shifts/{s['id']}/swap-decision/", {"approve": True}, format="json").json()
        self.assertEqual((done["status"], done["rider"]["id"]), ("published", other.pk))


class ReportTests(DeliveryCase):
    def test_manager_sections_count_real_rows_and_say_when_there_is_no_source(self):
        a = self.assign()
        self.run_to(a, "deliver")
        today = timezone.localdate()
        sections = {s["key"]: {r["label"]: r["value"] for r in s["rows"]} for s in report_provider.delivery_manager_sections(self.manager, today, today)}
        self.assertEqual(sections["deliveries"]["Delivered"], 1)
        self.assertIn("time limits not set", sections["deliveries"]["On time"])
        self.assertEqual(sections["checkins"]["Cash on delivery"], "Not offered at checkout yet")
        mine = {r["label"]: r["value"] for r in report_provider.dispatch_sections(self.rider_staff, today, today)[0]["rows"]}
        self.assertEqual(mine["Delivered"], 1)
        self.assertIn("Not available", mine["Cash handed in"])

    def test_the_providers_are_registered(self):
        from reports import providers

        self.assertIn(report_provider.delivery_manager_sections, providers._ROLE_PROVIDERS["delivery_manager"])
        self.assertIn(report_provider.dispatch_sections, providers._ROLE_PROVIDERS["dispatch"])
