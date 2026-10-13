"""Canned replies and tags: permissions, the body rules, the composer contract
(placeholders filled from real records, unresolved ones left marked), retire
instead of delete, merge, and the migration's starters."""
import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from marketplace.tests.base import make_customer, make_order
from messaging.models import CannedReply, Conversation, ConversationTag
from orders.models import DeliveryAssignment
from portfolio.tests.health_fixtures import add_listings, make_business


class KnowledgeBase(TestCase):
    def setUp(self):
        self.support = make_staff("support", "esi.nyarko@example.com")
        self.scout = make_staff("scout", "kwame@example.com")
        self.client = APIClient()
        self.sign_in(self.support)

    def sign_in(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")


class StarterTests(KnowledgeBase):
    def test_the_migration_seeds_eight_replies_and_ten_tags_with_no_usage_or_author(self):
        self.assertEqual(CannedReply.objects.count(), 8)
        self.assertEqual(ConversationTag.objects.count(), 10)
        self.assertFalse(CannedReply.objects.exclude(uses=0).exists())
        self.assertFalse(CannedReply.objects.exclude(created_by=None).exists())
        rows = self.client.get("/api/messaging/staff/canned/").json()
        self.assertTrue(all(r["is_default"] and r["created_by_name"] == "AshantiHub default" for r in rows))
        late = CannedReply.objects.get(shortcut="/late")
        self.assertEqual(late.title, "Rider running late")

    def test_no_starter_holds_a_phone_number_or_whatsapp_link(self):
        from messaging.knowledge import validate_body

        for reply in CannedReply.objects.all():
            validate_body(reply.body)


class CannedPermissionTests(KnowledgeBase):
    def test_a_role_without_messaging_manage_is_refused_everywhere(self):
        self.sign_in(self.scout)
        reply = CannedReply.objects.first()
        tag = ConversationTag.objects.first()
        for method, url in [
            ("get", "/api/messaging/staff/canned/"), ("post", "/api/messaging/staff/canned/"),
            ("patch", f"/api/messaging/staff/canned/{reply.pk}/"), ("post", f"/api/messaging/staff/canned/{reply.pk}/retire/"),
            ("post", f"/api/messaging/staff/canned/{reply.pk}/use/"), ("post", "/api/messaging/staff/canned/preview/"),
            ("get", "/api/messaging/staff/canned/fields/"),
            ("get", "/api/messaging/staff/tags/"), ("post", "/api/messaging/staff/tags/"),
            ("patch", f"/api/messaging/staff/tags/{tag.pk}/"), ("post", f"/api/messaging/staff/tags/{tag.pk}/archive/"),
            ("post", f"/api/messaging/staff/tags/{tag.pk}/merge/"),
        ]:
            self.assertEqual(getattr(self.client, method)(url, {}, format="json").status_code, 403, (method, url))

    def test_anonymous_is_refused(self):
        self.client.credentials()
        self.assertIn(self.client.get("/api/messaging/staff/canned/").status_code, (401, 403))


class CannedCrudTests(KnowledgeBase):
    def create(self, **over):
        body = {"title": "Closing", "shortcut": "/bye", "body": "Thanks {customer_first_name}. {agent_first_name}", "audience": "anyone", **over}
        return self.client.post("/api/messaging/staff/canned/", body, format="json")

    def test_create_records_the_author_and_normalises_the_shortcut(self):
        response = self.create(shortcut="BYE")
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["shortcut"], "/bye")
        self.assertEqual(data["created_by_name"], "Esi.Nyarko")
        self.assertEqual(data["uses"], 0)
        self.assertEqual(data["fields_used"], ["agent_first_name", "customer_first_name"])
        self.assertTrue(ActivityEvent.objects.filter(verb="staff-canned-list").exists())

    def test_shortcut_is_unique_even_against_a_retired_reply(self):
        self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.create(title="Other").status_code, 400)
        late = CannedReply.objects.get(shortcut="/late")
        self.client.post(f"/api/messaging/staff/canned/{late.pk}/retire/")
        self.assertEqual(self.create(shortcut="/late").status_code, 400)

    def test_bad_shortcuts_are_refused(self):
        for bad in ("/", "/has space", "/UPPER_case", "x" * 40, "//double"):
            self.assertEqual(self.create(shortcut=bad).status_code, 400, bad)

    def test_a_body_cannot_hold_a_phone_number_or_a_whatsapp_link(self):
        for body in (
            "Call 0241234567 now", "Call +233 24 123 4567", "Call 024-123-4567", "Call (024) 123 4567",
            "Chat https://wa.me/233241234567", "see api.whatsapp.com/send?x=1", "WhatsApp: whatsapp.com/x",
        ):
            response = self.create(shortcut="/x", body=body)
            self.assertEqual(response.status_code, 400, body)
            self.assertIn("body", response.json())

    def test_short_numbers_and_order_numbers_are_fine(self):
        self.assertEqual(self.create(shortcut="/ok", body="Order #12345 is 2 days late, GH₵ 150.").status_code, 201)

    def test_an_unknown_field_is_refused(self):
        self.assertEqual(self.create(shortcut="/x", body="Hi {first_name}").status_code, 400)

    def test_patch_edits_and_validates_the_same_rules(self):
        reply = self.create().json()
        url = f"/api/messaging/staff/canned/{reply['id']}/"
        ok = self.client.patch(url, {"title": "Goodbye"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["title"], "Goodbye")
        self.assertEqual(self.client.patch(url, {"body": "ring 0241234567"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"shortcut": "/late"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"shortcut": "/bye"}, format="json").status_code, 200)  # its own

    def test_there_is_no_delete_only_retire_and_restore(self):
        reply = CannedReply.objects.get(shortcut="/hi")
        url = f"/api/messaging/staff/canned/{reply.pk}/"
        self.assertEqual(self.client.delete(url).status_code, 405)
        retired = self.client.post(url + "retire/").json()
        self.assertIsNotNone(retired["retired_at"])
        self.assertNotIn(reply.pk, [r["id"] for r in self.client.get("/api/messaging/staff/canned/").json()])
        self.assertIn(reply.pk, [r["id"] for r in self.client.get("/api/messaging/staff/canned/?status=retired").json()])
        self.assertIn(reply.pk, [r["id"] for r in self.client.get("/api/messaging/staff/canned/?status=all").json()])
        self.client.post(url + "restore/")
        self.assertIn(reply.pk, [r["id"] for r in self.client.get("/api/messaging/staff/canned/").json()])
        self.assertTrue(CannedReply.objects.filter(pk=reply.pk).exists())

    def test_use_bumps_the_counter_and_a_retired_reply_cannot_be_used(self):
        reply = CannedReply.objects.get(shortcut="/hi")
        url = f"/api/messaging/staff/canned/{reply.pk}/use/"
        self.assertEqual(self.client.post(url).json(), {"id": reply.pk, "uses": 1})
        self.assertEqual(self.client.post(url).json()["uses"], 2)
        reply.refresh_from_db()
        self.assertEqual(reply.uses, 2)
        self.client.post(f"/api/messaging/staff/canned/{reply.pk}/retire/")
        self.assertEqual(self.client.post(url).status_code, 400)
        self.assertEqual(self.client.post("/api/messaging/staff/canned/999999/use/").status_code, 404)

    def test_library_is_most_used_first(self):
        CannedReply.objects.filter(shortcut="/out").update(uses=9)
        self.assertEqual(self.client.get("/api/messaging/staff/canned/").json()[0]["shortcut"], "/out")

    def test_fields_endpoint_lists_the_seven_chips(self):
        names = [f["name"] for f in self.client.get("/api/messaging/staff/canned/fields/").json()]
        self.assertEqual(len(names), 7)
        self.assertIn("eta", names)


class ComposerContractTests(KnowledgeBase):
    def setUp(self):
        super().setUp()
        self.business = make_business("Akosua Ntoma Kente")
        self.listing = add_listings(self.business, 1)[0]
        self.customer = make_customer("Yaw Mensah")
        self.order = make_order(self.customer, self.listing)
        self.conversation = Conversation.objects.create(customer=self.customer, about_order=self.order, about_business=self.business)

    def listing_for(self, conversation):
        response = self.client.get(f"/api/messaging/staff/canned/?conversation={conversation.pk}")
        self.assertEqual(response.status_code, 200, response.content)
        return {r["shortcut"]: r for r in response.json()}

    def test_shape_is_exactly_the_contract(self):
        rows = self.client.get(f"/api/messaging/staff/canned/?conversation={self.conversation.pk}").json()
        self.assertEqual(set(rows[0]), {"id", "title", "shortcut", "body", "audience"})

    def test_placeholders_are_filled_from_real_records_and_unresolved_ones_stay_marked(self):
        late = self.listing_for(self.conversation)["/late"]["body"]
        self.assertIn("Hi Yaw,", late)
        self.assertIn(f"order #{self.order.pk} from Akosua Ntoma Kente", late)
        self.assertIn("Esi.Nyarko, AshantiHub Support", late)
        # No rider assigned and there is no ETA anywhere: both stay marked, nothing guessed.
        self.assertIn("{rider_first_name}", late)
        self.assertIn("{eta}", late)

    def test_a_rider_resolves_only_when_the_order_has_one_but_eta_never_does(self):
        rider = make_staff("dispatch", "kofi.rider@example.com")
        DeliveryAssignment.objects.create(order=self.order, dispatch=rider, assigned_by=self.support)
        late = self.listing_for(self.conversation)["/late"]["body"]
        self.assertIn("Kofi.Rider is running", late)
        self.assertIn("{eta}", late)

    def test_a_thread_with_no_links_leaves_order_and_business_marked(self):
        bare = Conversation.objects.create(customer=self.customer)
        body = self.listing_for(bare)["/refund"]["body"]
        self.assertIn("{order_number}", body)
        self.assertIn("Hi Yaw,", body)

    def test_the_audience_filters_the_list(self):
        owner_thread = Conversation.objects.create(business_owner=self.business)
        guest_thread = Conversation.objects.create(guest_token="g" * 36)
        customer_set = set(self.listing_for(self.conversation))
        owner_set = set(self.listing_for(owner_thread))
        guest_set = set(self.listing_for(guest_thread))
        self.assertIn("/renew", owner_set)
        self.assertNotIn("/renew", customer_set)
        self.assertNotIn("/late", owner_set)
        self.assertIn("/hi", customer_set | owner_set | guest_set)
        self.assertEqual(guest_set, {"/hi"})

    def test_retired_replies_are_not_offered_and_unknown_thread_is_404(self):
        CannedReply.objects.filter(shortcut="/hi").update(retired_at=timezone.now())
        self.assertNotIn("/hi", self.listing_for(self.conversation))
        self.assertEqual(self.client.get("/api/messaging/staff/canned/?conversation=999999").status_code, 404)
        self.assertEqual(self.client.get("/api/messaging/staff/canned/?conversation=abc").status_code, 400)

    def test_listing_title_resolves_from_the_listing(self):
        CannedReply.objects.create(title="L", shortcut="/l", body="About {listing_title}")
        thread = Conversation.objects.create(customer=self.customer, about_listing=self.listing)
        self.assertEqual(self.listing_for(thread)["/l"]["body"], f"About {self.listing.name}")

    def test_listing_the_composer_contract_writes_nothing(self):
        before = (CannedReply.objects.values_list("uses", flat=True).count(), ActivityEvent.objects.count())
        self.listing_for(self.conversation)
        self.assertEqual((CannedReply.objects.values_list("uses", flat=True).count(), ActivityEvent.objects.count()), before)


class PreviewTests(ComposerContractTests):
    def test_preview_lists_unresolved_fields(self):
        response = self.client.post(
            "/api/messaging/staff/canned/preview/",
            {"body": "Hi {customer_first_name}, by {eta} for {order_number}", "conversation": self.conversation.pk}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["text"], f"Hi Yaw, by {{eta}} for #{self.order.pk}")
        self.assertEqual(data["unresolved"], ["eta"])

    def test_preview_without_a_conversation_resolves_only_the_agent(self):
        data = self.client.post(
            "/api/messaging/staff/canned/preview/", {"body": "{agent_first_name} / {customer_first_name}"}, format="json"
        ).json()
        self.assertEqual(data["text"], "Esi.Nyarko / {customer_first_name}")
        self.assertEqual(data["unresolved"], ["customer_first_name"])

    def test_preview_refuses_an_empty_body_and_unknown_fields_and_writes_no_activity(self):
        self.assertEqual(self.client.post("/api/messaging/staff/canned/preview/", {"body": " "}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/messaging/staff/canned/preview/", {"body": "{nope}"}, format="json").status_code, 400)
        before = ActivityEvent.objects.count()
        self.client.post("/api/messaging/staff/canned/preview/", {"body": "hi"}, format="json")
        self.assertEqual(ActivityEvent.objects.count(), before)


class TagTests(KnowledgeBase):
    def make_tag(self, name="pickup-delay", description="Pickup not ready"):
        response = self.client.post("/api/messaging/staff/tags/", {"name": name, "description": description}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_list_has_live_counts_open_now_and_last_30_days(self):
        tag = ConversationTag.objects.get(name="delivery")
        customer = make_customer("A")
        open_recent = Conversation.objects.create(customer=customer)
        closed_recent = Conversation.objects.create(customer=customer, status=Conversation.CLOSED)
        old_open = Conversation.objects.create(customer=customer)
        Conversation.objects.filter(pk=old_open.pk).update(created_at=timezone.now() - datetime.timedelta(days=60))
        for c in (open_recent, closed_recent, old_open):
            c.tags.add(tag)
        row = next(r for r in self.client.get("/api/messaging/staff/tags/").json() if r["name"] == "delivery")
        self.assertEqual((row["open_now"], row["last_30_days"]), (2, 2))
        empty = next(r for r in self.client.get("/api/messaging/staff/tags/").json() if r["name"] == "return")
        self.assertEqual((empty["open_now"], empty["last_30_days"]), (0, 0))

    def test_create_validates_name_form_and_uniqueness(self):
        self.make_tag()
        for bad in ("Pickup Delay", "-x", "x-", "a--b", "has space", "", "x" * 41):
            self.assertEqual(self.client.post("/api/messaging/staff/tags/", {"name": bad}, format="json").status_code, 400, bad)
        self.assertEqual(self.client.post("/api/messaging/staff/tags/", {"name": "pickup-delay"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/messaging/staff/tags/", {"name": "PICKUP-DELAY"}, format="json").status_code, 400)

    def test_rename_is_logged_with_the_old_name(self):
        tag = self.make_tag()
        response = self.client.patch(f"/api/messaging/staff/tags/{tag['id']}/", {"name": "pickup-late"}, format="json")
        self.assertEqual(response.status_code, 200)
        event = ActivityEvent.objects.get(verb="support.tag.renamed")
        self.assertEqual(event.before["name"], "pickup-delay")
        self.assertEqual(event.after["name"], "pickup-late")
        self.assertEqual(self.client.patch(f"/api/messaging/staff/tags/{tag['id']}/", {"name": "delivery"}, format="json").status_code, 400)

    def test_archive_and_unarchive_move_it_between_the_lists(self):
        tag = self.make_tag()
        self.client.post(f"/api/messaging/staff/tags/{tag['id']}/archive/")
        self.assertNotIn(tag["id"], [t["id"] for t in self.client.get("/api/messaging/staff/tags/").json()])
        self.assertIn(tag["id"], [t["id"] for t in self.client.get("/api/messaging/staff/tags/?archived=1").json()])
        self.client.post(f"/api/messaging/staff/tags/{tag['id']}/unarchive/")
        self.assertIn(tag["id"], [t["id"] for t in self.client.get("/api/messaging/staff/tags/").json()])

    def test_merge_moves_conversations_archives_the_source_and_logs_both_names(self):
        source = ConversationTag.objects.create(name="late")
        target = ConversationTag.objects.get(name="late-rider")
        customer = make_customer("B")
        a, b, both = (Conversation.objects.create(customer=customer) for _ in range(3))
        a.tags.add(source)
        b.tags.add(source)
        both.tags.add(source, target)
        response = self.client.post(f"/api/messaging/staff/tags/{source.pk}/merge/", {"into": target.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["moved"], 3)
        self.assertEqual(set(target.conversations.values_list("pk", flat=True)), {a.pk, b.pk, both.pk})
        self.assertEqual(source.conversations.count(), 0)
        source.refresh_from_db()
        self.assertIsNotNone(source.archived_at)
        event = ActivityEvent.objects.get(verb="support.tag.merged")
        self.assertEqual(event.before["name"], "late")
        self.assertEqual(event.after["into"], "late-rider")
        self.assertEqual(event.after["conversations_moved"], 3)

    def test_merge_refuses_itself_an_archived_target_and_unknowns(self):
        a = ConversationTag.objects.get(name="delivery")
        b = ConversationTag.objects.get(name="return")
        url = f"/api/messaging/staff/tags/{a.pk}/merge/"
        self.assertEqual(self.client.post(url, {"into": a.pk}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"into": 999999}, format="json").status_code, 400)
        b.archived_at = timezone.now()
        b.save()
        self.assertEqual(self.client.post(url, {"into": b.pk}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/messaging/staff/tags/999999/merge/", {"into": a.pk}, format="json").status_code, 404)
