"""Catalogue plan 6, Task 8: the barcode matcher files grouping requests and never groups: the backfill for existing
listings, and every newly approved barcoded entry. Review Focus 1 (store codes never match)."""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.db import IntegrityError, OperationalError
from django.test import TestCase

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
        call_command("propose_catalogue_matches", "--dry-run", stdout=out)
        self.assertIn("1 grouping request would be filed.", out.getvalue())
        call_command("propose_catalogue_matches", stdout=out)
        self.assertIn("1 grouping request filed.", out.getvalue())
        self.assertEqual(CatalogueAttachRequest.objects.filter(source=BACKFILL).count(), 1)


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
        self.assertEqual(CatalogueAttachRequest.objects.count(), 1)

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
        selects = [q for q in ctx.captured_queries if q["sql"].startswith("SELECT") and "catalogue_catalogueattachrequest" in q["sql"]]
        self.assertLessEqual(len(selects), 3)
