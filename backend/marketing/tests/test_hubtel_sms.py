"""Hubtel SMS provider. The HTTP layer (marketing.providers.hubtel_sms.http_request) is always stubbed:
no test calls Hubtel or needs real credentials."""
import itertools
from datetime import timedelta
from unittest import mock

from django.test import override_settings

from marketing import consent, dispatch, sms_receipts
from marketing.models_campaigns import Campaign, CampaignRecipient, SenderId
from marketing.providers import get_provider, provider_status

from .test_campaigns import CampaignBase

HUBTEL = override_settings(
    MARKETING_SMS_PROVIDER="hubtel", HUBTEL_SMS_CLIENT_ID="test-id", HUBTEL_SMS_CLIENT_SECRET="test-secret-xyz", HUBTEL_SMS_SENDER_ID="AshantiHub",
    HUBTEL_SMS_CALLBACK_TOKEN="cb-token-123", HUBTEL_SMS_CALLBACK_BASE_URL="https://example.test",
)
TARGET = "marketing.providers.hubtel_sms.http_request"


class FakeResp:
    def __init__(self, data, status=200):
        self.data, self.status_code = data, status

    def json(self):
        if self.data is None:
            raise ValueError("no json")
        return self.data


def accepting():
    counter = itertools.count(1)
    return mock.Mock(side_effect=lambda *a, **k: FakeResp({"MessageId": f"mid-{next(counter)}", "Status": 0, "Rate": 1, "NetworkId": "62002"}))


def approve_sender(name="AshantiHub"):
    return SenderId.objects.create(name=name, network="mtn", status=SenderId.APPROVED)


@HUBTEL
class ProviderTests(CampaignBase):
    def test_status_needs_keys_and_never_exposes_them(self):
        self.assertEqual(provider_status("sms")["status"], "connected")
        self.assertNotIn("test-secret-xyz", str(provider_status("sms")))
        with override_settings(HUBTEL_SMS_CLIENT_SECRET=""):
            self.assertEqual(provider_status("sms")["status"], "not_connected")

    def test_unapproved_sender_sends_nothing(self):
        stub = accepting()
        with mock.patch(TARGET, stub):
            result = get_provider("sms").send(mock.Mock(address="0241234567", body="hi"))
        self.assertEqual(result.state, "failed")
        stub.assert_not_called()

    def test_send_posts_basic_auth_and_records_accepted_not_delivered(self):
        approve_sender()
        stub = accepting()
        with mock.patch(TARGET, stub):
            result = get_provider("sms").send(mock.Mock(address="0241234567", body="hi"))
        self.assertEqual((result.state, result.ref, result.delivered), ("sent", "mid-1", False))
        args, kwargs = stub.call_args
        self.assertEqual(args[0], "POST")
        self.assertEqual(kwargs["json"]["To"], "233241234567")
        self.assertEqual(kwargs["json"]["From"], "AshantiHub")
        self.assertEqual(kwargs["json"]["DeliveryCallbackUrl"], "https://example.test/api/marketing/sms/hubtel/callback/cb-token-123/")
        self.assertEqual(kwargs["auth"], ("test-id", "test-secret-xyz"))

    def test_refusal_and_outage_are_failures_with_no_secret_in_the_error(self):
        approve_sender()
        for stub in (mock.Mock(return_value=FakeResp({"Message": "bad"}, 401)), mock.Mock(side_effect=__import__("requests").ConnectionError("boom test-secret-xyz"))):
            with mock.patch(TARGET, stub):
                result = get_provider("sms").send(mock.Mock(address="0241234567", body="hi"))
            self.assertEqual(result.state, "failed")
            self.assertNotIn("test-secret-xyz", result.error)


