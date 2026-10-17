"""Catalogue plan 6, Task 3: staff decide grouping requests through the moderated-queue contract (backend/CLAUDE.md)
and may ungroup a listing. Review Focus 5 (grouped meanwhile, decided twice, re-review with another request waiting)."""
from datetime import timedelta

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from catalogue import attach
from catalogue.models import CatalogueAttachRequest, CatalogueProduct
from catalogue.errors import CatalogueError
from catalogue.tests.helpers import BARCODE, OTHER_BARCODE, as_account, as_staff, business, product, service
from activity.models import ActivityEvent
from listings.models import Category
from notifications.models import Notification

QUEUE = "/api/catalogue/staff/requests/pending/"


def url(request, action=""):
    return f"/api/catalogue/staff/requests/{request.pk}/{action + '/' if action else ''}"


class QueueTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = as_staff(self.client, "operations", "ops@example.com")
        self.owner = business()
        self.first = attach.propose(product(self.owner, "Milo 400g", barcode=BARCODE), {})
        self.second = attach.propose(product(self.owner, "Milo 900g", brand="Nestle"), {})
        CatalogueAttachRequest.objects.filter(pk=self.first.pk).update(created_at=timezone.now() - timedelta(hours=2))

    def ids(self, query=""):
        response = self.client.get(QUEUE + query)
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()["results"]]

    def test_pending_is_the_default_oldest_first(self):
        self.assertEqual(self.ids(), [self.first.pk, self.second.pk])
        self.assertEqual(self.ids("?status=nonsense"), [self.first.pk, self.second.pk])   # unknown falls back to pending

    def test_history_tabs_newest_decision_first(self):
        attach.reject(self.first.pk, self.staff, "Not a branded product.")
        attach.reject(self.second.pk, self.staff, "Duplicate.")
        CatalogueAttachRequest.objects.filter(pk=self.first.pk).update(reviewed_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(self.ids("?status=rejected"), [self.second.pk, self.first.pk])
        self.assertEqual(self.ids("?status=approved"), [])
        self.assertEqual(self.ids(), [])

    def test_only_listing_moderators(self):
        as_staff(self.client, "accountant", "acc@example.com")
        self.assertEqual(self.client.get(QUEUE).status_code, 403)
        self.assertEqual(self.client.post(url(self.first, "approve"), {}, format="json").status_code, 403)

    def test_a_row_shows_the_listing_the_ask_and_existing_matches(self):
        CatalogueProduct.objects.create(brand="Nestle", name="Milo 900g")
        row = self.client.get(url(self.second)).json()
        self.assertEqual(row["listing"]["name"], "Milo 900g")
        self.assertEqual(row["listing"]["business_name"], "Adepa Ventures")
        self.assertEqual((row["brand"], row["name"], row["status"]), ("Nestle", "Milo 900g", "pending"))
        self.assertEqual([m["name"] for m in row["matches"]], ["Milo 900g"])

    def test_the_queue_costs_the_same_queries_whatever_its_length(self):
        def queries():
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.client.get(QUEUE).status_code, 200)
            return len(captured)

        before = queries()
        for n in range(4):
            attach.propose(product(self.owner, f"Tin {n}", brand="Nestle"), {})
        self.assertEqual(queries(), before)


class DecisionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = as_staff(self.client, "operations", "ops@example.com")
        self.owner = business()
        self.listing = product(self.owner, barcode=BARCODE)
        self.request = attach.propose(self.listing, {})

    def approve(self, request=None, **body):
        return self.client.post(url(request or self.request, "approve"), body, format="json")

    def test_approving_makes_the_product_and_groups_the_listing(self):
        response = self.approve()
        self.assertEqual(response.status_code, 200, response.content)
        entry = CatalogueProduct.objects.get()
        self.assertEqual(
            (entry.brand, entry.name, entry.barcode, entry.normalised_name, entry.created_by),
            ("Nestle", "Milo 400g", BARCODE, "nestle milo 400g", self.staff),
        )
        self.assertEqual(response.json()["catalogue_product"]["id"], entry.pk)
        self.listing.refresh_from_db()
        self.request.refresh_from_db()
        self.assertEqual(self.listing.catalogue_product, entry)
        self.assertEqual(
            (self.request.status, self.request.catalogue_product, self.request.reviewed_by),
            (CatalogueAttachRequest.APPROVED, entry, self.staff),
        )
        self.assertIsNotNone(self.request.reviewed_at)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, kind=attach.GROUPED).exists())

    def test_a_barcode_already_in_the_catalogue_joins_that_product(self):
        entry = CatalogueProduct.objects.create(brand="Nestlé", name="Milo Tin 400 g", barcode=BARCODE)
        self.assertEqual(self.approve().status_code, 200)
        self.listing.refresh_from_db()
        self.assertEqual((self.listing.catalogue_product, CatalogueProduct.objects.count()), (entry, 1))

    def test_staff_may_correct_the_name_or_point_it_at_another_product(self):
        sachet = attach.propose(product(self.owner, "Milo sachet", brand="Nestle"), {})
        response = self.approve(sachet, brand="Nestlé", name="Milo Sachet 20 g")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(CatalogueProduct.objects.get(name="Milo Sachet 20 g").brand, "Nestlé")
        target = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g")
        response = self.approve(catalogue_product=target.pk)
        self.assertEqual(response.status_code, 200, response.content)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.catalogue_product, target)

    def test_a_product_with_another_barcode_is_refused(self):
        other = CatalogueProduct.objects.create(brand="Cadbury", name="Bournvita", barcode=OTHER_BARCODE)
        response = self.approve(catalogue_product=other.pk)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "barcode_mismatch"))
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, CatalogueAttachRequest.PENDING)

    def test_review_focus_approving_after_the_listing_was_grouped_is_409(self):
        self.listing.catalogue_product = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g")
        self.listing.save(update_fields=["catalogue_product"])
        response = self.approve()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "already_grouped"))
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, CatalogueAttachRequest.PENDING)

    def test_a_request_is_decided_once(self):
        self.assertEqual(self.approve().status_code, 200)
        for action in ("approve", "reject"):
            response = self.client.post(url(self.request, action), {"reason": "x"}, format="json")
            self.assertEqual((response.status_code, response.json()["code"]), (409, "not_pending"), action)
        self.assertEqual(CatalogueProduct.objects.count(), 1)

    def test_rejecting_needs_a_reason_and_tells_the_business(self):
        response = self.client.post(url(self.request, "reject"), {"reason": "  "}, format="json")
        self.assertEqual((response.status_code, response.json()), (400, {"reason": attach.REASON_REQUIRED}))
        response = self.client.post(url(self.request, "reject"), {"reason": "Not a branded product."}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.request.refresh_from_db()
        self.assertEqual(
            (self.request.status, self.request.rejection_reason, self.request.reviewed_by),
            (CatalogueAttachRequest.REJECTED, "Not a branded product.", self.staff),
        )
        notice = Notification.objects.get(business_owner=self.owner, kind=attach.NOT_GROUPED)
        self.assertIn("Not a branded product.", notice.body)

    def test_re_review_only_from_rejected_and_it_clears_the_decision(self):
        response = self.client.post(url(self.request, "re-review"))
        self.assertEqual((response.status_code, response.json()["code"]), (400, "not_rejected"))
        attach.reject(self.request.pk, self.staff, "Blurry.")
        response = self.client.post(url(self.request, "re-review"))
        self.assertEqual(response.status_code, 200, response.content)
        self.request.refresh_from_db()
        self.assertEqual(
            (self.request.status, self.request.rejection_reason, self.request.reviewed_by, self.request.reviewed_at),
            (CatalogueAttachRequest.PENDING, None, None, None),
        )

    def test_review_focus_re_review_with_another_request_waiting_is_409(self):
        attach.reject(self.request.pk, self.staff, "Blurry.")
        attach.propose(self.listing, {"brand": "Nestle", "name": "Milo 400 g"})
        response = self.client.post(url(self.request, "re-review"))
        self.assertEqual((response.status_code, response.json()["code"]), (409, "request_pending"))


class DetachTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = as_staff(self.client, "operations", "ops@example.com")
        self.owner = business()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing = product(self.owner, barcode=BARCODE, catalogue_product=self.entry)

    def detach(self, listing_id, reason="Wrong product."):
        return self.client.post(f"/api/catalogue/staff/listings/{listing_id}/detach/", {"reason": reason}, format="json")

    def test_staff_ungroup_with_a_reason_and_the_business_is_told(self):
        response = self.detach(self.listing.pk)
        self.assertEqual(response.status_code, 200, response.content)
        self.listing.refresh_from_db()
        self.assertIsNone(self.listing.catalogue_product)
        self.assertTrue(CatalogueProduct.objects.filter(pk=self.entry.pk).exists())         # the entry stays for others
        notice = Notification.objects.get(business_owner=self.owner, kind=attach.UNGROUPED)
        self.assertIn("Wrong product.", notice.body)

    def test_a_reason_is_needed_an_ungrouped_listing_is_409_and_an_unknown_one_404(self):
        self.assertEqual(self.detach(self.listing.pk, " ").json(), {"reason": attach.REASON_REQUIRED})
        self.assertEqual(self.detach(self.listing.pk).status_code, 200)
        response = self.detach(self.listing.pk)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_grouped"))
        self.assertEqual(self.detach(999999).status_code, 404)

    def test_a_business_cannot_ungroup_itself(self):
        as_account(self.client, self.owner, "business_owner")
        self.assertEqual(self.detach(self.listing.pk).status_code, 403)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.catalogue_product, self.entry)


