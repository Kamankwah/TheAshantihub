from datetime import datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.test import override_settings
from django.utils import timezone

from accounts.models import Permission, Role
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest, ApprovalSettings
from marketing import cost, policy
from marketing.models import SendPolicy
from targets.models import PublicHoliday

from .base import MarketingBase

ACCRA = ZoneInfo("Africa/Accra")
URL = "/api/marketing/policy/"


class PermissionSeedTests(MarketingBase):
    def test_marketing_holds_the_new_permissions_and_a_scout_does_not(self):
        marketing = set(Role.objects.get(name="marketing").permissions.values_list("codename", flat=True))
        self.assertTrue({"campaigns.manage", "consent.view", "coupons.manage", "site_promo.manage"} <= marketing)
        self.assertFalse({"campaigns.manage", "consent.view"} & set(Role.objects.get(name="scout").permissions.values_list("codename", flat=True)))

    def test_super_admin_holds_every_permission(self):
        held = set(Role.objects.get(name="super_admin").permissions.values_list("codename", flat=True))
        self.assertEqual(held, set(Permission.objects.values_list("codename", flat=True)))


class CostTests(MarketingBase):
    def test_free_channels_cost_nothing_and_never_need_approval(self):
        self.assertEqual(cost.estimate("email", 5000), (Decimal("0"), True))
        self.assertFalse(cost.needs_approval("inapp", 100000, Decimal("25")))

    def test_sms_uses_the_configured_price(self):
        self.assertEqual(cost.estimate("sms", 1000), (Decimal("33.00"), True))
        self.assertFalse(cost.needs_approval("sms", 700, Decimal("25")))
        self.assertTrue(cost.needs_approval("sms", 800, Decimal("25")))

    def test_an_unknown_price_fails_closed(self):
        amount, known = cost.estimate("whatsapp", 3)
        self.assertFalse(known)
        self.assertTrue(cost.needs_approval("whatsapp", 3, Decimal("25")))
        with override_settings(MARKETING_UNIT_PRICE={"sms": ""}):
            self.assertTrue(cost.needs_approval("sms", 1, Decimal("25")))


class SendWindowTests(MarketingBase):
    def at(self, day, hh, mm=0):
        return datetime(2026, 10, day, hh, mm, tzinfo=ACCRA)

    def test_window_days_and_holidays(self):
        sp = SendPolicy.current()
        self.assertIsNone(policy.send_moment_problem(self.at(7, 10), sp))      # Wednesday
        self.assertIn("Sunday", policy.send_moment_problem(self.at(11, 10), sp))
        self.assertIn("08:00", policy.send_moment_problem(self.at(7, 7, 59), sp))
        self.assertIn("19:00", policy.send_moment_problem(self.at(7, 19), sp))
        PublicHoliday.objects.create(date=self.at(8, 10).date(), name="Test day")
        self.assertIn("holiday", policy.send_moment_problem(self.at(8, 10), sp))
        sp.quiet_public_holidays = False
        self.assertIsNone(policy.send_moment_problem(self.at(8, 10), sp))

    def test_threshold_reads_the_approval_settings(self):
        self.assertEqual(policy.approval_threshold(), Decimal("25.00"))
        ApprovalSettings.objects.update_or_create(pk=1, defaults={"campaign_threshold": Decimal("40.00")})
        self.assertEqual(policy.approval_threshold(), Decimal("40.00"))


