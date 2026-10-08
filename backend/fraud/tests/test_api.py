import asyncio

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity import services as activity
from activity.models import ActivityEvent
from fraud import services
from fraud.models import FraudFlag
from notifications.models import Notification

FIELDS = {
    "id", "kind", "kind_label", "status", "source", "title", "detail", "evidence", "business_owner",
    "related_business_owner", "staff_subject", "raised_by_name", "created_at", "resolved_by_name",
    "resolved_at", "resolution_note", "can_suspend",
}


def make_business(name, phone, *, manager=None):
    owner = BusinessOwner.objects.create(
        full_name=f"{name} Owner", login_phone=phone, password_hash="x", account_manager=manager,
    )
    BusinessOwnerProfile.objects.create(business_owner=owner, business_name=name, business_contact_phone=phone)
    return owner


class FraudApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")
        self.nana = make_staff("support", "nana@example.com")
        self.owner = make_business("Adwoa Fabrics", "+233244123118", manager=self.scout)
        self.twin = make_business("Adwoa Fabric House", "+233244555390")
        self.similar = services.raise_flag(
            FraudFlag.SIMILAR_NEARBY, title="Adwoa Fabrics · similar name 38 m away",
            detail="“Adwoa Fabric House” is 38 m away (name match 0.71).",
            evidence=["38 m apart", "Name match 0.71"],
            business_owner=self.owner, related_business_owner=self.twin,
        )

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def rows(self, query=""):
        response = self.client.get(f"/api/fraud/flags/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def counts(self):
        response = self.client.get("/api/fraud/flags/counts/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_a_fraud_manager_sees_what_the_case_card_shows(self):
        self.as_(self.lead)
        [row] = self.rows("?status=open")
        self.assertEqual(set(row), FIELDS)
        self.assertEqual(
            (row["id"], row["kind"], row["kind_label"], row["status"], row["source"]),
            (self.similar.id, "similar_nearby", "Similar business nearby", "open", "system"),
        )
        self.assertEqual(row["evidence"], ["38 m apart", "Name match 0.71"])
        self.assertEqual(
            row["business_owner"], {"id": self.owner.id, "display_name": "Adwoa Fabrics", "account_manager_name": "Kwame"},
        )
        self.assertEqual(row["related_business_owner"], {"id": self.twin.id, "display_name": "Adwoa Fabric House"})
        self.assertEqual((row["staff_subject"], row["raised_by_name"], row["resolved_by_name"]), (None, None, None))
        self.assertTrue(row["can_suspend"])

    def test_support_raises_a_case_by_hand_and_sees_only_their_own(self):
        self.as_(self.esi)
        response = self.client.post("/api/fraud/flags/", {
            "kind": "fake_business", "title": "Someone asked a shop for cash to register",
            "detail": "A man said he was from AshantiHub and wanted GH₵ 100.00.", "business_owner": self.owner.id,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["source"], body["raised_by_name"], body["status"]), ("staff", "Esi", "open"))
        self.assertEqual([row["id"] for row in self.rows()], [body["id"]])
        self.assertEqual(self.counts(), {"open": 1, "confirmed": 0, "dismissed": 0})
        self.assertEqual(
            list(ActivityEvent.objects.filter(actor_type="staff", actor_id=self.esi.id).values_list("verb", flat=True)),
            ["fraud.flag_raised"],  # recorded once, by the view — the middleware adds nothing
        )
        self.assertTrue(Notification.objects.filter(
            staff=self.lead, kind="fraud_flag_raised", title="Fraud case: Someone asked a shop for cash to register",
        ).exists())
        self.as_(self.nana)
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.counts(), {"open": 0, "confirmed": 0, "dismissed": 0})
        self.as_(self.lead)
        self.assertEqual({row["id"] for row in self.rows()}, {self.similar.id, body["id"]})
        self.assertEqual(self.counts(), {"open": 2, "confirmed": 0, "dismissed": 0})

    def test_only_three_kinds_can_be_raised_by_hand_and_two_need_a_business(self):
        self.as_(self.esi)
        wrong_kind = self.client.post("/api/fraud/flags/", {"kind": "self_dealing", "title": "Hmm"}, format="json")
        self.assertEqual(wrong_kind.status_code, 400)
        self.assertEqual(wrong_kind.json()["kind"], ["Choose fake business, duplicate or other."])
        no_business = self.client.post("/api/fraud/flags/", {"kind": "duplicate", "title": "Same shop twice"}, format="json")
        self.assertEqual(no_business.status_code, 400)
        self.assertEqual(no_business.json(), {"business_owner": ["Choose the business this case is about."]})
        no_title = self.client.post("/api/fraud/flags/", {"kind": "other", "title": ""}, format="json")
        self.assertEqual(no_title.status_code, 400)
        self.assertIn("title", no_title.json())
        other = self.client.post("/api/fraud/flags/", {"kind": "other", "title": "A caller asked for cash"}, format="json")
        self.assertEqual(other.status_code, 201, other.content)
        self.assertIsNone(other.json()["business_owner"])

    def test_scouts_have_no_access(self):
        self.as_(self.scout)
        self.assertEqual(self.client.get("/api/fraud/flags/").status_code, 403)
        self.assertEqual(self.client.get("/api/fraud/flags/counts/").status_code, 403)
        response = self.client.post("/api/fraud/flags/", {"kind": "other", "title": "x"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_deciding_needs_fraud_manage_and_a_note(self):
        url = f"/api/fraud/flags/{self.similar.id}/confirm/"
        self.as_(self.esi)
        self.assertEqual(self.client.post(url, {"note": "Looks fake"}, format="json").status_code, 403)
        self.as_(self.lead)
        response = self.client.post(url, {"note": ""}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Write a note — confirming or dismissing always needs one."})

    def test_confirm_and_suspend_then_it_cannot_be_decided_again(self):
        self.as_(self.lead)
        response = self.client.post(
            f"/api/fraud/flags/{self.similar.id}/confirm/",
            {"note": "Same shop — the owner registered twice", "suspend": True}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(
            (body["status"], body["resolved_by_name"], body["resolution_note"], body["can_suspend"]),
            ("confirmed", "Ama", "Same shop — the owner registered twice", False),
        )
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.is_suspended)
        again = self.client.post(f"/api/fraud/flags/{self.similar.id}/dismiss/", {"note": "Late"}, format="json")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.json(), {"detail": "This case has already been decided."})
        self.assertEqual(self.counts(), {"open": 0, "confirmed": 1, "dismissed": 0})
        self.assertEqual(
            list(ActivityEvent.objects.filter(actor_type="staff", actor_id=self.lead.id).values_list("verb", flat=True)),
            ["fraud.flag_confirmed"],
        )

    def test_dismissing_keeps_the_business_trading(self):
        self.as_(self.lead)
        response = self.client.post(
            f"/api/fraud/flags/{self.similar.id}/dismiss/", {"note": "Two different shops on one street"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "dismissed")
        self.owner.refresh_from_db()
        self.assertFalse(self.owner.is_suspended)
        self.assertEqual([row["id"] for row in self.rows("?status=dismissed")], [self.similar.id])
        self.assertEqual(self.rows("?status=open"), [])

    def test_an_unknown_status_falls_back_to_open_and_kind_filters(self):
        services.raise_flag(FraudFlag.OTHER, title="Odd payout name")
        self.as_(self.lead)
        self.assertEqual({row["status"] for row in self.rows("?status=nope")}, {"open"})
        self.assertEqual([row["kind"] for row in self.rows("?kind=other")], ["other"])

    def test_an_unknown_case_is_404(self):
        self.as_(self.lead)
        response = self.client.post("/api/fraud/flags/999999/confirm/", {"note": "x"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_a_page_holds_25_cases(self):
        FraudFlag.objects.bulk_create([
            FraudFlag(kind=FraudFlag.OTHER, source=FraudFlag.SYSTEM, title=f"Case {n}") for n in range(25)
        ])
        self.as_(self.lead)
        body = self.client.get("/api/fraud/flags/").json()
        self.assertEqual((body["count"], len(body["results"])), (26, 25))
        self.assertIsNotNone(body["next"])


class FraudLiveUpdateTests(TestCase):
    def setUp(self):
        self.layer = get_channel_layer()
        async_to_sync(self.layer.flush)()
        self.lead = make_staff("operations", "ama@example.com")

    def listen(self, group):
        channel = async_to_sync(self.layer.new_channel)()
        async_to_sync(self.layer.group_add)(group, channel)
        return channel

    def message(self, channel):
        async def receive():
            return await asyncio.wait_for(self.layer.receive(channel), timeout=2)

        return async_to_sync(receive)()

    def test_fraud_events_refresh_the_fraud_queues(self):
        for verb in ("fraud.flag_raised", "fraud.flag_confirmed", "fraud.flag_dismissed"):
            for group in ("perm.fraud.manage", "perm.fraud.flag"):
                with self.subTest(verb=verb, group=group):
                    queue = self.listen(group)
                    with self.captureOnCommitCallbacks(execute=True):
                        activity.record(self.lead, verb, target_type="fraud.fraudflag", target_id="1")
                    self.assertEqual(
                        self.message(queue)["payload"]["invalidate"], ["fraud-flags", "fraud-flag-counts", "kyc-queue", "portfolio-business", "staff-badges"],
                    )
