"""Catalogue plan 6, Task 1: what makes two listings the same product, the catalogue entry, and a listing's barcode
(spec §1 row 8). Review Focus 1 (one barcode typed different ways; store codes)."""
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from catalogue import identity
from catalogue.models import CatalogueProduct, product_row
from catalogue.tests.helpers import BARCODE, STORE_CODE, as_account, business, product
from listings.models import Category, Listing, Zone
from listings.serializers import GROUPED_BARCODE_MESSAGE, NOT_GOODS_MESSAGE


class BarcodeTests(SimpleTestCase):
    def test_review_focus_one_product_typed_three_ways_is_one_key(self):
        # The UPC-A on a tin, the same code as an EAN-13 with its leading zero, and with the gaps printed on the pack.
        self.assertEqual(identity.clean_barcode("036000291452"), "00036000291452")
        self.assertEqual(identity.clean_barcode("0036000291452"), "00036000291452")
        self.assertEqual(identity.clean_barcode(" 0 36000 29145 2 "), "00036000291452")
        self.assertEqual(identity.clean_barcode("4006-3813-3393-1"), BARCODE)

    def test_eight_and_fourteen_digit_codes(self):
        self.assertEqual(identity.clean_barcode("73513537"), "00000073513537")
        self.assertEqual(identity.clean_barcode("00012345600012"), "00012345600012")

    def test_a_upc_e_is_the_same_product_as_its_upc_a(self):
        # An 8-digit code starting 0 or 1 whose check digit holds over its UPC-A expansion is a UPC-E (small packs and cans).
        self.assertEqual(identity.clean_barcode("01234565"), identity.clean_barcode("012345000065"))
        self.assertEqual(identity.clean_barcode("01234565"), "00012345000065")

    def test_an_ean8_the_upc_e_reading_captures_maps_to_the_upc_a_key(self):
        # Accepted: about a tenth of valid 0/1-prefixed EAN-8s also check as a UPC-E and are keyed as its UPC-A.
        self.assertEqual(identity.clean_barcode("12345670"), "00123456000070")

    def test_gtin14_isbn_and_repeated_digit_codes(self):
        self.assertEqual(identity.clean_barcode("14006381333938"), "14006381333938")   # indicator digit 1
        self.assertEqual(identity.clean_barcode("9780306406157"), "09780306406157")    # ISBN-13 is an EAN-13
        self.assertEqual(identity.clean_barcode("1111111111116"), "01111111111116")    # valid check digit, repeated digits
        with self.assertRaises(identity.BarcodeError):
            identity.clean_barcode("1111111111111")

    def test_blank_is_no_barcode(self):
        for raw in ("", "   ", None):
            self.assertEqual(identity.clean_barcode(raw), "")

    def test_a_wrong_check_digit_letters_wrong_length_or_all_zeros_are_refused(self):
        for raw in ("4006381333932", "40063813339X1", "123456789", "١٢٣٤٥٦٧٨", "00000000"):
            with self.subTest(raw=raw), self.assertRaises(identity.BarcodeError):
                identity.clean_barcode(raw)
        with self.assertRaisesMessage(identity.BarcodeError, identity.CHECK_DIGIT_MESSAGE):
            identity.clean_barcode("4006381333932")

    def test_review_focus_store_codes_never_group(self):
        self.assertTrue(identity.is_store_code(STORE_CODE))                                  # EAN-13 prefix 200
        self.assertTrue(identity.is_store_code(identity.clean_barcode("0212345678909")))      # EAN-13 prefix 021
        self.assertTrue(identity.is_store_code(identity.clean_barcode("412345678903")))       # UPC-A number system 4
        self.assertTrue(identity.is_store_code(identity.clean_barcode("20000004")))           # GTIN-8 starting 2
        for key in (BARCODE, "00036000291452", "00000073513537", ""):
            self.assertFalse(identity.is_store_code(key), key)


class NameTests(SimpleTestCase):
    def test_accents_case_and_punctuation_do_not_matter(self):
        self.assertEqual(identity.normalise_name("Nestlé", "MILO  Activ-Go, 400g"), "nestle milo activ go 400g")
        self.assertEqual(identity.normalise_name("", "Milo"), "milo")
        self.assertEqual(identity.normalise_name(None, "  "), "")

    def test_akan_and_ewe_letters_are_kept(self):
        self.assertEqual(identity.normalise_name("", "Kɔkɔɔ Ɛnam"), "kɔkɔɔ ɛnam")


