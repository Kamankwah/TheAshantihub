"""Package M5: hero checks and the contact-details guard, events reject reason,
promotion checks and fraud hold, category usage counts, period analytics and the
Marketing report section."""
import io
import tempfile
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image

from accounts.models import BusinessOwner, Customer
from billing.models import Subscription, SubscriptionPlan
from events.models import Event
from fraud.models import FraudFlag
from listings.models import Category, HeroMediaSubmission, Listing, ListingPhoto, Promotion, Zone
from listings.moderation_checks import contact_details_in
from marketing import report_provider
from marketing.tests.base import MarketingBase
from reports import providers

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def image(name="hero.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


class ContactDetailsTests(MarketingBase):
    def test_finds_each_kind_of_contact_detail(self):
        for text, kind in [
            ("Call 0244 123 456 today", "phone"),
            ("ring +233 24 412 3456", "phone"),
            ("write to ama@shop.com", "email"),
            ("ama [at] shop [dot] com", "email"),
            ("see www.kente.shop", "link"),
            ("https://kente.example/buy", "link"),
            ("kentehub.com/sale", "link"),
            ("Chat on WhatsApp", "whatsapp"),
            ("whats app us", "whatsapp"),
        ]:
            self.assertEqual(contact_details_in(text), kind, text)

    def test_ordinary_captions_pass(self):
        for text in ["Hand-woven kente, 3 yards, GH₵ 450", "Open 8am to 6pm, Mon-Sat", "Since 1998 in Kejetia", ""]:
            self.assertIsNone(contact_details_in(text), text)


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class HeroChecksTests(MarketingBase):
    def setUp(self):
        super().setUp()
        self.owner = BusinessOwner.objects.create(full_name="Ama Trader", login_phone="+233207991133", password_hash="x", kyc_status=BusinessOwner.VERIFIED)
        self.plan = SubscriptionPlan.objects.get(tier="service")
        now = timezone.now()
        Subscription.objects.create(business_owner=self.owner, plan=self.plan, current_period_start=now, current_period_end=now + timedelta(days=30))
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.filter(kind="product").first(), zone=Zone.objects.first(),
            name="Kente", description="x", contact_phone="0200000000", status=Listing.PUBLISHED,
        )
        self.photo = ListingPhoto.objects.create(listing=self.listing, image=image("kente.jpg"))

    def submission(self, caption="Hand-woven kente", media=None, listing="default"):
        return HeroMediaSubmission.objects.create(
            business_owner=self.owner, listing=self.listing if listing == "default" else listing,
            media=media or image("kente.jpg"), caption=caption,
        )

    def pending(self):
        self.as_staff(self.akua)
        return self.client.get("/api/listings/hero/pending/").json()

    def check(self, row, key):
        return next(c for c in row["checks"] if c["key"] == key)

    def test_pending_rows_carry_server_computed_checks(self):
        self.submission()
        rows = self.pending()
        rows = rows["results"] if isinstance(rows, dict) else rows
        row = rows[0]
        self.assertEqual({c["key"] for c in row["checks"]}, {"photo", "kyc", "subscription", "caption_length", "contact_details", "hero_slots"})
        self.assertEqual(self.check(row, "photo")["status"], "pass")
        self.assertEqual(self.check(row, "kyc")["status"], "pass")
        self.assertEqual(self.check(row, "subscription")["status"], "pass")
        self.assertEqual(self.check(row, "contact_details")["status"], "pass")
        self.assertEqual(self.check(row, "hero_slots")["detail"], "0 of 1 hero slot in use.")
        self.assertTrue(row["can_approve"])
        self.assertEqual(row["listing_name"], "Kente")

    def test_checks_fail_for_unverified_unpaid_foreign_photo(self):
        self.owner.kyc_status = BusinessOwner.PENDING
        self.owner.save()
        Subscription.objects.filter(business_owner=self.owner).update(current_period_end=timezone.now() - timedelta(days=3))
        self.submission(media=image("someone-elses.jpg"))
        rows = self.pending()
        row = (rows["results"] if isinstance(rows, dict) else rows)[0]
        self.assertEqual(self.check(row, "photo")["status"], "warn")
        self.assertEqual(self.check(row, "kyc")["status"], "fail")
        self.assertEqual(self.check(row, "subscription")["status"], "fail")

    def test_slot_check_fails_when_the_plan_is_full(self):
        live = self.submission()
        live.status = HeroMediaSubmission.APPROVED
        live.expires_at = timezone.now() + timedelta(days=5)
        live.save()
        self.submission()
        rows = self.pending()
        row = (rows["results"] if isinstance(rows, dict) else rows)[0]
        self.assertEqual(self.check(row, "hero_slots")["status"], "fail")

    def test_contact_details_block_approval_server_side(self):
        sub = self.submission(caption="Order on WhatsApp 0244123456")
        self.as_staff(self.akua)
        response = self.client.post(f"/api/listings/hero/{sub.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "contact_details_in_caption")
        self.assertIn("never contacted directly", response.json()["detail"])
        sub.refresh_from_db()
        self.assertEqual(sub.status, HeroMediaSubmission.PENDING)
        row = self.client.get(f"/api/listings/hero/{sub.id}/").json()
        self.assertFalse(row["can_approve"])

    def test_clean_caption_approves(self):
        sub = self.submission()
        self.as_staff(self.akua)
        response = self.client.post(f"/api/listings/hero/{sub.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        sub.refresh_from_db()
        self.assertEqual(sub.status, HeroMediaSubmission.APPROVED)

    def test_rejecting_a_contact_caption_still_works_and_needs_a_reason(self):
        sub = self.submission(caption="email me ama@shop.com")
        self.as_staff(self.akua)
        self.assertEqual(self.client.post(f"/api/listings/hero/{sub.id}/reject/", {}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/listings/hero/{sub.id}/reject/", {"reason": "Contact details"}, format="json").status_code, 200)

    def test_recent_decisions_are_the_callers_own(self):
        mine = self.submission()
        theirs = self.submission(caption="Other")
        self.as_staff(self.akua)
        self.client.post(f"/api/listings/hero/{mine.id}/reject/", {"reason": "Blurry"}, format="json")
        self.as_staff(self.boss)
        self.client.post(f"/api/listings/hero/{theirs.id}/reject/", {"reason": "Off topic"}, format="json")
        self.as_staff(self.akua)
        rows = self.client.get("/api/listings/hero/my-decisions/").json()
        self.assertEqual([r["id"] for r in rows], [mine.id])
        self.assertEqual(rows[0]["status"], "rejected")
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/listings/hero/my-decisions/").status_code, 403)


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class EventReasonTests(MarketingBase):
    def test_reject_needs_a_reason(self):
        customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200771133", password_hash="x")
        event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"), submitted_by_customer=customer,
            name="Durbar", description="x", address="Manhyia", event_date=timezone.now() + timedelta(days=30), visibility_days=14,
        )
        self.as_staff(self.akua)
        self.assertEqual(self.client.post(f"/api/events/moderation/{event.id}/reject/", {"reason": "  "}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/events/moderation/{event.id}/reject/", {"reason": "Not an event"}, format="json").status_code, 200)
        event.refresh_from_db()
        self.assertEqual(event.rejection_reason, "Not an event")


class PromotionChecksTests(MarketingBase):
    def setUp(self):
        super().setUp()
        self.owner = BusinessOwner.objects.create(full_name="Ama Trader", login_phone="+233207991133", password_hash="x", kyc_status=BusinessOwner.VERIFIED)
        now = timezone.now()
        Subscription.objects.create(
            business_owner=self.owner, plan=SubscriptionPlan.objects.get(tier="service"),
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.filter(kind="product").first(), zone=Zone.objects.first(),
            name="Kente", description="x", contact_phone="0200000000", status=Listing.PUBLISHED,
        )

    def promo(self, **extra):
        now = timezone.now()
        fields = dict(listing=self.listing, kind=Promotion.FEATURED, starts_at=now, ends_at=now + timedelta(days=7), amount_paid=Decimal("35.00"))
        fields.update(extra)
        return Promotion.objects.create(**fields)

    def rows(self, status="pending"):
        self.as_staff(self.akua)
        data = self.client.get(f"/api/listings/promotions/?status={status}").json()
        return data["results"] if isinstance(data, dict) else data

    def test_row_check_line_days_and_slot(self):
        self.promo()
        row = self.rows()[0]
        self.assertEqual([c["key"] for c in row["checks"]], ["kyc", "subscription", "listing_live"])
        self.assertTrue(all(c["status"] == "pass" for c in row["checks"]))
        self.assertIsNone(row["fraud_hold"])
        self.assertIsNone(row["slot"])
        self.assertEqual(row["paid_days"], 7)

    def test_checks_flag_unverified_and_unpublished(self):
        self.owner.kyc_status = BusinessOwner.PENDING
        self.owner.save()
        self.listing.status = Listing.DRAFT
        self.listing.save()
        self.promo()
        statuses = {c["key"]: c["status"] for c in self.rows()[0]["checks"]}
        self.assertEqual(statuses["kyc"], "fail")
        self.assertEqual(statuses["listing_live"], "fail")

    def test_days_left_for_an_active_promotion(self):
        self.promo(status=Promotion.ACTIVE)
        self.assertEqual(self.rows("active")[0]["days_left"], 7)

    def test_open_fraud_case_holds_the_promotion_and_names_the_case_owner(self):
        self.owner.account_manager = self.scout
        self.owner.save()
        promo = self.promo()
        FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.STAFF, title="Looks fake", business_owner=self.owner)
        row = self.rows()[0]
        self.assertEqual(row["fraud_hold"]["case_owner_name"], self.scout.full_name)
        response = self.client.post(f"/api/listings/promotions/{promo.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "fraud_hold")
        self.assertIn(self.scout.full_name, response.json()["detail"])
        promo.refresh_from_db()
        self.assertEqual(promo.status, Promotion.PENDING)

    def test_decided_fraud_case_no_longer_holds(self):
        promo = self.promo()
        FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.STAFF, title="Old", business_owner=self.owner, status=FraudFlag.DISMISSED)
        self.as_staff(self.akua)
        self.assertEqual(self.client.post(f"/api/listings/promotions/{promo.id}/approve/", {}, format="json").status_code, 200)

    def test_pending_list_query_count_does_not_grow_with_rows(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        self.promo()
        self.as_staff(self.akua)
        self.client.get("/api/listings/promotions/?status=pending")  # warm caches
        with CaptureQueriesContext(connection) as one:
            self.client.get("/api/listings/promotions/?status=pending")
        for _ in range(3):
            self.promo()
        with CaptureQueriesContext(connection) as four:
            self.client.get("/api/listings/promotions/?status=pending")
        self.assertEqual(len(four), len(one))


class CategoryUsageTests(MarketingBase):
    def test_staff_list_has_usage_counts_in_one_query_shape(self):
        category = Category.objects.create(slug="usage", icon="x", label="Usage", color="#111111", kind=Category.PRODUCT)
        owner = BusinessOwner.objects.create(full_name="Ama", login_phone="+233207991133", password_hash="x")
        zone = Zone.objects.first()
        for i in range(2):
            Listing.objects.create(business_owner=owner, category=category, zone=zone, name=f"L{i}", description="x", contact_phone="0200000000")
        customer = Customer.objects.create(full_name="Kofi", phone="+233200771133", password_hash="x")
        Event.objects.create(
            category=category, zone=zone, submitted_by_customer=customer, name="E", description="x", address="a",
            event_date=timezone.now() + timedelta(days=3), visibility_days=7,
        )
        self.as_staff(self.akua)
        rows = {r["slug"]: r for r in self.client.get("/api/listings/categories/").json()}
        self.assertEqual((rows["usage"]["listing_count"], rows["usage"]["event_count"]), (2, 1))
        self.assertEqual(rows[Category.objects.exclude(pk=category.pk).first().slug]["listing_count"], 0)

    def test_public_list_has_no_counts(self):
        self.client.credentials()
        rows = self.client.get("/api/listings/categories/").json()
        self.assertNotIn("listing_count", rows[0])

    def test_delete_in_use_names_events_too(self):
        category = Category.objects.create(slug="evuse", icon="x", label="Ev", color="#111111", kind=Category.PRODUCT)
        customer = Customer.objects.create(full_name="Kofi", phone="+233200771133", password_hash="x")
        Event.objects.create(
            category=category, zone=Zone.objects.first(), submitted_by_customer=customer, name="E", description="x", address="a",
            event_date=timezone.now() + timedelta(days=3), visibility_days=7,
        )
        self.as_staff(self.akua)
        response = self.client.delete(f"/api/listings/categories/{category.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("1 event use this category", response.json()["detail"])


class PeriodAnalyticsTests(MarketingBase):
    def test_period_param_and_counts(self):
        Customer.objects.create(full_name="New", phone="+233200771133", password_hash="x")
        old = Customer.objects.create(full_name="Old", phone="+233200771134", password_hash="x")
        Customer.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=20))
        self.as_staff(self.akua)
        week = self.client.get("/api/marketing/analytics/?days=7").json()
        month = self.client.get("/api/marketing/analytics/?days=30").json()
        self.assertEqual((week["days"], week["customers"]), (7, 1))
        self.assertEqual((month["days"], month["customers"]), (30, 2))
        self.assertEqual(self.client.get("/api/marketing/analytics/?days=5").json()["days"], 30)

    def test_opt_ins_say_none_recorded_when_the_ledger_is_empty_or_absent(self):
        self.as_staff(self.akua)
        tile = self.client.get("/api/marketing/analytics/?days=7").json()["opt_ins"]
        self.assertEqual((tile["state"], tile["note"]), ("not_tracked", "No opt-ins recorded yet."))
        with mock.patch("marketing.period_stats.apps.get_model", side_effect=LookupError):
            tile = self.client.get("/api/marketing/analytics/?days=7").json()["opt_ins"]
        self.assertEqual(tile["state"], "not_tracked")

    def test_opt_ins_count_the_ledger_in_the_period(self):
        from marketing.models import ConsentRecord

        customer = Customer.objects.create(full_name="Kofi", phone="+233200771133", password_hash="x")
        ConsentRecord.objects.create(customer=customer, channel="sms", status="opted_in", source="settings")
        ConsentRecord.objects.create(customer=customer, channel="email", status="opted_out", source="settings")
        self.as_staff(self.akua)
        tile = self.client.get("/api/marketing/analytics/?days=7").json()["opt_ins"]
        self.assertEqual((tile["state"], tile["opted_in"], tile["opted_out"]), ("tracked", 1, 1))

    def test_export_formats_and_permission(self):
        self.as_staff(self.akua)
        response = self.client.get("/api/marketing/analytics/?days=7&format=csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        self.assertIn(b"New customers", b"".join(response.streaming_content) if response.streaming else response.content)
        self.assertEqual(self.client.get("/api/marketing/analytics/?days=7&format=bogus").status_code, 400)
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/marketing/analytics/").status_code, 403)


class MarketingReportProviderTests(MarketingBase):
    def test_registered_and_counts_only_real_records(self):
        self.assertIn(report_provider.marketing_sections, providers._ROLE_PROVIDERS["marketing"])
        owner = BusinessOwner.objects.create(full_name="Ama", login_phone="+233207991133", password_hash="x")
        sub = HeroMediaSubmission.objects.create(business_owner=owner, media=image(), caption="Kente", status=HeroMediaSubmission.APPROVED, reviewed_by=self.akua, reviewed_at=timezone.now())
        HeroMediaSubmission.objects.create(business_owner=owner, media=image("b.jpg"), caption="x", status=HeroMediaSubmission.REJECTED, reviewed_by=self.boss, reviewed_at=timezone.now())
        today = date.today()
        sections = {s["key"]: {r["label"]: r["value"] for r in s["rows"]} for s in providers.system_sections(self.akua, today, today)}
        self.assertEqual(sections["marketing_moderation"]["Hero approved"], 1)
        self.assertEqual(sections["marketing_moderation"]["Hero rejected"], 0)
        self.assertEqual(sections["marketing_promotions"]["Running now"], 0)
        self.assertEqual(sections["marketing_promotions"]["Promotion revenue (GH₵)"], "0.00")
        self.assertNotIn("marketing_campaigns", sections)
        self.assertIsNotNone(sub)

    def test_extra_sections_hook(self):
        def extra(staff, start, end):
            return [{"key": "x", "title": "X", "rows": []}]

        report_provider.EXTRA_SECTIONS.append(extra)
        try:
            today = date.today()
            self.assertIn("x", [s["key"] for s in providers.system_sections(self.akua, today, today)])
        finally:
            report_provider.EXTRA_SECTIONS.remove(extra)

    def test_other_roles_do_not_get_marketing_sections(self):
        today = date.today()
        keys = [s["key"] for s in providers.system_sections(self.scout, today, today)]
        self.assertNotIn("marketing_moderation", keys)