class PolicyApiTests(MarketingBase):
    def body(self, **extra):
        return {"window_start": "09:00", "window_end": "18:00", "send_days": [0, 1, 2, 3, 4], "per_person_cap_days": 5, "quiet_public_holidays": True, **extra}

    def test_defaults_match_the_canvas(self):
        self.as_staff(self.akua)
        data = self.client.get(URL).json()
        self.assertEqual(data["policy"]["window_start"], "08:00")
        self.assertEqual(data["policy"]["window_end"], "19:00")
        self.assertEqual(data["policy"]["send_days"], [0, 1, 2, 3, 4, 5])
        self.assertEqual(data["policy"]["per_person_cap_days"], 3)
        self.assertEqual(data["threshold"], "25.00")
        self.assertTrue(data["can_propose"])
        self.assertIsNone(data["pending"])

    def test_other_roles_are_refused(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get(URL).status_code, 403)
        self.assertEqual(self.client.post(URL, self.body(), format="json").status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_a_proposal_waits_for_super_admin_and_changes_nothing_yet(self):
        self.as_staff(self.akua)
        response = self.client.post(URL, self.body(), format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], "pending")
        self.assertEqual(SendPolicy.current().per_person_cap_days, 3)
        self.assertEqual(self.client.get(URL).json()["pending"]["maker"], self.akua.full_name)
        # a second one is refused while the first waits
        self.assertEqual(self.client.post(URL, self.body(), format="json").status_code, 409)

    def test_super_admin_approving_applies_it_and_it_is_in_the_history(self):
        self.as_staff(self.akua)
        approval_id = self.client.post(URL, self.body(), format="json").json()["approval_id"]
        with self.assertRaises(approvals.MakerCannotDecide):
            approvals.approve(approval_id, self.akua)
        approvals.approve(approval_id, self.boss)
        current = SendPolicy.current()
        self.assertEqual((current.window_start, current.window_end, current.per_person_cap_days), (time(9, 0), time(18, 0), 5))
        self.assertEqual(current.send_days, [0, 1, 2, 3, 4])
        self.assertEqual(current.updated_by, self.boss)
        history = self.client.get(URL).json()["history"]
        self.assertEqual(history[0]["kind"], "applied")
        self.assertEqual(history[0]["before"]["per_person_cap_days"], 3)
        self.assertTrue(ActivityEvent.objects.filter(verb="marketing.send_policy_applied").exists())

    def test_a_super_admin_proposal_applies_at_once(self):
        self.as_staff(self.boss)
        # Super Admin holds campaigns.manage through the role.
        response = self.client.post(URL, self.body(), format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], "approved")
        self.assertEqual(SendPolicy.current().per_person_cap_days, 5)

    def test_invalid_proposals_are_refused(self):
        self.as_staff(self.akua)
        bad = [
            {"window_start": "10:00", "window_end": "09:00"}, {"window_start": "05:00"}, {"window_end": "22:00"},
            {"send_days": []}, {"send_days": [7]}, {"send_days": "mon"}, {"per_person_cap_days": 0}, {"per_person_cap_days": 31},
            {"quiet_public_holidays": "yes"}, {"window_start": "nine"},
        ]
        for extra in bad:
            with self.subTest(extra=extra):
                self.assertEqual(self.client.post(URL, self.body(**extra), format="json").status_code, 400)
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_a_rejected_proposal_shows_in_the_history(self):
        self.as_staff(self.akua)
        approval_id = self.client.post(URL, self.body(), format="json").json()["approval_id"]
        approvals.reject(approval_id, self.boss, "Keep three days.")
        history = self.client.get(URL).json()["history"]
        self.assertEqual(history[0]["kind"], "rejected")
        self.assertEqual(history[0]["note"], "Keep three days.")
        self.assertEqual(SendPolicy.current().per_person_cap_days, 3)


class OverviewApiTests(MarketingBase):
    URL = "/api/marketing/overview/"

    def test_nothing_is_invented_before_anything_exists(self):
        self.as_staff(self.akua)
        data = self.client.get(self.URL).json()
        self.assertEqual(data["days"], 7)
        self.assertEqual(data["messages"]["state"], "not_tracked")
        self.assertEqual(data["opt_ins"]["state"], "not_tracked")
        self.assertEqual(data["promotions"]["amount"], "0.00")
        self.assertEqual({c["key"]: c["status"] for c in data["channels"]}["sms"], "not_connected")
        self.assertEqual({c["key"]: c["status"] for c in data["channels"]}["inapp"], "connected")
        self.assertEqual(data["scheduled_next"], [])
        self.assertEqual({q["key"] for q in data["queues"]}, {"hero", "events-moderation", "promotions"})
        self.assertTrue(all(q["count"] == 0 for q in data["queues"]))
        self.assertEqual(data["threshold"], "25.00")

    def test_waiting_on_others_lists_only_my_marketing_requests(self):
        self.as_staff(self.akua)
        self.client.post(URL, PolicyApiTests.body(self), format="json")
        data = self.client.get(self.URL).json()
        self.assertEqual(len(data["waiting_on_others"]), 1)
        self.as_staff(self.boss)
        self.assertEqual(self.client.get(self.URL).json()["waiting_on_others"], [])

    def test_unknown_period_falls_back_to_seven_days(self):
        self.as_staff(self.akua)
        self.assertEqual(self.client.get(self.URL + "?days=9").json()["days"], 7)
        self.assertEqual(self.client.get(self.URL + "?days=30").json()["days"], 30)

    def test_a_role_with_no_marketing_permission_is_refused(self):
        self.as_staff(self.accountant)
        self.assertEqual(self.client.get(self.URL).status_code, 403)


class PromotionBadgeTests(MarketingBase):
    def test_pending_promotions_are_counted_for_those_who_can_approve_them(self):
        from datetime import timedelta
        from decimal import Decimal

        from accounts.models import BusinessOwner
        from listings.models import Category, Listing, Promotion, Zone

        owner = BusinessOwner.objects.create(full_name="Adwoa", login_phone="+233244000111", password_hash="x")
        listing = Listing.objects.create(business_owner=owner, name="Stole", category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"), price_amount=Decimal("10.00"))
        now = timezone.now()
        Promotion.objects.create(listing=listing, kind=Promotion.FEATURED, starts_at=now, ends_at=now + timedelta(days=3), amount_paid=Decimal("30.00"))
        self.as_staff(self.akua)
        self.assertEqual(self.client.get("/api/notifications/staff-badges/").json()["promotions_pending"], 1)
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/notifications/staff-badges/").json()["promotions_pending"], 0)
