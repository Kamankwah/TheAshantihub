from datetime import date
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError

from approvals.models import ApprovalRequest
from approvals import services as approval_services
from activity.models import ActivityEvent
from targets.models import Leave, PublicHoliday, TargetLimit, TargetPlan, WorkPattern

from .base import MON, SAT, WED, TargetsBase

ME = "/api/targets/me/"
PLANS = "/api/targets/plans/"


class MyTargetsApiTests(TargetsBase):
    def test_a_scout_reads_their_own_week(self):
        self.plan_all(self.kwame, calls=10, visits=6, registrations=1, renewals=1)
        self.as_staff(self.kwame)
        response = self.client.get(ME, {"period": "week", "date": "2026-10-07"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["working_days"], 6)
        self.assertEqual([m["metric"] for m in response.data["measures"]], ["registrations", "visits", "calls", "renewals"])
        self.assertEqual(response.data["daily"][2], {"metric": "calls", "label": "Calls", "value": 10})

    def test_without_targets_nothing_is_invented(self):
        self.as_staff(self.efua)
        response = self.client.get(ME)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["has_targets"])
        self.assertTrue(all(m["target"] is None and m["done"] == 0 for m in response.data["measures"]))
        self.assertEqual(response.data["lead"]["name"], "Ama")

    def test_bad_input_is_refused(self):
        self.as_staff(self.kwame)
        self.assertEqual(self.client.get(ME, {"period": "year"}).status_code, 400)
        self.assertEqual(self.client.get(ME, {"date": "soon"}).status_code, 400)

    def test_a_lead_reads_a_team_member_but_not_another_teams_scout(self):
        self.as_staff(self.lead)
        self.assertEqual(self.client.get(ME, {"staff": self.kwame.pk}).status_code, 200)
        self.assertEqual(self.client.get(ME, {"staff": self.outsider.pk}).status_code, 403)

    def test_a_scout_cannot_read_a_colleague(self):
        self.as_staff(self.kwame)
        self.assertEqual(self.client.get(ME, {"staff": self.efua.pk}).status_code, 403)

    def test_customers_and_anonymous_are_refused(self):
        self.assertIn(self.client.get(ME).status_code, (401, 403))