class CatalogueProductTests(TestCase):
    def test_the_normalised_name_is_kept_on_save(self):
        entry = CatalogueProduct.objects.create(brand="Nestlé", name="Milo 400g", barcode=BARCODE)
        self.assertEqual(entry.normalised_name, "nestle milo 400g")
        self.assertEqual(product_row(entry), {"id": entry.pk, "brand": "Nestlé", "name": "Milo 400g", "barcode": BARCODE})
        self.assertIsNone(product_row(None))

    def test_a_barcode_belongs_to_one_entry(self):
        CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        with self.assertRaises(IntegrityError), transaction.atomic():
            CatalogueProduct.objects.create(brand="Nestle", name="Milo tin", barcode=BARCODE)
        CatalogueProduct.objects.create(brand="Nestle", name="Nido")                      # many entries may have none
        CatalogueProduct.objects.create(brand="Nestle", name="Nescafe")

    def test_an_entry_needs_a_brand_or_a_barcode(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            CatalogueProduct.objects.create(name="Tomatoes")


class ListingBarcodeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        self.listing = product(self.owner)
        as_account(self.client, self.owner, "business_owner")

    def manage(self, barcode):
        return self.client.patch(f"/api/listings/mine/{self.listing.pk}/manage/", {"barcode": barcode}, format="json")

    def test_the_barcode_is_kept_as_its_fourteen_digit_key(self):
        response = self.manage("0 36000 29145 2")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["barcode"], "00036000291452")
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.barcode, "00036000291452")

    def test_a_mistyped_barcode_is_refused(self):
        response = self.manage("4006381333932")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["barcode"], [identity.CHECK_DIGIT_MESSAGE])

    def test_a_grouped_listing_keeps_its_products_barcode(self):
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing.barcode, self.listing.catalogue_product = BARCODE, entry
        self.listing.save(update_fields=["barcode", "catalogue_product"])
        refused = self.manage("5000112637922")
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()["barcode"], [GROUPED_BARCODE_MESSAGE])
        self.assertEqual(self.manage("4006381333931").status_code, 200)

    def test_a_grouped_listing_without_a_barcode_can_send_its_form_unchanged(self):
        self.listing.catalogue_product = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing.save(update_fields=["catalogue_product"])
        self.assertEqual(self.manage("").status_code, 200)
        self.assertEqual(self.manage("5000112637922").status_code, 400)

    def test_an_owner_edit_never_writes_back_a_grouping_or_a_stock_count_it_read(self):
        from listings.serializers import OwnerListingManageSerializer
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        stale = Listing.objects.get(pk=self.listing.pk)
        Listing.objects.filter(pk=self.listing.pk).update(catalogue_product=entry, stock_quantity=3)  # staff; a checkout
        serializer = OwnerListingManageSerializer(stale, data={"price_amount": "26.00"}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        self.listing.refresh_from_db()
        self.assertEqual(
            (self.listing.catalogue_product, self.listing.stock_quantity, str(self.listing.price_amount)), (entry, 3, "26.00"),
        )

    @override_settings(SUBSCRIPTIONS_ENABLED=False)
    def test_a_new_listing_can_carry_a_barcode(self):
        response = self.client.post("/api/listings/mine/", {
            "category": Category.objects.get(slug="grocery").pk, "zone": Zone.objects.get(name="Manhyia").pk,
            "name": "Milo 400g", "description": "A tin.", "price_amount": "25.00", "contact_phone": "+233209999999",
            "has_warranty": False, "has_expiry": False, "return_policy": "Unopened, within 7 days.",
            "barcode": "4006381333931",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["barcode"], BARCODE)

    def test_the_owner_form_serializer_never_writes_back_a_grouping_or_stock_it_read(self):
        from listings.serializers import OwnerListingSerializer
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing.status = Listing.DRAFT
        self.listing.save(update_fields=["status"])
        stale = Listing.objects.get(pk=self.listing.pk)
        Listing.objects.filter(pk=self.listing.pk).update(catalogue_product=entry, stock_quantity=3)
        request = type("R", (), {"user": self.owner})()
        serializer = OwnerListingSerializer(stale, data={"tag": "new"}, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        self.listing.refresh_from_db()
        self.assertEqual((self.listing.catalogue_product, self.listing.stock_quantity, self.listing.tag), (entry, 3, "new"))

    def test_deleting_a_catalogue_entry_leaves_its_offers_standing_alone(self):
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing.catalogue_product = entry
        self.listing.save(update_fields=["catalogue_product"])
        entry.delete()
        self.listing.refresh_from_db()
        self.assertIsNone(self.listing.catalogue_product)

    def test_a_barcode_on_a_service_or_stay_is_refused(self):
        from catalogue.tests.helpers import service, stay
        for listing in (service(self.owner), stay(self.owner)):
            with self.subTest(listing=listing.name):
                response = self.client.patch(
                    f"/api/listings/mine/{listing.pk}/manage/", {"barcode": BARCODE}, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["barcode"], [NOT_GOODS_MESSAGE])
                self.assertEqual(
                    self.client.patch(f"/api/listings/mine/{listing.pk}/manage/", {"barcode": ""}, format="json").status_code, 200)

    def test_a_food_listing_can_carry_a_barcode(self):
        food = product(self.owner, "Bottled water", category="food")                 # kind=service, is_food
        response = self.client.patch(f"/api/listings/mine/{food.pk}/manage/", {"barcode": BARCODE}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        food.refresh_from_db()
        self.assertEqual(food.barcode, BARCODE)

    def test_the_public_listing_shape_is_unchanged(self):
        self.client.credentials()
        body = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        self.assertNotIn("barcode", body)
        self.assertNotIn("catalogue_product", body)
