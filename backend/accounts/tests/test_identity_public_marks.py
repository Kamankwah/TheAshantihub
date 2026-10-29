"""Task 7: the public verified mark follows approved identity documents, not the address check. A business that is
KYC-verified (address checked, may publish) but has no approved identity has no mark; approving listings still needs
kyc_status; and no Ghana Card or registration detail reaches a public response."""
import importlib
import itertools

from django.apps import apps
from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from catalogue import offers
from catalogue.models import CatalogueProduct
from catalogue.tests.helpers import BARCODE, product
from events.models import Event
from listings.models import Category, Listing, Zone
from marketplace import events as marketplace_events
from messaging import context as desk_context

_seq = itertools.count(1)


def owner(name="Shop", *, kyc=BusinessOwner.VERIFIED, identity=BusinessOwnerProfile.IDENTITY_NOT_SUBMITTED, **profile):
    n = next(_seq)
    business = BusinessOwner.objects.create(
        full_name=f"Owner {n}", login_phone=f"+23326{n:07d}", password_hash="x", kyc_status=kyc,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=business, business_name=f"{name} {n}", identity_status=identity, **profile,
    )
    return business


def listing(business, name="Kente cloth"):
    return Listing.objects.create(
        business_owner=business, category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"),
        name=name, description="D.", contact_phone="+233207000000", price_amount="10.00", status=Listing.PUBLISHED,
    )


VERIFIED = BusinessOwnerProfile.IDENTITY_VERIFIED


class IdentityPublicMarkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def results(self, query=""):
        response = self.client.get(f"/api/listings/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def test_kyc_verified_business_without_identity_has_identity_verified_false(self):
        item = listing(owner(kyc=BusinessOwner.VERIFIED))
        row = self.results()[0]
        self.assertEqual(row["id"], item.pk)
        self.assertEqual(row["business_owner"]["kyc_status"], "verified")        # kept for older clients
        self.assertIs(row["business_owner"]["identity_verified"], False)

    def test_business_with_verified_identity_has_true(self):
        listing(owner(identity=VERIFIED))
        self.assertIs(self.results()[0]["business_owner"]["identity_verified"], True)

    def test_verified_filter_returns_only_identity_verified_listings(self):
        marked = listing(owner("Marked", kyc=BusinessOwner.PENDING, identity=VERIFIED), "Marked")
        listing(owner("Address only", kyc=BusinessOwner.VERIFIED), "Address only")
        listing(owner("Nothing", kyc=BusinessOwner.PENDING), "Nothing")
        self.assertEqual([r["id"] for r in self.results("?verified=true")], [marked.pk])
        self.assertEqual(len(self.results("?verified=false")), 3)

    def test_kyc_verified_unverified_identity_listing_still_publishes(self):
        business = owner(kyc=BusinessOwner.VERIFIED)
        item = listing(business)
        item.status = Listing.PENDING_REVIEW
        item.save(update_fields=["status"])
        ops = make_staff("operations", "ops-marks@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(ops)}")
        response = self.client.post(f"/api/listings/moderation/{item.pk}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        item.refresh_from_db()
        self.assertEqual(item.status, Listing.PUBLISHED)

    def test_pre_migration_verified_business_keeps_mark(self):
        # Verified by the old KYC flow: its documents are on file, identity is still "none" until the backfill runs.
        business = owner(
            kyc=BusinessOwner.VERIFIED, ghana_card_number="GHA-100000001-1",
            ghana_card_front_image="ghana_cards/front.jpg", ghana_card_back_image="ghana_cards/back.jpg",
        )
        listing(business)
        self.assertIs(self.results()[0]["business_owner"]["identity_verified"], False)
        importlib.import_module("accounts.migrations.0062_identity_status").backfill_identity(apps, None)
        self.assertIs(self.results()[0]["business_owner"]["identity_verified"], True)
        self.assertEqual([r["business_owner"]["id"] for r in self.results("?verified=true")], [business.pk])

    def test_public_listing_response_has_no_ghana_card_fields(self):
        business = owner(
            identity=VERIFIED, ghana_card_number="GHA-100000009-9", ghana_card_front_image="ghana_cards/front.jpg",
            ghana_card_back_image="ghana_cards/back.jpg", business_reg_certificate="business_reg_certificates/cert.pdf",
        )
        item = listing(business)
        for path in ("/api/listings/", f"/api/listings/{item.pk}/"):
            body = self.client.get(path).content.decode().lower()
            self.assertNotIn("ghana_card", body)
            self.assertNotIn("business_reg", body)
            self.assertNotIn("gha-100000009", body)
            self.assertNotIn("cert.pdf", body)

    def test_listing_list_query_count_does_not_grow_with_rows(self):
        listing(owner(identity=VERIFIED))
        listing(owner())
        with CaptureQueriesContext(connection) as few:
            self.results()
        for _ in range(4):
            listing(owner(identity=VERIFIED))
        with CaptureQueriesContext(connection) as many:
            self.assertEqual(len(self.results()), 6)
        self.assertEqual(len(many), len(few))


class IdentityOfferMarkTests(TestCase):
    def setUp(self):
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)

    def live(self, business, price):
        return product(business, price=price, catalogue_product=self.entry)

    def test_featured_offer_skips_business_without_identity(self):
        cheap = self.live(owner("No identity", kyc=BusinessOwner.VERIFIED), "10.00")
        marked = self.live(owner("Marked", kyc=BusinessOwner.PENDING, identity=VERIFIED), "20.00")
        found = offers.featured(offers.live_offers(self.entry.pk))
        self.assertEqual(found.pk, marked.pk)
        self.assertNotEqual(found.pk, cheap.pk)
        marked.business_owner.profile.identity_status = BusinessOwnerProfile.IDENTITY_NOT_SUBMITTED
        marked.business_owner.profile.save()
        self.assertIsNone(offers.featured(offers.live_offers(self.entry.pk)))

    def test_offer_row_verified_follows_identity(self):
        plain = self.live(owner(kyc=BusinessOwner.VERIFIED), "10.00")
        marked = self.live(owner(identity=VERIFIED), "11.00")
        by_pk = {o.pk: o for o in offers.live_offers(self.entry.pk)}
        self.assertIs(offers.offer_row(by_pk[plain.pk])["verified"], False)
        self.assertIs(offers.offer_row(by_pk[marked.pk])["verified"], True)


class IdentityOrganiserAndDeskMarkTests(TestCase):
    def event(self, business):
        return Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"),
            submitted_by_business=business, name="Night", description="D.", address="Manhyia",
            event_date=timezone.now(), visibility_days=14, status=Event.APPROVED,
        )

    def test_event_organiser_verified_follows_identity(self):
        plain = marketplace_events.organiser(self.event(owner(kyc=BusinessOwner.VERIFIED)))
        marked = marketplace_events.organiser(self.event(owner(kyc=BusinessOwner.PENDING, identity=VERIFIED)))
        self.assertIs(plain["verified"], False)
        self.assertIs(marked["verified"], True)

    def test_support_desk_business_verified_follows_identity(self):
        self.assertIs(desk_context._business(owner(kyc=BusinessOwner.VERIFIED))["verified"], False)
        self.assertIs(desk_context._business(owner(kyc=BusinessOwner.PENDING, identity=VERIFIED))["verified"], True)
