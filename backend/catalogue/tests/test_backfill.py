"""Catalogue plan 6, Task 8: the barcode matcher files grouping requests and never groups: the backfill for existing
listings, and every newly approved barcoded entry. Review Focus 1 (store codes never match)."""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.db import IntegrityError, OperationalError
from django.test import TestCase, override_settings

from accounts.testing import make_staff
from catalogue import attach
from catalogue.models import CatalogueAttachRequest, CatalogueProduct
from catalogue.tests.helpers import BARCODE, STORE_CODE, business, product, service
from listings.models import Listing
from notifications.models import Notification

BACKFILL, PENDING = CatalogueAttachRequest.BACKFILL, CatalogueAttachRequest.PENDING


class BarcodeMatcherTests(TestCase):
    def setUp(self):
        self.moderator = make_staff("operations", "ops@example.com")
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.match = product(business("Kumasi Mart"), barcode=BARCODE)

    def test_a_matching_listing_gets_a_request_and_stays_ungrouped(self):
        self.assertEqual(attach.propose_barcode_matches(), 1)
        request = CatalogueAttachRequest.objects.get()
        self.assertEqual(
            (request.listing, request.catalogue_product, request.source, request.status, request.barcode),
            (self.match, self.entry, BACKFILL, PENDING, BARCODE),
        )
        self.match.refresh_from_db()
        self.assertIsNone(self.match.catalogue_product)
        self.assertEqual(Notification.objects.filter(staff=self.moderator, kind=attach.NEEDS_REVIEW).count(), 1)

    def test_running_twice_files_once(self):
        self.assertEqual(attach.propose_barcode_matches(), 1)
        self.assertEqual(attach.propose_barcode_matches(), 0)

    def test_what_is_never_matched(self):
        product(business("Grouped"), barcode=BARCODE, catalogue_product=CatalogueProduct.objects.create(brand="X", name="Y"))
        turned_down = product(business("Turned Down"), barcode=BARCODE)
        CatalogueAttachRequest.objects.create(
            listing=turned_down, catalogue_product=self.entry, barcode=BARCODE, status=CatalogueAttachRequest.REJECTED,
        )
        withdrawn = product(business("Withdrawn"), barcode=BARCODE)
        CatalogueAttachRequest.objects.create(
            listing=withdrawn, catalogue_product=self.entry, barcode=BARCODE, status=CatalogueAttachRequest.WITHDRAWN,
        )
        product(business("No Barcode"))
        salon = service(business("Salon"))
        Listing.objects.filter(pk=salon.pk).update(barcode=BARCODE)
        CatalogueProduct.objects.create(brand="Corner Shop", name="Kenkey", barcode=STORE_CODE)
        product(business("Store Code"), barcode=STORE_CODE)
        self.assertEqual(attach.propose_barcode_matches(), 1)
        self.assertEqual(CatalogueAttachRequest.objects.get(source=BACKFILL).listing, self.match)

    def test_a_listing_with_a_request_waiting_is_left_alone(self):
        attach.propose(self.match, {})
        self.assertEqual(attach.propose_barcode_matches(), 0)

    def test_a_dry_run_files_nothing(self):
        self.assertEqual(attach.propose_barcode_matches(dry_run=True), 1)
        self.assertFalse(CatalogueAttachRequest.objects.exists())
        self.assertFalse(Notification.objects.exists())

    def test_the_command(self):
        out = StringIO()
        call_command("propose_catalogue_matches", stdout=out)   # a dry run by default
        self.assertIn("1 grouping request would be filed", out.getvalue())
        self.assertFalse(CatalogueAttachRequest.objects.exists())
        call_command("propose_catalogue_matches", "--apply", stdout=out)
        self.assertIn("1 grouping request filed.", out.getvalue())
        self.assertIn("skipped 0, raced 0, failed 0.", out.getvalue())
        self.assertEqual(CatalogueAttachRequest.objects.filter(source=BACKFILL).count(), 1)