@HUBTEL
class CampaignAndReceipts(CampaignBase):
    def setUp(self):
        super().setUp()
        approve_sender()

    def run_campaign(self, stub):
        pk = self.make().json()["id"]
        self.assertEqual(self.client.post(f"/api/marketing/campaigns/{pk}/send/").json()["status"], "scheduled")
        with mock.patch(TARGET, stub), mock.patch("marketing.dispatch.timezone.now", return_value=self.when):
            dispatch.dispatch(pk, now=self.when)
        return pk

    def test_gates_still_apply_and_results_are_stored_per_message(self):
        consent.record_consent(self.people[0], "sms", False, "unsubscribe_link")
        stub = accepting()
        pk = self.run_campaign(stub)
        self.assertEqual(stub.call_count, 4)                 # opted-out person was never sent to
        rows = CampaignRecipient.objects.filter(campaign_id=pk, status="sent")
        self.assertEqual(rows.count(), 4)
        self.assertEqual(set(rows.values_list("provider_status", flat=True)), {"accepted"})
        self.assertFalse(CampaignRecipient.objects.filter(campaign_id=pk, status="delivered").exists())
        self.assertEqual(str(Campaign.objects.get(pk=pk).actual_cost), "4.00")

    def test_failures_are_recorded_as_failed(self):
        pk = self.run_campaign(mock.Mock(return_value=FakeResp({"Message": "nope"}, 400)))
        self.assertEqual(CampaignRecipient.objects.filter(campaign_id=pk, status="failed").count(), 5)
        self.assertFalse(CampaignRecipient.objects.filter(campaign_id=pk, status__in=["sent", "delivered"]).exists())

    def test_callback_marks_delivered_once_and_is_idempotent(self):
        pk = self.run_campaign(accepting())
        url = "/api/marketing/sms/hubtel/callback/cb-token-123/"
        self.client.credentials()
        first = self.client.post(url, {"MessageId": "mid-1", "Status": "Delivered"}, format="json")
        self.assertEqual(first.json(), {"result": "delivered"})
        again = self.client.post(url, {"MessageId": "mid-1", "Status": "Delivered"}, format="json")
        self.assertEqual(again.json(), {"result": "duplicate"})
        self.assertEqual(CampaignRecipient.objects.filter(campaign_id=pk, status="delivered").count(), 1)
        self.client.post(url, {"MessageId": "mid-2", "Status": "Undeliverable"}, format="json")
        failed = CampaignRecipient.objects.get(provider_ref="mid-2")
        self.assertEqual(failed.status, "failed")
        self.client.post(url, {"MessageId": "mid-3", "Status": "Pending-ish"}, format="json")
        self.assertEqual(CampaignRecipient.objects.get(provider_ref="mid-3").status, "sent")     # unknown word is never delivery
        self.assertEqual(self.client.post(url, {"MessageId": "nope", "Status": "Delivered"}, format="json").json(), {"result": "unknown"})

    def test_callback_with_a_wrong_token_is_refused(self):
        self.client.credentials()
        self.assertEqual(self.client.post("/api/marketing/sms/hubtel/callback/wrong/", {"MessageId": "x", "Status": "Delivered"}, format="json").status_code, 404)
        with override_settings(HUBTEL_SMS_CALLBACK_TOKEN=""):
            self.assertEqual(self.client.post("/api/marketing/sms/hubtel/callback//", {}, format="json").status_code, 404)

    def test_results_and_register_show_hubtel_state(self):
        pk = self.run_campaign(accepting())
        sms_receipts.apply_receipt("mid-1", "Delivered")
        data = self.client.get(f"/api/marketing/campaigns/{pk}/results/").json()
        self.assertTrue(data["delivery_reported"])
        self.assertEqual((data["counts"]["delivered"], data["counts"]["awaiting_report"]), (1, 4))
        overview = self.client.get("/api/marketing/providers/").json()["sms"]
        self.assertEqual((overview["status"], overview["delivery_reports"], overview["sender_id"]["approved"]), ("connected", True, True))
        self.assertNotIn("test-secret-xyz", str(overview))

    def test_reconcile_settles_texts_from_the_status_check(self):
        pk = self.run_campaign(accepting())
        answers = {"mid-1": "Delivered", "mid-2": "Undeliverable"}
        stub = mock.Mock(side_effect=lambda m, url, **k: FakeResp({"status": answers.get(url.rsplit("/", 1)[1], "Pending"), "rate": 1}))
        with mock.patch(TARGET, stub):
            settled = sms_receipts.reconcile(now=self.when + timedelta(hours=1))
        self.assertEqual(settled, 2)
        self.assertEqual(CampaignRecipient.objects.filter(campaign_id=pk, status="sent").count(), 3)