class ReviewFixTests(TestCase):
    """Task 3 review round: suspended owners, audit targets, changed barcodes, duplicate names, parsing, notices."""

    def setUp(self):
        self.client = APIClient()
        self.staff = as_staff(self.client, "operations", "ops@example.com")
        self.owner = business()
        self.listing = product(self.owner, barcode=BARCODE)
        self.request = attach.propose(self.listing, {})

    def post(self, request, action, **body):
        return self.client.post(url(request, action), body, format="json")

    def test_a_suspended_owner_is_not_grouped_and_the_queue_says_so(self):
        self.owner.is_suspended = True
        self.owner.save()
        response = self.post(self.request, "approve")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "account_suspended"))
        self.assertTrue(self.client.get(url(self.request)).json()["listing"]["business_suspended"])
        self.assertEqual(CatalogueProduct.objects.count(), 0)

    def test_re_review_refuses_grouped_ungroupable_and_suspended(self):
        attach.reject(self.request.pk, self.staff, "No.")
        self.owner.is_suspended = True
        self.owner.save()
        self.assertEqual(self.post(self.request, "re-review").json()["code"], "account_suspended")
        self.owner.is_suspended = False
        self.owner.save()
        self.listing.category = Category.objects.get(slug="lifestyle")
        self.listing.save()
        self.assertEqual(self.post(self.request, "re-review").json()["code"], "not_groupable")
        self.listing.category = Category.objects.get(slug="grocery")
        self.listing.catalogue_product = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g")
        self.listing.save()
        self.assertEqual(self.post(self.request, "re-review").json()["code"], "already_grouped")
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, CatalogueAttachRequest.REJECTED)

    def test_audit_events_carry_a_target(self):
        self.assertEqual(self.post(self.request, "approve").status_code, 200)
        event = ActivityEvent.objects.get(verb="catalogue-staff-approve")
        self.assertEqual((event.target_type, event.target_id), ("catalogue.catalogueattachrequest", str(self.request.pk)))
        reject = attach.propose(product(self.owner, "Other", brand="Nestle"), {})
        self.post(reject, "reject", reason="No")
        self.assertEqual(ActivityEvent.objects.get(verb="catalogue-staff-reject").target_type,
                         "catalogue.catalogueattachrequest")

    def test_ungroup_records_the_listing_and_the_old_entry(self):
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g")
        other = product(self.owner, "Milo 2", barcode=OTHER_BARCODE, catalogue_product=entry)
        response = self.client.post(f"/api/catalogue/staff/listings/{other.pk}/detach/", {"reason": "Wrong"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        events = ActivityEvent.objects.filter(target_type="listings.listing", target_id=str(other.pk))
        self.assertTrue(any(e.before == {"catalogue_product": entry.pk} and e.after == {"catalogue_product": None}
                            for e in events))

    def test_a_changed_barcode_needs_an_explicit_product(self):
        self.listing.barcode = OTHER_BARCODE
        self.listing.save()
        response = self.post(self.request, "approve")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "barcode_changed"))
        target = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=OTHER_BARCODE)
        self.assertEqual(self.post(self.request, "approve", catalogue_product=target.pk).status_code, 200)

    def test_an_existing_name_must_be_chosen_or_overridden(self):
        existing = CatalogueProduct.objects.create(brand="Nestle", name="Milo Sachet")
        first = attach.propose(product(self.owner, "Milo Sachet", brand="Nestle"), {})
        response = self.post(first, "approve")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "match_exists"))
        self.assertEqual([m["id"] for m in response.json()["matches"]], [existing.pk])
        self.assertEqual(CatalogueProduct.objects.count(), 1)
        self.assertEqual(self.post(first, "approve", new=True).status_code, 200)
        self.assertEqual(CatalogueProduct.objects.count(), 2)

    def test_two_sequential_approvals_of_one_new_name_do_not_duplicate(self):
        one = attach.propose(product(self.owner, "Gino Tin", brand="Gino"), {})
        two = attach.propose(product(self.owner, "Gino Tin", brand="Gino"), {})
        self.assertEqual(self.post(one, "approve").status_code, 200)
        self.assertEqual(self.post(two, "approve").json()["code"], "match_exists")
        entry = CatalogueProduct.objects.get(name="Gino Tin")
        self.assertEqual(self.post(two, "approve", catalogue_product=entry.pk).status_code, 200)

    def test_one_parser_for_entry_ids(self):
        listing = product(self.owner, "Parse", brand="Nestle")
        for value in (True, float("inf"), 3.9, "1e400", 10**30, [1], "abc"):
            with self.assertRaises(CatalogueError) as caught:
                attach.propose(listing, {"catalogue_product": value})
            self.assertEqual(caught.exception.code, "unknown_product", value)
            with self.assertRaises(CatalogueError) as caught:
                attach.approve(self.request.pk, self.staff, {"catalogue_product": value})
            self.assertEqual(caught.exception.code, "unknown_product", value)

    def test_the_grouped_notice_claims_no_other_offers(self):
        self.post(self.request, "approve")
        body = Notification.objects.get(business_owner=self.owner, kind=attach.GROUPED).body
        self.assertIn("now part of the catalogue entry", body)
        self.assertNotIn("other businesses", body)

    def test_rejecting_a_backfill_request_sends_no_notice(self):
        CatalogueAttachRequest.objects.filter(pk=self.request.pk).update(source=CatalogueAttachRequest.BACKFILL)
        self.assertEqual(self.post(self.request, "reject", reason="No").status_code, 200)
        self.assertFalse(Notification.objects.filter(business_owner=self.owner, kind=attach.NOT_GROUPED).exists())

    def test_history_orders_by_review_time_not_creation(self):
        older = attach.propose(product(self.owner, "Old", brand="Nestle"), {})
        CatalogueAttachRequest.objects.filter(pk=older.pk).update(created_at=timezone.now() - timedelta(days=5))
        attach.reject(self.request.pk, self.staff, "a")
        attach.reject(older.pk, self.staff, "b")
        CatalogueAttachRequest.objects.filter(pk=self.request.pk).update(reviewed_at=timezone.now() - timedelta(hours=3))
        self.assertEqual(
            [r["id"] for r in self.client.get(QUEUE + "?status=rejected").json()["results"]], [older.pk, self.request.pk])

    def test_history_tab_costs_the_same_queries_whatever_its_length(self):
        def queries():
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.client.get(QUEUE + "?status=rejected").status_code, 200)
            return len(captured)

        attach.reject(self.request.pk, self.staff, "a")
        before = queries()
        for n in range(3):
            extra = attach.propose(product(self.owner, f"H{n}", brand="Nestle"), {})
            attach.reject(extra.pk, self.staff, "b")
        self.assertEqual(queries(), before)

    def test_approve_404_not_groupable_and_unknown_product(self):
        self.assertEqual(self.client.post("/api/catalogue/staff/requests/999999/approve/", {}, format="json").status_code, 404)
        self.assertEqual(self.post(self.request, "approve", catalogue_product=999999).json()["code"], "unknown_product")
        self.listing.category = Category.objects.get(slug="lifestyle")
        self.listing.save()
        self.assertEqual(self.post(self.request, "approve").json()["code"], "not_groupable")

    def test_the_reason_is_capped_at_500_and_support_is_refused(self):
        self.post(self.request, "reject", reason="x" * 800)
        self.request.refresh_from_db()
        self.assertEqual(len(self.request.rejection_reason), 500)
        as_staff(self.client, "support", "sup@example.com")
        self.assertEqual(self.client.get(QUEUE).status_code, 403)

    def test_approve_updates_only_the_catalogue_product_column_of_the_listing(self):
        with CaptureQueriesContext(connection) as captured:
            self.assertEqual(self.post(self.request, "approve").status_code, 200)
        updates = [q["sql"] for q in captured if q["sql"].startswith('UPDATE "listings_listing"')]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0].split(" WHERE")[0].count("="), 1)
        self.assertIn('"catalogue_product_id"', updates[0])