@override_settings(CATALOGUE_MATCHER_ENABLED=True)
class ApprovalMatchesTests(TestCase):
    def test_a_new_barcoded_product_files_requests_for_its_other_listings(self):
        staff = make_staff("operations", "ops@example.com")
        first = product(business("Adepa Ventures"), barcode=BARCODE)
        second = product(business("Kumasi Mart"), barcode=BARCODE)
        request = attach.propose(first, {})
        with self.captureOnCommitCallbacks(execute=True):   # the matcher runs once the approval has committed
            _, entry = attach.approve(request.pk, staff)
        filed = CatalogueAttachRequest.objects.get(source=BACKFILL)
        self.assertEqual((filed.listing, filed.catalogue_product, filed.status), (second, entry, PENDING))
        second.refresh_from_db()
        self.assertIsNone(second.catalogue_product)


class StaffDecisionTests(TestCase):
    def setUp(self):
        self.staff = make_staff("operations", "ops@example.com")
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)

    def test_a_listing_staff_ungrouped_is_not_filed_again(self):
        listing = product(business("Kumasi Mart"), barcode=BARCODE)
        request = attach.propose(listing, {})
        attach.approve(request.pk, self.staff)
        attach.detach(listing.pk, "Wrong product.", self.staff)
        request.refresh_from_db()
        self.assertIsNotNone(request.ungrouped_at)
        self.assertEqual(request.ungrouped_by, self.staff)
        self.assertEqual(attach.propose_barcode_matches(), 0)

    def test_a_suspended_owner_is_skipped(self):
        product(business("Held", suspended=True), barcode=BARCODE)
        self.assertEqual(attach.propose_barcode_matches(), 0)

    def test_a_matcher_insert_that_loses_the_race_is_skipped(self):
        product(business("A"), barcode=BARCODE)
        with mock.patch.object(CatalogueAttachRequest.objects, "create", side_effect=IntegrityError):
            self.assertEqual(attach.propose_barcode_matches(), 0)

    def test_a_deadlock_is_logged_and_the_run_continues(self):
        first = product(business("A"), barcode=BARCODE)
        second = product(business("B"), barcode=BARCODE)
        real = CatalogueAttachRequest.objects.create
        def flaky(**kw):
            if kw["listing"] == first:
                raise OperationalError("deadlock detected")
            return real(**kw)
        with mock.patch.object(CatalogueAttachRequest.objects, "create", side_effect=flaky):
            with self.assertLogs("catalogue.attach", "WARNING") as logs:
                self.assertEqual(attach.propose_barcode_matches(), 1)
        self.assertIn("OperationalError", logs.output[0])
        self.assertEqual(CatalogueAttachRequest.objects.get().listing, second)

    def test_a_notice_failure_does_not_raise(self):
        product(business("A"), barcode=BARCODE)
        with mock.patch.object(attach, "notify_staff_role", side_effect=RuntimeError):
            self.assertEqual(attach.propose_barcode_matches(), 1)

    def test_few_queries_for_many_listings(self):
        for n in range(6):
            product(business(f"Shop {n}"), barcode=BARCODE)
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(attach.propose_barcode_matches(), 6)
        # The chunk's own reads are constant; only the per-listing lock-and-recheck grows with the number filed.
        scans = [q for q in ctx.captured_queries if q["sql"].startswith("SELECT") and "FOR UPDATE" not in q["sql"]
                 and ("COUNT" not in q["sql"]) and "LIMIT 1" not in q["sql"] and "EXISTS" not in q["sql"]]
        self.assertLessEqual(len([q for q in scans if "listings_listing" in q["sql"] and "LIMIT 500" in q["sql"]]), 2)


    def test_chunks_cover_every_listing(self):
        for n in range(4):
            product(business(f"Shop {n}"), barcode=BARCODE)
        out = StringIO()
        call_command("propose_catalogue_matches", "--apply", "--batch-size", "2", stdout=out)
        self.assertEqual(CatalogueAttachRequest.objects.filter(source=BACKFILL).count(), 4)

    def test_only_published_listings_are_matched(self):
        for status in (Listing.DRAFT, Listing.PENDING_REVIEW, Listing.REJECTED):
            product(business(f"S {status}"), barcode=BARCODE, status=status)
        live = product(business("Live"), barcode=BARCODE)
        self.assertEqual(attach.propose_barcode_matches(), 1)
        self.assertEqual(CatalogueAttachRequest.objects.get().listing, live)

    def test_a_real_constraint_collision_is_skipped(self):
        product(business("Racer"), barcode=BARCODE)
        calls = []
        real = attach._is_declined
        def racing(declined, listing_id, entry):
            calls.append(listing_id)
            if len(calls) == 2:   # under the listing lock, just before the insert: the business files its own request
                CatalogueAttachRequest.objects.create(listing_id=listing_id, brand="Nestle", name="Milo")
            return real(declined, listing_id, entry)
        stats = {}
        with mock.patch.object(attach, "_is_declined", side_effect=racing):
            self.assertEqual(attach.propose_barcode_matches(stats=stats), 0)
        self.assertEqual(stats["raced"], 1)


