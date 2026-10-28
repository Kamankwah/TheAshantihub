"""Staff draft listings for a client (plan M3, Task 5): create, edit, withdraw, send and resend, with the scope rule,
per-kind validation, the owner-confirmation links and what the responses and activity never carry."""
import json
import re
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from accounts.claims import ClaimError
from accounts.testing import make_staff
from activity.models import ActivityEvent
from events.models import EventPricingTier
from listings.models import Category, Zone
from otp import senders
from portfolio import confirmations
from portfolio.models import ListingDraft, OwnerConfirmation, StagedPhoto
from portfolio.tests.change_fixtures import ChangeTestBase, jpeg, make_business, product_body

TOKEN = re.compile(r"token=([\w-]+)")


class DraftBase(ChangeTestBase):
    def setUp(self):
        super().setUp()
        senders.sms_outbox.clear()
        self.admin = make_staff("super_admin", "root@example.com")
        self.gm = make_staff("general_manager", "gm@example.com")
        self.support = make_staff("support", "help@example.com")
        self.salon = make_business(self.scout, kind="service", plan="service", phone="+233244100300", gps="AK-039-5030", name="Ama Salon")
        self.service_cat = Category.objects.create(slug="t-salon", icon="x", label="Salon", color="#fff", kind="service")
        self.stay_cat = Category.objects.create(
            slug="t-guest", icon="x", label="Guest house", color="#fff", kind="service", is_accommodation=True,
        )
        self.event_cat = Category.objects.create(slug="t-party", icon="x", label="Party", color="#fff", kind="event")
        EventPricingTier.objects.get_or_create(duration_days=30, defaults={"live_price": "50.00"})
        self.responses = []

    def url(self, owner=None, tail=""):
        return f"/api/portfolio/businesses/{(owner or self.owner).pk}/drafts/{tail}"

    def call(self, method, url, body=None):
        response = getattr(self.client, method)(url, body, format="json") if body is not None else getattr(self.client, method)(url)
        self.responses.append(response)
        return response

    def service_body(self, **extra):
        return {
            "kind": "service", "category": self.service_cat.pk, "zone": Zone.objects.get(name="Adum").pk,
            "name": "Braids", "description": "Box braids.", "price_amount": "80.00", "price_unit": "per visit", **extra,
        }

    def product(self, owner=None, **extra):
        return self.call("post", self.url(owner), {"kind": "product", **product_body(), **extra})

    def make_draft(self, owner=None, **extra):
        response = self.product(owner, **extra)
        self.assertEqual(response.status_code, 201, response.content)
        return ListingDraft.objects.get(pk=response.json()["id"])

    def send(self, drafts, owner=None):
        with self.captureOnCommitCallbacks(execute=True):
            return self.call("post", self.url(owner, "send/"), {"draft_ids": [d.pk for d in drafts]})

    def raw(self):
        return TOKEN.search(senders.sms_outbox[-1].body).group(1)


