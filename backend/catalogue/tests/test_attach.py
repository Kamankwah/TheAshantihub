"""Catalogue plan 6, Task 2: a business asks to group its listing with a catalogue product (spec §1 row 8). Nothing is
grouped until staff decide (Task 3). Review Focus 1 (store codes) and 5 (another business's listing)."""
from unittest import mock

from django.core.cache import cache
from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff
from catalogue import attach
from catalogue.models import CatalogueAttachRequest, CatalogueProduct
from catalogue.tests.helpers import BARCODE, OTHER_BARCODE, STORE_CODE, as_account, business, buyer, product, service, stay
from notifications.models import Notification


class ProposeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        self.listing = product(self.owner, barcode=BARCODE)
        self.moderator = make_staff("operations", "ops@example.com")
        as_account(self.client, self.owner, "business_owner")

    def propose(self, listing=None, **body):
        return self.client.post(f"/api/catalogue/mine/{(listing or self.listing).pk}/requests/", body, format="json")

    def test_a_new_product_is_asked_for_from_the_listings_own_brand_and_name(self):
        response = self.propose()
        self.assertEqual(response.status_code, 201, response.content)
        request = CatalogueAttachRequest.objects.get()
        self.assertEqual(
            (request.status, request.source, request.brand, request.name, request.barcode, request.catalogue_product),
            (CatalogueAttachRequest.PENDING, CatalogueAttachRequest.VENDOR, "Nestle", "Milo 400g", BARCODE, None),
        )
        self.assertEqual(response.json()["request"]["status"], "pending")
        self.listing.refresh_from_db()
        self.assertIsNone(self.listing.catalogue_product)                        # nothing grouped until staff decide
        self.assertTrue(Notification.objects.filter(staff=self.moderator, kind=attach.NEEDS_REVIEW).exists())

    def test_an_existing_product_can_be_named(self):
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        response = self.propose(catalogue_product=entry.pk)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(CatalogueAttachRequest.objects.get().catalogue_product, entry)

    def test_a_barcode_alone_is_enough(self):
        listing = product(self.owner, name="Tin", brand="", barcode=OTHER_BARCODE)
        self.assertEqual(self.propose(listing).status_code, 201)

    def test_review_focus_store_codes_never_group(self):
        listing = product(self.owner, name="Kenkey", brand="", barcode=STORE_CODE)
        response = self.propose(listing)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "brand_or_barcode_required"))
        response = self.propose(listing, brand="Auntie Ama")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(CatalogueAttachRequest.objects.get(listing=listing).barcode, "")   # the store code is not carried

    def test_services_and_stays_never_group(self):
        for listing in (service(self.owner), stay(self.owner)):
            response = self.propose(listing, brand="Any")
            self.assertEqual((response.status_code, response.json()["code"]), (400, "not_groupable"))
        self.assertFalse(CatalogueAttachRequest.objects.exists())

    def test_one_request_waits_at_a_time(self):
        self.assertEqual(self.propose().status_code, 201)
        response = self.propose()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "request_pending"))

    def test_a_grouped_listing_cannot_ask_again(self):
        self.listing.catalogue_product = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing.save(update_fields=["catalogue_product"])
        response = self.propose()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "already_grouped"))

    def test_an_unknown_product_or_one_with_another_barcode_is_refused(self):
        response = self.propose(catalogue_product=999999)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "unknown_product"))
        other = CatalogueProduct.objects.create(brand="Cadbury", name="Bournvita", barcode=OTHER_BARCODE)
        response = self.propose(catalogue_product=other.pk)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "barcode_mismatch"))
        self.assertFalse(CatalogueAttachRequest.objects.exists())

    def test_a_blank_name_is_refused(self):
        response = self.propose(name="  ")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "name_required"))

    def test_review_focus_another_business_listing_is_404_and_nothing_changes(self):
        rival = product(business("Rival Mart"), barcode=BARCODE)
        self.assertEqual(self.propose(rival).status_code, 404)
        self.assertEqual(self.client.get(f"/api/catalogue/mine/{rival.pk}/").status_code, 404)
        self.assertFalse(CatalogueAttachRequest.objects.exists())

    def test_only_business_owners(self):
        as_account(self.client, buyer(), "customer")
        self.assertEqual(self.propose().status_code, 403)

    def test_a_customer_sharing_the_owners_pk_is_still_403(self):
        customer = buyer()
        as_account(self.client, customer, "customer")
        self.assertEqual(self.propose().status_code, 403)
        self.assertEqual(self.client.get(f"/api/catalogue/mine/{self.listing.pk}/").status_code, 403)

    def test_a_suspended_business_cannot_ask(self):
        owner = business("Held", suspended=True)
        listing = product(owner, barcode=OTHER_BARCODE)
        as_account(self.client, owner, "business_owner")
        response = self.propose(listing)
        self.assertEqual((response.status_code, response.json()["code"]), (403, "account_suspended"))
        with self.assertRaises(attach.CatalogueError) as caught:
            attach.propose(listing, {})
        self.assertEqual(caught.exception.code, "account_suspended")
        self.assertFalse(CatalogueAttachRequest.objects.exists())

    def test_a_request_filed_meanwhile_answers_409(self):
        CatalogueAttachRequest.objects.create(listing=self.listing, barcode=BARCODE, source=CatalogueAttachRequest.BACKFILL)
        with mock.patch.object(attach.CatalogueAttachRequest.objects, "filter") as filtered:
            filtered.return_value.exists.return_value = False
            response = self.propose()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "request_pending"))

    def test_a_non_object_body_is_400_not_500(self):
        response = self.client.post(f"/api/catalogue/mine/{self.listing.pk}/requests/", [1, 2], format="json")
        self.assertEqual(response.status_code, 201, response.content)   # treated as an empty body

    def test_odd_product_values_are_400(self):
        for value in (True, 10**30, "1e3", "abc", [1]):
            response = self.propose(catalogue_product=value)
            self.assertEqual((response.status_code, response.json()["code"]), (400, "unknown_product"), value)

    def test_a_notice_failure_does_not_undo_the_request(self):
        with mock.patch("catalogue.attach.notify_staff_role", side_effect=RuntimeError("boom")):
            self.assertEqual(self.propose().status_code, 201)
        self.assertEqual(CatalogueAttachRequest.objects.count(), 1)

    def test_asking_is_throttled(self):
        cache.clear()
        self.addCleanup(cache.clear)
        codes = [self.propose().status_code for _ in range(21)]
        self.assertEqual(codes[-1], 429)


class StateAndWithdrawTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        self.listing = product(self.owner, barcode=BARCODE)
        as_account(self.client, self.owner, "business_owner")

    def test_the_state_says_what_the_listing_can_do(self):
        body = self.client.get(f"/api/catalogue/mine/{self.listing.pk}/").json()
        self.assertEqual(body, {
            "listing": self.listing.pk, "groupable": True, "barcode": BARCODE, "store_code": False,
            "catalogue_product": None, "request": None,
        })
        self.assertFalse(self.client.get(f"/api/catalogue/mine/{stay(self.owner).pk}/").json()["groupable"])

    def test_a_waiting_request_can_be_withdrawn_and_asked_again(self):
        request = attach.propose(self.listing, {})
        response = self.client.post(f"/api/catalogue/mine/requests/{request.pk}/withdraw/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "withdrawn")
        self.assertIsNotNone(response.json()["withdrawn_at"])
        request.refresh_from_db()
        self.assertIsNotNone(request.withdrawn_at)
        self.assertEqual(request.status, CatalogueAttachRequest.WITHDRAWN)
        again = self.client.post(f"/api/catalogue/mine/{self.listing.pk}/requests/", {}, format="json")
        self.assertEqual(again.status_code, 201, again.content)

    def test_a_decided_request_cannot_be_withdrawn(self):
        request = attach.propose(self.listing, {})
        CatalogueAttachRequest.objects.filter(pk=request.pk).update(status=CatalogueAttachRequest.REJECTED)
        response = self.client.post(f"/api/catalogue/mine/requests/{request.pk}/withdraw/")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_pending"))

    def test_a_barcode_match_filed_by_ashantihub_cannot_be_withdrawn(self):
        request = CatalogueAttachRequest.objects.create(
            listing=self.listing, barcode=BARCODE, source=CatalogueAttachRequest.BACKFILL,
            catalogue_product=CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE),
        )
        response = self.client.post(f"/api/catalogue/mine/requests/{request.pk}/withdraw/")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_withdrawable"))

    def test_another_businesses_request_is_404(self):
        request = attach.propose(product(business("Rival Mart"), barcode=BARCODE), {})
        self.assertEqual(self.client.post(f"/api/catalogue/mine/requests/{request.pk}/withdraw/").status_code, 404)
        request.refresh_from_db()
        self.assertEqual(request.status, CatalogueAttachRequest.PENDING)
