from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from marketing import campaigns, consent, dispatch
from marketing.models import SendPolicy
from marketing.models_campaigns import Campaign, CampaignRecipient, ProviderStep, SenderId, Template
from marketing.models_consent import Segment

from .base import MarketingBase
from .test_consent import make_customer

ANY = {"zones": [], "categories": [], "activity": "any", "days": 90}
SIM = override_settings(MARKETING_SMS_PROVIDER="simulated")


def next_weekday_at(hour, weekday=1):
    """The next given weekday (0=Mon) at hour:00 local, at least two days ahead."""
    day = timezone.localtime() + timedelta(days=2)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day.replace(hour=hour, minute=0, second=0, microsecond=0)


class CampaignBase(MarketingBase):
    def setUp(self):
        super().setUp()
        self.people = [make_customer(i) for i in range(1, 6)]
        for c in self.people:
            consent.record_consent(c, "sms", True, "settings")
        self.segment = Segment.objects.create(name="Customers", audience="customer", channel="sms", filters=ANY)
        self.when = next_weekday_at(10)
        self.as_staff(self.akua)

    def make(self, **kw):
        data = {"name": "Kente Friday", "channel": "sms", "segment": self.segment.pk, "body": "Kente Friday on AshantiHub: 20% off. Shop: {link}", "link_path": "/events", "send_at": self.when.isoformat()}
        data.update(kw)
        return self.client.post("/api/marketing/campaigns/", data, format="json")