class ScopeTests(DraftBase):
    def test_scout_cannot_draft_for_business_they_do_not_manage(self):
        self.as_staff(self.other_scout)
        self.assertIn(self.product().status_code, (403, 404))
        self.assertEqual(self.call("get", self.url()).status_code, 404)
        self.assertFalse(ListingDraft.objects.exists())

    def test_scout_drafts_for_their_own_business(self):
        self.as_staff(self.scout)
        self.assertEqual(self.product().status_code, 201)

    def test_operations_can_draft_for_any_business(self):
        self.as_staff(self.lead)
        self.assertEqual(self.product().status_code, 201)
        self.assertEqual(ListingDraft.objects.get().created_by, self.lead)

    def test_super_admin_can_draft_for_any_business(self):
        self.as_staff(self.admin)
        self.assertEqual(self.product().status_code, 201)

    def test_general_manager_and_support_get_403_everywhere(self):
        self.as_staff(self.lead)
        draft = self.make_draft()
        for staff in (self.gm, self.support):
            self.as_staff(staff)
            self.assertEqual(self.product().status_code, 403)
            self.assertEqual(self.call("get", self.url()).status_code, 403)
            self.assertEqual(self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "x"}).status_code, 403)
            self.assertEqual(self.call("delete", self.url(tail=f"{draft.pk}/")).status_code, 403)
            self.assertEqual(self.call("post", self.url(tail="send/"), {"draft_ids": [draft.pk]}).status_code, 403)
            self.assertEqual(self.call("post", self.url(tail=f"{draft.pk}/resend/")).status_code, 403)
            photo = self.client.post(f"/api/portfolio/businesses/{self.owner.pk}/photos/", {"image": jpeg()}, format="multipart")
            self.assertEqual(photo.status_code, 403)

    def test_operations_can_stage_a_photo_for_any_business(self):
        self.as_staff(self.lead)
        response = self.client.post(f"/api/portfolio/businesses/{self.owner.pk}/photos/", {"image": jpeg()}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(StagedPhoto.objects.get().uploaded_by, self.lead)

    def test_draft_of_another_business_is_not_found(self):
        self.as_staff(self.lead)
        draft = self.make_draft()
        response = self.call("patch", self.url(self.salon, f"{draft.pk}/"), {"name": "x"})
        self.assertEqual(response.status_code, 404)


class KindTests(DraftBase):
    def setUp(self):
        super().setUp()
        self.as_staff(self.lead)

    def test_draft_per_kind_validates(self):
        ok = self.product()
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.json()["kind"], "product")
        self.assertEqual(ok.json()["status"], "draft")
        service = self.call("post", self.url(self.salon), self.service_body())
        self.assertEqual(service.status_code, 201, service.content)
        stay = self.call("post", self.url(self.salon), self.service_body(
            kind="stay", category=self.stay_cat.pk, name="Room 1", units_total=4, price_amount="300.00", price_unit="night",
        ))
        self.assertEqual(stay.status_code, 201, stay.content)
        event = self.call("post", self.url(), {
            "kind": "event", "category": self.event_cat.pk, "zone": Zone.objects.get(name="Adum").pk, "name": "Launch",
            "description": "Opening party", "address": "Adum high street",
            "event_date": (timezone.now() + timedelta(days=20)).isoformat(), "visibility_days": 30,
        })
        self.assertEqual(event.status_code, 201, event.content)
        self.assertEqual(ListingDraft.objects.count(), 4)
        payload = ListingDraft.objects.get(pk=stay.json()["id"]).payload
        self.assertEqual((payload["units_total"], payload["category"]), (4, self.stay_cat.pk))

    def test_invalid_price_is_400(self):
        for bad in ("abc", "-5", "12.345678"):
            response = self.product(price_amount=bad)
            self.assertEqual(response.status_code, 400, bad)
        self.assertFalse(ListingDraft.objects.exists())

    def test_stay_needs_an_accommodation_category_units_and_a_price(self):
        base = self.service_body(kind="stay", category=self.stay_cat.pk, units_total=2, price_amount="200.00")
        self.assertEqual(self.call("post", self.url(self.salon), {**base, "category": self.service_cat.pk}).status_code, 400)
        self.assertEqual(self.call("post", self.url(self.salon), {**base, "units_total": 0}).status_code, 400)
        no_units = {key: value for key, value in base.items() if key != "units_total"}
        self.assertEqual(self.call("post", self.url(self.salon), no_units).status_code, 400)
        self.assertEqual(self.call("post", self.url(self.salon), {**base, "price_amount": "0"}).status_code, 400)

    def test_a_kind_that_does_not_match_its_category_or_is_unknown_is_400(self):
        self.assertEqual(self.call("post", self.url(self.salon), self.service_body(category=self.stay_cat.pk)).status_code, 400)
        self.assertEqual(self.call("post", self.url(), {"kind": "voucher"}).status_code, 400)
        self.assertEqual(self.call("post", self.url(), {**product_body()}).status_code, 400)

    def test_only_known_fields_are_stored(self):
        response = self.product(status="published", reviewed_by=1, evil="x")
        payload = ListingDraft.objects.get(pk=response.json()["id"]).payload
        self.assertNotIn("status", payload)
        self.assertNotIn("evil", payload)
        self.assertNotIn("kind", payload)

    def test_photos_use_the_staged_photo_pattern(self):
        main = self.staged(by=self.lead)
        gallery = self.staged(by=self.lead, name="b.jpg")
        response = self.product(main_photo_id=main.pk, photo_ids=[gallery.pk])
        self.assertEqual(response.status_code, 201, response.content)
        payload = ListingDraft.objects.get().payload
        self.assertEqual((payload["main_photo_id"], payload["photo_ids"]), (main.pk, [gallery.pk]))
        other = self.staged(owner=self.salon, by=self.lead)
        self.assertEqual(self.product(photo_ids=[other.pk]).status_code, 400)

    def test_a_business_that_is_still_pending_kyc_can_be_drafted_for(self):
        from accounts.models import BusinessOwner

        pending = make_business(self.scout, phone="+233244100400", gps="AK-039-5040", name="New Shop", kyc_status=BusinessOwner.PENDING)
        self.assertEqual(self.product(pending).status_code, 201)

    def test_list_shows_confirmation_state_and_masks_the_contact_phone(self):
        self.product(contact_phone="0241119999")
        response = self.call("get", self.url())
        self.assertEqual(response.status_code, 200)
        item = response.json()[0]
        self.assertEqual(item["confirmation"]["state"], "draft")
        self.assertEqual(item["created_by_name"], self.lead.full_name)
        self.assertNotIn("0241119999", json.dumps(response.json()))
        self.assertNotIn("241119999", json.dumps(response.json()))