@override_settings(CATALOGUE_MATCHER_ENABLED=True)
class ApprovalHookTests(TestCase):
    def setUp(self):
        self.staff = make_staff("operations", "ops@example.com")
        self.first = product(business("Adepa Ventures"), barcode=BARCODE)
        self.second = product(business("Kumasi Mart"), barcode=BARCODE)

    def approve(self, listing, data=None, execute=False):
        request = attach.propose(listing, {})
        with self.captureOnCommitCallbacks(execute=execute) as callbacks:
            _, entry = attach.approve(request.pk, self.staff, data)
        return request, entry, callbacks

    def test_it_runs_on_commit_not_before(self):
        _, entry, callbacks = self.approve(self.first)
        self.assertEqual(len(callbacks), 1)
        self.assertFalse(CatalogueAttachRequest.objects.filter(source=BACKFILL).exists())
        callbacks[0]()
        self.assertEqual(CatalogueAttachRequest.objects.get(source=BACKFILL).listing, self.second)

    @override_settings(CATALOGUE_MATCHER_ENABLED=False)
    def test_the_switch_off_files_nothing_on_approve(self):
        _, entry, callbacks = self.approve(self.first, execute=True)
        self.assertEqual(entry.barcode, BARCODE)                                    # a new barcoded entry was made
        self.assertFalse(CatalogueAttachRequest.objects.filter(source=BACKFILL).exists())

    def test_the_switch_on_files_the_other_listing_on_approve(self):
        self.approve(self.first, execute=True)
        self.assertEqual(CatalogueAttachRequest.objects.get(source=BACKFILL).listing, self.second)

    def test_a_matcher_failure_never_fails_the_approval(self):
        request = attach.propose(self.first, {})
        with mock.patch.object(attach, "propose_barcode_matches", side_effect=RuntimeError("boom")):
            with self.assertLogs("catalogue.attach", "WARNING"):
                with self.captureOnCommitCallbacks(execute=True):
                    attach.approve(request.pk, self.staff)
        request.refresh_from_db()
        self.assertEqual(request.status, CatalogueAttachRequest.APPROVED)

    def test_only_a_new_barcoded_entry_runs_it(self):
        CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        _, _, callbacks = self.approve(self.first)   # joins the existing entry: nothing new
        self.assertEqual(callbacks, [])
        plain = product(business("Plain"), name="Kenkey", brand="Corner", barcode="")
        _, _, callbacks = self.approve(plain)         # a new entry without a barcode
        self.assertEqual(callbacks, [])


@override_settings(CATALOGUE_MATCHER_ENABLED=True)
class DecisionOnBarcodeTests(TestCase):
    def test_a_rejected_new_entry_request_for_the_barcode_is_honoured(self):
        staff = make_staff("operations", "ops@example.com")
        first = product(business("Turned Down"), barcode=BARCODE)
        rejected = attach.propose(first, {})
        attach.reject(rejected.pk, staff, "No.")
        second = product(business("Kumasi Mart"), barcode=BARCODE)
        request = attach.propose(second, {})
        with self.captureOnCommitCallbacks(execute=True):
            _, entry = attach.approve(request.pk, staff)
        self.assertIsNone(rejected.catalogue_product_id)
        self.assertFalse(CatalogueAttachRequest.objects.filter(source=BACKFILL).exists())