@SIM
class CampaignFlow(CampaignBase):
    def test_estimate_counts_only_opted_in_people(self):
        stranger = make_customer(9)   # never opted in
        body = self.make().json()
        self.assertEqual(body["est_recipients"], 5)
        self.assertEqual(body["est_cost"], "0.16")      # 5 x 0.033, to the pesewa
        self.assertFalse(any(c["state"] == "block" for c in body["checks"]), body["checks"])
        self.assertIsNotNone(stranger.pk)

    def test_small_campaign_schedules_without_approval(self):
        pk = self.make().json()["id"]
        response = self.client.post(f"/api/marketing/campaigns/{pk}/send/")
        self.assertEqual(response.json()["status"], "scheduled", response.content)

    def test_send_time_outside_the_window_or_on_a_quiet_day_cannot_be_scheduled(self):
        for when in (next_weekday_at(21), next_weekday_at(10, weekday=6)):
            pk = self.make(send_at=when.isoformat()).json()["id"]
            response = self.client.post(f"/api/marketing/campaigns/{pk}/send/")
            self.assertEqual(response.status_code, 400, response.content)
            self.assertEqual(Campaign.objects.get(pk=pk).status, "draft")

    def test_a_message_carrying_a_phone_number_is_refused(self):
        pk = self.make(body="Call me on 0244123456 for kente").json()["id"]
        self.assertEqual(self.client.post(f"/api/marketing/campaigns/{pk}/send/").status_code, 400)

    def test_nobody_opted_in_cannot_be_sent(self):
        pk = self.make().json()["id"]
        for c in self.people:
            consent.record_consent(c, "sms", False, "unsubscribe_link")
        response = self.client.post(f"/api/marketing/campaigns/{pk}/send/")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Campaign.objects.get(pk=pk).status, "draft")

    def test_whatsapp_is_not_connected_so_it_cannot_be_sent(self):
        for c in self.people:
            consent.record_consent(c, "whatsapp", True, "settings")
        seg = Segment.objects.create(name="WA", audience="customer", channel="whatsapp", filters=ANY)
        pk = self.make(channel="whatsapp", segment=seg.pk).json()["id"]
        response = self.client.post(f"/api/marketing/campaigns/{pk}/send/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("not connected", response.json()["detail"])

    @override_settings(MARKETING_UNIT_PRICE={"sms": "6.00", "whatsapp": "", "email": "", "inapp": ""})
    def test_over_the_limit_goes_to_super_admin_and_the_maker_cannot_approve(self):
        pk = self.make().json()["id"]          # 5 x 6.00 = 30.00 > 25.00
        response = self.client.post(f"/api/marketing/campaigns/{pk}/send/")
        self.assertEqual(response.json()["status"], "waiting_approval", response.content)
        self.assertEqual(self.client.patch(f"/api/marketing/campaigns/{pk}/", {"name": "x"}, format="json").status_code, 409)
        c = Campaign.objects.get(pk=pk)
        from approvals import services as approvals
        from approvals.services import ApprovalError

        with self.assertRaises(ApprovalError):
            approvals.approve(c.approval_id, self.akua)       # the maker never decides
        self.assertEqual(self.client.post(f"/api/marketing/campaigns/{pk}/remind/").json(), {"reminded": True})
        self.assertEqual(self.client.post(f"/api/marketing/campaigns/{pk}/remind/").status_code, 429)
        withdrawn = self.client.post(f"/api/marketing/campaigns/{pk}/withdraw/").json()
        self.assertEqual(withdrawn["status"], "withdrawn")

    @override_settings(MARKETING_UNIT_PRICE={"sms": "6.00", "whatsapp": "", "email": "", "inapp": ""})
    def test_super_admin_approval_schedules_it(self):
        from approvals import services as approvals

        pk = self.make().json()["id"]
        self.client.post(f"/api/marketing/campaigns/{pk}/send/")
        c = Campaign.objects.get(pk=pk)
        approvals.approve(c.approval_id, self.boss)
        self.assertEqual(Campaign.objects.get(pk=pk).status, "scheduled")

    def test_an_unapproved_request_is_dropped_when_its_time_comes(self):
        pk = self.make().json()["id"]
        Campaign.objects.filter(pk=pk).update(status="waiting_approval", send_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(campaigns.expire_unapproved(), 1)
        self.assertEqual(Campaign.objects.get(pk=pk).status, "draft")

    def test_a_test_goes_only_to_the_sender(self):
        pk = self.make().json()["id"]
        self.akua.phone = "+233244000001"
        self.akua.save()
        self.assertEqual(self.client.post(f"/api/marketing/campaigns/{pk}/test/").json(), {"state": "simulated"})
        self.assertFalse(CampaignRecipient.objects.exists())


@SIM
class Dispatch(CampaignBase):
    def go(self, **kw):
        pk = self.make(**kw).json()["id"]
        self.client.post(f"/api/marketing/campaigns/{pk}/send/")
        return pk

    def run_at(self, pk, when):
        with mock.patch("marketing.dispatch.timezone.now", return_value=when):
            return dispatch.dispatch(pk, now=when)

    def test_it_waits_until_its_time_and_never_claims_delivery(self):
        pk = self.go()
        self.assertEqual(self.run_at(pk, self.when - timedelta(hours=1)), "waiting")
        self.assertFalse(CampaignRecipient.objects.exists())
        self.assertEqual(self.run_at(pk, self.when), "sent")
        states = set(CampaignRecipient.objects.values_list("status", flat=True))
        self.assertEqual(states, {"simulated"})
        self.assertEqual(self.run_at(pk, self.when), "waiting")        # a second run sends nothing more

    def test_someone_who_opted_out_before_the_send_is_dropped(self):
        pk = self.go()
        consent.record_consent(self.people[0], "sms", False, "unsubscribe_link")
        self.run_at(pk, self.when)
        self.assertEqual(CampaignRecipient.objects.filter(status="simulated").count(), 4)
        self.assertFalse(CampaignRecipient.objects.filter(customer=self.people[0], status="simulated").exists())

    def test_the_per_person_cap_leaves_out_recently_messaged_people(self):
        first = self.go(name="First")
        self.run_at(first, self.when)
        second = self.go(name="Second", send_at=(self.when + timedelta(days=1)).isoformat())
        self.run_at(second, self.when + timedelta(days=1))
        self.assertEqual(CampaignRecipient.objects.filter(campaign_id=second, skip_reason="cap").count(), 5)
        self.assertEqual(CampaignRecipient.objects.filter(campaign_id=second, status="simulated").count(), 0)

    def test_a_send_outside_the_window_pauses(self):
        pk = self.go()
        self.assertEqual(self.run_at(pk, self.when.replace(hour=22)), "waiting")

    def test_the_tracked_link_counts_a_click_and_names_the_page(self):
        pk = self.go()
        self.run_at(pk, self.when)
        row = CampaignRecipient.objects.first()
        self.client.credentials()
        response = self.client.post(f"/api/marketing/r/{row.click_token}/")
        self.assertEqual(response.json(), {"path": "/events"})
        row.refresh_from_db()
        self.assertEqual((row.click_count, row.first_click_at is not None), (1, True))
        self.assertEqual(self.client.post("/api/marketing/r/nope/").status_code, 404)

    def test_results_say_delivery_is_not_reported(self):
        pk = self.go()
        self.run_at(pk, self.when)
        data = self.client.get(f"/api/marketing/campaigns/{pk}/results/").json()
        self.assertFalse(data["delivery_reported"])
        self.assertIsNone(data["counts"]["delivered"])
        self.assertEqual(data["counts"]["simulated"], 5)
        self.assertIsNone(data["signups"])


class Permissions(CampaignBase):
    def test_only_marketing_and_super_admin_manage_campaigns(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/marketing/campaigns/").status_code, 403)
        self.assertEqual(self.client.get("/api/marketing/templates/").status_code, 403)
        self.assertEqual(self.client.get("/api/marketing/providers/").status_code, 403)
        self.as_staff(self.boss)
        self.assertEqual(self.client.get("/api/marketing/campaigns/").status_code, 200)


class TemplatesAndRegisters(CampaignBase):
    def test_a_marketing_whatsapp_template_needs_the_stop_button(self):
        body = {"channel": "whatsapp", "name": "x_offer", "body": "Hello {{1}}, offers from AshantiHub this week. See them.", "category": "marketing", "buttons": ["Shop now"]}
        self.assertEqual(self.client.post("/api/marketing/templates/", body, format="json").status_code, 400)
        body["buttons"] = ["Shop now", "Stop offers"]
        created = self.client.post("/api/marketing/templates/", body, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["meta_status"], "not_submitted")
        self.assertFalse(created.json()["can_use"])

    def test_meta_status_is_recorded_by_a_person_and_a_rejection_needs_a_reason(self):
        t = self.client.post("/api/marketing/templates/", {"channel": "whatsapp", "name": "a", "body": "Hello {{1}}, offers from AshantiHub. See more.", "buttons": ["Stop offers"]}, format="json").json()
        url = f"/api/marketing/templates/{t['id']}/meta/"
        self.assertEqual(self.client.post(url, {"status": "rejected"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"status": "rejected", "note": "Variable first"}, format="json").json()["meta_status"], "rejected")
        edited = self.client.patch(f"/api/marketing/templates/{t['id']}/", {"body": "Hello {{1}}, new offers from AshantiHub. See more."}, format="json").json()
        self.assertEqual(edited["meta_status"], "not_submitted")
        self.client.post(url, {"status": "approved"}, format="json")
        self.assertEqual(self.client.patch(f"/api/marketing/templates/{t['id']}/", {"body": "Changed after Meta approved it."}, format="json").status_code, 409)

    def test_sms_template_refuses_contact_details_and_lists_room(self):
        bad = self.client.post("/api/marketing/templates/", {"channel": "sms", "name": "c", "body": "WhatsApp me on 0244123456"}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = self.client.post("/api/marketing/templates/", {"channel": "sms", "name": "We miss you", "body": "See what's new: {link}"}, format="json")
        self.assertEqual(ok.status_code, 201)
        listed = self.client.get("/api/marketing/templates/").json()
        self.assertEqual(len(listed["sms"]), 1)
        self.assertGreater(listed["sms"][0]["room"], 0)

    def test_sender_ids_are_a_hand_kept_register(self):
        r = self.client.post("/api/marketing/sender-ids/", {"name": "AshantiHub", "network": "mtn", "status": "submitted", "submitted_on": "2026-10-01"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.client.post("/api/marketing/sender-ids/", {"name": "AshantiHub", "network": "mtn"}, format="json").status_code, 409)
        self.assertEqual(self.client.post("/api/marketing/sender-ids/", {"name": "WayTooLongName1", "network": "mtn"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/marketing/sender-ids/", {"name": "Later", "network": "mtn", "submitted_on": "2999-01-01"}, format="json").status_code, 400)
        data = self.client.get("/api/marketing/providers/").json()
        self.assertEqual(data["senders"][0]["networks"]["mtn"]["status"], "submitted")
        self.assertEqual(data["sms"]["status"], "not_connected")
        self.assertIsNone(data["sms"]["balance"])
        self.assertEqual(len(data["whatsapp"]["steps"]), 7)
        self.assertEqual(data["whatsapp"]["done"], 0)

    def test_provider_steps_are_ticked_by_a_person(self):
        step = ProviderStep.objects.first()
        r = self.client.post(f"/api/marketing/provider-steps/{step.pk}/", {"status": "done", "note": "Account created"}, format="json")
        self.assertEqual((r.json()["status"], r.json()["recorded_by"]), ("done", self.akua.full_name))
        self.assertEqual(self.client.post(f"/api/marketing/provider-steps/{step.pk}/", {"status": "magic"}, format="json").status_code, 400)