class SendAndEditTests(DraftBase):
    def setUp(self):
        super().setUp()
        self.as_staff(self.lead)

    def test_send_texts_the_owner_and_marks_awaiting(self):
        draft = self.make_draft()
        response = self.send([draft])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertEqual(senders.sms_outbox[0].to, "+233244100200")
        draft.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.AWAITING_OWNER)
        item = response.json()[0]
        self.assertEqual(item["status"], "awaiting_owner")
        self.assertEqual(item["confirmation"]["sent_to_masked"], "024 *** 0200")

    def test_send_refusals_map_to_http(self):
        draft = self.make_draft()
        self.send([draft])
        again = self.send([draft])
        self.assertEqual(again.status_code, 409)
        self.assertIn(again.json()["code"], ("still_open", "nothing_new", "not_confirmable"))
        self.assertIn("detail", again.json())
        self.assertEqual(self.call("post", self.url(tail="send/"), {"draft_ids": []}).status_code, 400)
        self.assertEqual(self.call("post", self.url(tail="send/"), {"draft_ids": "x"}).status_code, 400)
        self.assertEqual(self.call("post", self.url(tail="send/"), {"draft_ids": [999999]}).status_code, 404)

    def test_send_is_not_shadowed_by_the_detail_route(self):
        self.assertNotEqual(self.call("post", self.url(tail="send/"), {"draft_ids": []}).status_code, 404)

    def test_editing_draft_after_send_invalidates_confirmation(self):
        draft = self.make_draft()
        self.send([draft])
        raw = self.raw()
        response = self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "Better jollof"})
        self.assertEqual(response.status_code, 200, response.content)
        draft.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.DRAFT)
        self.assertIsNone(draft.confirmation)
        self.assertEqual(draft.payload["name"], "Better jollof")
        self.assertEqual(OwnerConfirmation.objects.get().revoked_at is not None, True)
        with self.assertRaises(ClaimError):
            confirmations.confirm(raw)
        draft.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.DRAFT)

    def test_editing_one_draft_leaves_the_other_awaiting_on_the_live_link(self):
        first, second = self.make_draft(), self.make_draft(name="Waakye")
        self.send([first, second])
        raw = self.raw()
        self.assertEqual(self.call("patch", self.url(tail=f"{first.pk}/"), {"name": "Edited"}).status_code, 200)
        first.refresh_from_db(), second.refresh_from_db()
        self.assertEqual((first.status, first.confirmation), (ListingDraft.DRAFT, None))
        self.assertEqual(second.status, ListingDraft.AWAITING_OWNER)
        self.assertIsNone(second.confirmation.revoked_at)
        confirmations.confirm(raw)
        first.refresh_from_db(), second.refresh_from_db()
        # the owner's business is verified, so the confirmed draft goes straight to the approvals queue (Task 7)
        self.assertEqual((first.status, second.status), (ListingDraft.DRAFT, ListingDraft.SUBMITTED))

    def test_editing_a_lapsed_draft_returns_it_to_draft(self):
        draft = self.make_draft()
        self.send([draft])
        OwnerConfirmation.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.call("get", self.url()).json()[0]["status"], "lapsed")
        self.assertEqual(self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "Again"}).status_code, 200)
        draft.refresh_from_db()
        self.assertEqual((draft.status, draft.confirmation), (ListingDraft.DRAFT, None))

    def test_editing_a_registration_link_draft_keeps_the_registration_link_live(self):
        from accounts.models import BusinessOwner

        owner = make_business(self.scout, phone="+233244100500", gps="AK-039-5050", name="Reg Shop", kyc_status=BusinessOwner.PENDING)
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(owner, self.lead, registration=True)
        draft = self.make_draft(owner)
        self.send([draft], owner)
        link = OwnerConfirmation.objects.filter(business_owner=owner, revoked_at__isnull=True).get()
        self.assertEqual(link.scope, OwnerConfirmation.REGISTRATION)
        self.assertEqual(self.call("delete", self.url(owner, f"{draft.pk}/")).status_code, 200)
        link.refresh_from_db()
        self.assertIsNone(link.revoked_at)

    def test_edit_and_withdraw_are_refused_once_answered_or_submitted(self):
        for status in ("owner_declined", "submitted", "withdrawn"):  # owner_confirmed may be edited or withdrawn (Task 7)
            draft = self.make_draft()
            ListingDraft.objects.filter(pk=draft.pk).update(status=status)
            self.assertEqual(self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "x"}).status_code, 409, status)
            self.assertEqual(self.call("delete", self.url(tail=f"{draft.pk}/")).status_code, 409, status)
            self.assertEqual(ListingDraft.objects.get(pk=draft.pk).status, status)

    def test_withdraw_detaches_and_revokes_an_uncovered_link(self):
        draft = self.make_draft()
        self.send([draft])
        raw = self.raw()
        self.assertEqual(self.call("delete", self.url(tail=f"{draft.pk}/")).status_code, 200)
        draft.refresh_from_db()
        self.assertEqual((draft.status, draft.confirmation), (ListingDraft.WITHDRAWN, None))
        self.assertIsNotNone(OwnerConfirmation.objects.get().revoked_at)
        with self.assertRaises(ClaimError):
            confirmations.confirm(raw)

    def test_a_patch_that_fails_validation_changes_nothing(self):
        draft = self.make_draft()
        self.send([draft])
        self.assertEqual(self.call("patch", self.url(tail=f"{draft.pk}/"), {"price_amount": "abc"}).status_code, 400)
        draft.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.AWAITING_OWNER)
        self.assertIsNone(OwnerConfirmation.objects.get().revoked_at)

    def test_resend_refusals_and_success(self):
        draft = self.make_draft()
        self.assertEqual(self.call("post", self.url(tail=f"{draft.pk}/resend/")).status_code, 409)  # not sent yet
        self.send([draft])
        self.assertEqual(self.call("post", self.url(tail=f"{draft.pk}/resend/")).status_code, 409)  # still open
        OwnerConfirmation.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        with self.captureOnCommitCallbacks(execute=True):
            response = self.call("post", self.url(tail=f"{draft.pk}/resend/"))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(senders.sms_outbox), 2)
        self.assertEqual(response.json()["status"], "awaiting_owner")

    def test_resend_limit_is_429(self):
        draft = self.make_draft()
        self.send([draft])
        for _ in range(3):
            OwnerConfirmation.objects.filter(revoked_at__isnull=True).update(expires_at=timezone.now() - timedelta(minutes=1))
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.call("post", self.url(tail=f"{draft.pk}/resend/")).status_code, 200)
        OwnerConfirmation.objects.filter(revoked_at__isnull=True).update(expires_at=timezone.now() - timedelta(minutes=1))
        response = self.call("post", self.url(tail=f"{draft.pk}/resend/"))
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "rate_limited")

    def test_owner_who_needs_no_text_confirms_at_once(self):
        draft = self.make_draft()
        with mock.patch("portfolio.confirmations.needs_owner_text", return_value=False), \
                mock.patch("portfolio.confirmations._after_owner_confirmed") as seam:
            response = self.send([draft])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(senders.sms_outbox, [])
        draft.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.OWNER_CONFIRMED)
        self.assertEqual(OwnerConfirmation.objects.count(), 0)
        seam.assert_called_once()
        self.assertEqual([d.pk for d in seam.call_args[0][0]], [draft.pk])