class SetPlansTests(TargetsBase):
    def put(self, who, **body):
        self.as_staff(who)
        return self.client.put(PLANS, body, format="json")

    def test_operations_set_a_team_members_targets(self):
        response = self.put(self.lead, staff=self.kwame.pk, values={"calls": 10, "visits": 6})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["applied"], ["calls", "visits"])
        self.assertEqual(response.data["daily"]["calls"], 10)
        plan = TargetPlan.objects.get(staff=self.kwame, metric="calls")
        self.assertEqual((plan.set_by, plan.effective_from), (self.lead, WED))
        self.assertTrue(ActivityEvent.objects.filter(verb="targets.plan_set").exists())

    def test_it_cannot_reach_outside_the_team_or_without_the_permission(self):
        self.assertEqual(self.put(self.lead, staff=self.outsider.pk, values={"calls": 5}).status_code, 403)
        self.assertEqual(self.put(self.kwame, staff=self.kwame.pk, values={"calls": 5}).status_code, 403)
        self.assertEqual(self.put(self.admin, staff=self.outsider.pk, values={"calls": 5}).status_code, 200)

    def test_values_must_be_within_the_limits(self):
        TargetLimit.objects.create(metric="calls", min_daily=5, max_daily=30, set_by=self.admin)
        self.assertEqual(self.put(self.lead, staff=self.kwame.pk, values={"calls": 4}).status_code, 400)
        self.assertEqual(self.put(self.lead, staff=self.kwame.pk, values={"calls": 31}).status_code, 400)
        self.assertEqual(self.put(self.lead, staff=self.kwame.pk, values={"calls": 30}).status_code, 200)
        self.assertEqual(TargetPlan.objects.filter(staff=self.kwame).count(), 1)

    def test_bad_values_are_refused(self):
        for values in ({}, {"calls": -1}, {"calls": "ten"}, {"calls": 2.5}, {"mood": 3}, {"calls": True}):
            self.assertEqual(self.put(self.lead, staff=self.kwame.pk, values=values).status_code, 400, values)
        self.assertEqual(self.put(self.lead, staff=self.kwame.pk, values={"calls": 5}, effective_from="2026-10-01").status_code, 400)

    def test_lowering_this_months_total_after_the_first_needs_super_admin(self):
        self.plan(self.kwame, "calls", 10)
        response = self.put(self.lead, staff=self.kwame.pk, values={"calls": 5, "visits": 4})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["applied"], ["visits"])  # the raise applies at once
        self.assertEqual(response.data["pending_approval"]["metrics"], ["calls"])
        self.assertEqual(TargetPlan.objects.filter(staff=self.kwame, metric="calls").count(), 1)  # not lowered yet
        approval = ApprovalRequest.objects.get(pk=response.data["pending_approval"]["id"])
        self.assertEqual((approval.kind, approval.stage, approval.status), ("targets.cut", "super_admin", "pending"))
        self.assertEqual(approval.payload["values"], {"calls": 5})

    def test_a_cut_only_request_answers_202(self):
        self.plan(self.kwame, "calls", 10)
        self.assertEqual(self.put(self.lead, staff=self.kwame.pk, values={"calls": 5}).status_code, 202)

    def test_a_super_admin_approving_the_cut_applies_it(self):
        self.plan(self.kwame, "calls", 10)
        pending = self.put(self.lead, staff=self.kwame.pk, values={"calls": 5}).data["pending_approval"]
        approval_services.approve(pending["id"], self.admin)
        latest = TargetPlan.objects.filter(staff=self.kwame, metric="calls").order_by("-id").first()
        self.assertEqual((latest.daily_value, latest.set_by), (5, self.lead))  # the maker's change, decided by Super Admin

    def test_a_cut_goes_stale_if_the_target_changed_meanwhile(self):
        self.plan(self.kwame, "calls", 10)
        pending = self.put(self.lead, staff=self.kwame.pk, values={"calls": 5}).data["pending_approval"]
        self.plan(self.kwame, "calls", 12)
        with self.assertRaises(approval_services.StaleRequest):
            approval_services.approve(pending["id"], self.admin)

    def test_a_cut_on_the_first_of_the_month_is_just_a_change(self):
        self.plan(self.kwame, "calls", 10, effective_from=date(2026, 9, 1))
        with mock.patch("django.utils.timezone.localdate", return_value=date(2026, 10, 1)):
            response = self.put(self.lead, staff=self.kwame.pk, values={"calls": 5})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["pending_approval"])

    def test_a_cut_from_next_month_is_not_a_current_month_cut(self):
        self.plan(self.kwame, "calls", 10)
        response = self.put(self.lead, staff=self.kwame.pk, values={"calls": 5}, effective_from="2026-11-01")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["pending_approval"])

    def test_a_raise_or_a_first_target_is_never_a_cut(self):
        self.assertEqual(self.put(self.lead, staff=self.kwame.pk, values={"calls": 5}).data["pending_approval"], None)
        self.assertEqual(self.put(self.lead, staff=self.kwame.pk, values={"calls": 8}).data["pending_approval"], None)

    def test_a_super_admins_own_cut_applies_at_once(self):
        self.plan(self.kwame, "calls", 10)
        response = self.put(self.admin, staff=self.kwame.pk, values={"calls": 5})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["applied"], ["calls"])
        self.assertEqual(response.data["daily"]["calls"], 5)

    def test_listing_the_team(self):
        self.plan(self.kwame, "calls", 10)
        self.as_staff(self.lead)
        response = self.client.get(PLANS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([s["full_name"] for s in response.data["staff"]], ["Efua", "Kwame"])
        self.assertEqual(response.data["staff"][1]["daily"]["calls"], 10)
        self.assertIsNone(response.data["staff"][0]["daily"]["calls"])


class LimitsTests(TargetsBase):
    def test_only_super_admin_sets_limits_and_operations_can_read_them(self):
        body = {"limits": [{"metric": "calls", "min_daily": 5, "max_daily": 30}]}
        self.as_staff(self.lead)
        self.assertEqual(self.client.put("/api/targets/limits/", body, format="json").status_code, 403)
        self.as_staff(self.admin)
        self.assertEqual(self.client.put("/api/targets/limits/", body, format="json").status_code, 200)
        self.as_staff(self.lead)
        self.assertEqual(self.client.get("/api/targets/limits/").data, [{"metric": "calls", "min_daily": 5, "max_daily": 30}])
        self.as_staff(self.kwame)
        self.assertEqual(self.client.get("/api/targets/limits/").status_code, 403)

    def test_a_backwards_range_is_refused(self):
        self.as_staff(self.admin)
        body = {"limits": [{"metric": "calls", "min_daily": 30, "max_daily": 5}]}
        self.assertEqual(self.client.put("/api/targets/limits/", body, format="json").status_code, 400)


class HolidayTests(TargetsBase):
    def test_super_admin_keeps_the_calendar_and_everyone_can_read_it(self):
        self.as_staff(self.admin)
        created = self.client.post("/api/targets/holidays/", {"date": "2026-12-25", "name": "Christmas Day"}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(self.client.post("/api/targets/holidays/", {"date": "2026-12-25", "name": "Again"}, format="json").status_code, 409)
        self.as_staff(self.kwame)
        self.assertEqual([h["name"] for h in self.client.get("/api/targets/holidays/", {"year": 2026}).data], ["Christmas Day"])
        self.assertEqual(self.client.post("/api/targets/holidays/", {"date": "2026-12-26", "name": "Boxing Day"}, format="json").status_code, 403)
        self.as_staff(self.admin)
        self.assertEqual(self.client.delete(f"/api/targets/holidays/{created.data['id']}/").status_code, 204)
        self.assertFalse(PublicHoliday.objects.exists())

    def test_a_holiday_zeroes_that_days_target(self):
        self.plan(self.kwame, "calls", 10)
        self.as_staff(self.admin)
        self.client.post("/api/targets/holidays/", {"date": "2026-10-09", "name": "Observed"}, format="json")
        self.as_staff(self.kwame)
        week = self.client.get(ME_URL, {"period": "week", "date": "2026-10-07"}).data
        self.assertEqual(next(m for m in week["measures"] if m["metric"] == "calls")["target"], 50)


ME_URL = "/api/targets/me/"


class LeaveTests(TargetsBase):
    def test_operations_record_leave_for_their_own_team_only(self):
        body = {"staff": self.kwame.pk, "start": "2026-10-10", "end": "2026-10-10", "kind": "sick", "note": "Clinic"}
        self.as_staff(self.lead)
        created = self.client.post("/api/targets/leave/", body, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.data["recorded_by"], "Ama")
        self.assertEqual(self.client.post("/api/targets/leave/", {**body, "staff": self.outsider.pk}, format="json").status_code, 403)
        self.assertEqual(len(self.client.get("/api/targets/leave/").data), 1)
        self.as_staff(self.kwame)
        self.assertEqual(self.client.post("/api/targets/leave/", body, format="json").status_code, 403)

    def test_dates_must_make_sense(self):
        self.as_staff(self.lead)
        base = {"staff": self.kwame.pk, "start": "2026-10-10", "end": "2026-10-09"}
        self.assertEqual(self.client.post("/api/targets/leave/", base, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/targets/leave/", {**base, "end": "2026-10-10", "kind": "holiday"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/targets/leave/", {"staff": self.kwame.pk}, format="json").status_code, 400)

    def test_leave_shows_on_the_scouts_screen_with_who_recorded_it(self):
        self.plan(self.kwame, "calls", 10)
        Leave.objects.create(staff=self.kwame, start=SAT, end=SAT, recorded_by=self.lead)
        self.as_staff(self.kwame)
        week = self.client.get(ME_URL, {"period": "week", "date": "2026-10-07"}).data
        self.assertEqual(week["leave"][0]["recorded_by"], "Ama")
        self.assertEqual(week["leave_days"], 1)

    def test_removing_leave_is_scoped_too(self):
        leave = Leave.objects.create(staff=self.outsider, start=SAT, end=SAT, recorded_by=self.other_lead)
        self.as_staff(self.lead)
        self.assertEqual(self.client.delete(f"/api/targets/leave/{leave.pk}/").status_code, 403)
        self.as_staff(self.other_lead)
        self.assertEqual(self.client.delete(f"/api/targets/leave/{leave.pk}/").status_code, 204)


class WorkPatternTests(TargetsBase):
    def test_operations_set_a_pattern_for_their_team(self):
        self.as_staff(self.lead)
        self.assertEqual(self.client.get(f"/api/targets/work-pattern/{self.kwame.pk}/").data["weekdays"], [0, 1, 2, 3, 4, 5])
        response = self.client.put(f"/api/targets/work-pattern/{self.kwame.pk}/", {"weekdays": [0, 1, 2, 3, 4]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(WorkPattern.objects.get(staff=self.kwame).weekdays, [0, 1, 2, 3, 4])
        self.assertEqual(self.client.put(f"/api/targets/work-pattern/{self.outsider.pk}/", {"weekdays": [0]}, format="json").status_code, 403)

    def test_bad_patterns_are_refused(self):
        self.as_staff(self.lead)
        for days in ([], [7], [1, 1], ["Mon"], "all"):
            self.assertEqual(self.client.put(f"/api/targets/work-pattern/{self.kwame.pk}/", {"weekdays": days}, format="json").status_code, 400, days)


class SetScoutTargetsCommandTests(TargetsBase):
    def run_command(self, *args):
        call_command("set_scout_targets", *args, stdout=mock.MagicMock())

    def test_the_operator_types_every_value(self):
        self.run_command("--staff", "kwame@example.com", "--calls", "10", "--visits", "6", "--set-by", "ama@example.com", "--yes")
        self.assertEqual(sorted(TargetPlan.objects.filter(staff=self.kwame).values_list("metric", "daily_value")), [("calls", 10), ("visits", 6)])
        self.assertFalse(TargetPlan.objects.filter(staff=self.efua).exists())

    def test_all_scouts_and_a_dry_run(self):
        self.run_command("--all-scouts", "--calls", "10", "--set-by", "ama@example.com", "--dry-run")
        self.assertFalse(TargetPlan.objects.exists())
        self.run_command("--all-scouts", "--calls", "10", "--set-by", "ama@example.com", "--yes")
        self.assertEqual(TargetPlan.objects.count(), 3)

    def test_without_yes_it_only_prints_the_plan(self):
        self.run_command("--staff", "kwame@example.com", "--calls", "10", "--set-by", "ama@example.com")
        self.assertFalse(TargetPlan.objects.exists())

    def test_a_past_start_is_refused_unless_allowed(self):
        args = ("--staff", "kwame@example.com", "--calls", "10", "--set-by", "ama@example.com", "--yes", "--effective-from", "2026-10-01")
        with self.assertRaises(CommandError):
            self.run_command(*args)
        self.assertFalse(TargetPlan.objects.exists())
        self.run_command(*args, "--allow-past")
        self.assertEqual(TargetPlan.objects.filter(staff=self.kwame).count(), 1)

    def test_nothing_is_defaulted_and_limits_still_apply(self):
        with self.assertRaises(CommandError):
            self.run_command("--staff", "kwame@example.com", "--set-by", "ama@example.com", "--yes")
        with self.assertRaises(CommandError):
            self.run_command("--calls", "10", "--set-by", "ama@example.com", "--yes")
        TargetLimit.objects.create(metric="calls", min_daily=5, max_daily=30, set_by=self.admin)
        with self.assertRaises(CommandError):
            self.run_command("--staff", "kwame@example.com", "--calls", "99", "--set-by", "ama@example.com", "--yes")
        with self.assertRaises(CommandError):
            self.run_command("--staff", "nobody@example.com", "--calls", "10", "--set-by", "ama@example.com", "--yes")
        self.assertFalse(TargetPlan.objects.exists())


class BadIdTests(TargetsBase):
    def test_a_non_numeric_staff_id_is_a_400_not_a_500(self):
        self.as_staff(self.lead)
        refused = {"detail": "Choose a staff member."}
        for method, url, body in (
            ("get", "/api/targets/me/?staff=abc", None),
            ("get", "/api/targets/leave/?staff=abc", None),
            ("get", "/api/targets/work-pattern/abc/", None),
            ("put", "/api/targets/work-pattern/abc/", {"weekdays": [1]}),
            ("post", "/api/targets/leave/", {"staff": "abc", "start": "2026-10-08", "end": "2026-10-08"}),
        ):
            resp = getattr(self.client, method)(url, *([body] if body else []), **({"format": "json"} if body else {}))
            self.assertEqual(resp.status_code, 400, url)
            self.assertEqual(resp.json(), refused, url)