class LeakTests(DraftBase):
    def test_draft_response_never_contains_link_or_token(self):
        self.as_staff(self.lead)
        draft = self.make_draft()
        self.send([draft])
        raw = self.raw()
        self.call("get", self.url())
        self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "Renamed"})
        again = self.make_draft(name="Second")
        self.send([again])
        OwnerConfirmation.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        with self.captureOnCommitCallbacks(execute=True):
            self.call("post", self.url(tail=f"{again.pk}/resend/"))
        raw_latest = self.raw()
        self.call("delete", self.url(tail=f"{again.pk}/"))
        self.assertGreater(len(self.responses), 6)
        hashes = list(OwnerConfirmation.objects.values_list("token_hash", flat=True))
        for response in self.responses:
            text = response.content.decode()
            for needle in (raw, raw_latest, "token", "token_hash", "/business/confirm", *hashes):
                self.assertNotIn(needle, text)

    def test_every_write_recorded_in_activity_without_phone(self):
        self.as_staff(self.lead)
        first, second = self.make_draft(), self.make_draft(name="Waakye")
        self.send([first, second])
        raw = self.raw()
        self.call("patch", self.url(tail=f"{first.pk}/"), {"name": "Edited", "contact_phone": "0241119999"})
        OwnerConfirmation.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        with self.captureOnCommitCallbacks(execute=True):
            self.call("post", self.url(tail=f"{second.pk}/resend/"))
        self.call("delete", self.url(tail=f"{second.pk}/"))
        verbs = set(ActivityEvent.objects.values_list("verb", flat=True))
        self.assertTrue({
            "listing_draft.created", "listing_draft.updated", "listing_draft.sent", "listing_draft.withdrawn",
            "listing_draft.resent",
        } <= verbs, verbs)
        for event in ActivityEvent.objects.all():
            text = json.dumps(event.__dict__, default=str)
            for needle in ("0244100200", "244100200", "0241119999", "241119999", raw, "/business/confirm", "token_hash"):
                self.assertNotIn(needle, text, event.verb)


class FixRoundTests(DraftBase):
    def test_an_edit_merges_onto_the_payload_read_under_the_lock(self):
        self.as_staff(self.lead)
        draft = self.make_draft()
        stale = ListingDraft.objects.get(pk=draft.pk)  # what a slow second request read before the first one saved
        self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "First edit"})
        from portfolio import drafts

        drafts.update_draft(self.lead, self.owner, stale, {"description": "Second edit"})
        payload = ListingDraft.objects.get(pk=draft.pk).payload
        self.assertEqual((payload["name"], payload["description"]), ("First edit", "Second edit"))
