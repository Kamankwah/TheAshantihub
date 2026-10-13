from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.db.utils import InternalError
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from activity.models import ActivityEvent
from bookings.models import Booking  # noqa: F401
from listings.models import Category, Listing, Zone
from marketing import audience, consent
from marketing.models_consent import AppendOnlyError, ConsentRecord, ConsentWording, Segment
from orders.models import Order, OrderItem

from .base import MarketingBase


def make_customer(n, **extra):
    return Customer.objects.create(full_name=f"Customer {n}", phone=f"+23324400{n:04d}", email=f"c{n}@example.com", password_hash="x", **extra)


def make_owner(n, zone=None):
    owner = BusinessOwner.objects.create(full_name=f"Owner {n}", login_phone=f"+23320500{n:04d}", email=f"o{n}@example.com", password_hash="x")
    BusinessOwnerProfile.objects.create(business_owner=owner, business_name=f"Shop {n}", zone=zone)
    return owner


class LedgerTests(MarketingBase):
    def test_it_starts_empty_and_wordings_exist(self):
        self.assertEqual(ConsentRecord.objects.count(), 0)
        self.assertEqual(ConsentWording.objects.filter(version=1).count(), 8)

    def test_records_are_appended_never_changed(self):
        c = make_customer(1)
        first = consent.record_consent(c, "sms", True, "settings")
        self.assertEqual(first.wording_text, ConsentWording.objects.get(code="sms-offers").text)
        self.assertIsNone(consent.record_consent(c, "sms", True, "settings"))     # unchanged: no duplicate line
        consent.record_consent(c, "sms", False, "unsubscribe_link")
        self.assertEqual(ConsentRecord.objects.filter(customer=c).count(), 2)
        self.assertFalse(consent.is_opted_in(c, "sms"))
        first.status = "opted_out"
        with self.assertRaises(AppendOnlyError):
            first.save()
        with self.assertRaises(AppendOnlyError):
            first.delete()
        with self.assertRaises(AppendOnlyError):
            ConsentRecord.objects.filter(pk=first.pk).update(status="opted_out")
        with self.assertRaises(AppendOnlyError):
            ConsentRecord.objects.all().delete()

    def test_the_database_refuses_changes_too(self):
        row = consent.record_consent(make_customer(2), "email", True, "signup")
        with self.assertRaises(InternalError), connection.cursor() as cursor:
            cursor.execute("UPDATE marketing_consentrecord SET status = 'opted_out' WHERE id = %s", [row.pk])

    def test_nothing_is_backfilled_from_the_service_message_preference(self):
        Customer.objects.create(full_name="Old", phone="+233244999999", password_hash="x", sms_notifications_enabled=True)
        self.assertEqual(ConsentRecord.objects.count(), 0)

    def test_opt_out_keeps_the_words_that_person_agreed_to(self):
        c = make_customer(3)
        consent.record_consent(c, "email", True, "signup")
        old = ConsentWording.objects.get(code="email-offers")
        ConsentWording.objects.create(code="email-offers", version=2, channel="email", audience="customer", text="New words.")
        old.retired_at = timezone.now()
        old.save()
        out = consent.record_consent(c, "email", False, "unsubscribe_link")
        self.assertEqual(out.wording, old)
        self.assertEqual(consent.live_wording("customer", "email").version, 2)

    def test_a_stop_for_someone_never_asked_is_still_recorded(self):
        c = make_customer(4)
        self.assertIsNotNone(consent.record_consent(c, "sms", False, "unsubscribe_link"))

    def test_only_ticked_boxes_are_recorded_at_signup(self):
        c = make_customer(5)
        made = consent.capture_at_signup(c, {"sms": True, "email": False, "bogus": True, "inapp": "yes"})
        self.assertEqual([r.channel for r in made], ["sms"])
        self.assertEqual(consent.capture_at_signup(c, "nonsense"), [])


class SignupCaptureTests(MarketingBase):
    def test_customer_registration_records_only_ticked_boxes(self):
        response = self.client.post("/api/accounts/customers/register/", {"full_name": "Yaw", "phone": "0244123456", "password": "Password123!", "marketing_consent": {"sms": True, "email": False}}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        customer = Customer.objects.get(pk=response.json()["id"])
        rows = ConsentRecord.objects.filter(customer=customer)
        self.assertEqual([(r.channel, r.status, r.source) for r in rows], [("sms", "opted_in", "signup")])
        self.assertNotIn("marketing_consent", response.json())

    def test_registration_without_boxes_records_nothing(self):
        response = self.client.post("/api/accounts/customers/register/", {"full_name": "Ama", "phone": "0244123457", "password": "Password123!"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(ConsentRecord.objects.count(), 0)


class OwnChoicesTests(MarketingBase):
    URL = "/api/marketing/consent/me/"

    def as_account(self, account, kind):
        from accounts.authentication import issue_token

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")

    def test_a_customer_sees_every_channel_unticked_and_can_tick_one(self):
        c = make_customer(6)
        self.as_account(c, "customer")
        data = self.client.get(self.URL).json()["channels"]
        self.assertTrue(all(v["status"] is None and v["wording"] for v in data.values()))
        out = self.client.post(self.URL, {"channel": "email", "opted_in": True}, format="json").json()["channels"]
        self.assertEqual(out["email"]["status"], "opted_in")
        self.assertIsNone(out["sms"]["status"])
        self.client.post(self.URL, {"channel": "email", "opted_in": False}, format="json")
        self.assertEqual(self.client.get(self.URL).json()["channels"]["email"]["status"], "opted_out")
        self.assertEqual(ConsentRecord.objects.filter(customer=c).count(), 2)

    def test_a_business_owner_has_their_own_wording(self):
        o = make_owner(1)
        self.as_account(o, "business_owner")
        self.assertIn("my business", self.client.get(self.URL).json()["channels"]["email"]["wording"])
        self.client.post(self.URL, {"channel": "inapp", "opted_in": True}, format="json")
        self.assertEqual(ConsentRecord.objects.get(business_owner=o).channel, "inapp")

    def test_bad_input_staff_and_guests_are_refused(self):
        c = make_customer(7)
        self.as_account(c, "customer")
        self.assertEqual(self.client.post(self.URL, {"channel": "email", "opted_in": "yes"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.URL, {"channel": "pigeon", "opted_in": True}, format="json").status_code, 400)
        self.as_staff(self.akua)
        self.assertEqual(self.client.get(self.URL).status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get(self.URL).status_code, 401)


class UnsubscribeTests(MarketingBase):
    def test_get_reads_only_post_records_the_stop_for_that_channel_only(self):
        c = make_customer(8)
        consent.record_consent(c, "sms", True, "signup")
        consent.record_consent(c, "email", True, "signup")
        token = consent.unsubscribe_token(c, "sms", campaign_id=7)
        url = f"/api/marketing/unsubscribe/{token}/"
        before = ConsentRecord.objects.count()
        self.assertEqual(self.client.get(url).json(), {"channel": "sms", "channel_label": "SMS", "stopped": False})
        self.assertEqual(ConsentRecord.objects.count(), before)
        self.assertEqual(self.client.post(url).json()["stopped"], True)
        self.assertFalse(consent.is_opted_in(c, "sms"))
        self.assertTrue(consent.is_opted_in(c, "email"))
        last = ConsentRecord.objects.filter(customer=c, channel="sms").first()
        self.assertEqual((last.source, last.campaign_id), ("unsubscribe_link", 7))
        self.client.post(url)                                             # pressing it twice adds nothing
        self.assertEqual(ConsentRecord.objects.filter(customer=c, channel="sms").count(), 2)

    def test_a_forged_or_broken_link_does_nothing(self):
        for token in ("garbage", consent.unsubscribe_token(make_customer(9), "sms")[:-3] + "xyz"):
            self.assertEqual(self.client.post(f"/api/marketing/unsubscribe/{token}/").status_code, 400)
        self.assertEqual(ConsentRecord.objects.count(), 0)


class StaffLedgerTests(MarketingBase):
    def setUp(self):
        super().setUp()
        self.yaw = make_customer(11)
        self.owner = make_owner(2)
        consent.record_consent(self.yaw, "sms", True, "checkout", source_detail="Checkout tickbox")
        consent.record_consent(self.owner, "email", True, "settings")
        consent.record_consent(self.yaw, "email", True, "signup")
        consent.record_consent(self.yaw, "email", False, "unsubscribe_link")

    def test_masked_contacts_filters_and_search(self):
        self.as_staff(self.akua)
        data = self.client.get("/api/marketing/consent/ledger/").json()
        self.assertEqual(data["count"], 4)
        first = data["results"][0]
        self.assertEqual(first["phone"], "024 *** 0011")
        self.assertNotIn("+233", str(data))
        self.assertTrue(first["email"].startswith("c") and "***" in first["email"])
        self.assertEqual(self.client.get("/api/marketing/consent/ledger/?status=opted_out").json()["count"], 1)
        self.assertEqual(self.client.get("/api/marketing/consent/ledger/?channel=sms").json()["count"], 1)
        self.assertEqual(self.client.get("/api/marketing/consent/ledger/?contact=0011").json()["count"], 3)
        self.assertEqual(self.client.get("/api/marketing/consent/ledger/?contact=Shop 2").json()["count"], 1)
        self.assertEqual(self.client.get("/api/marketing/consent/ledger/?source=checkout").json()["count"], 1)

    def test_a_long_digit_string_cannot_probe_hidden_digits(self):
        self.as_staff(self.akua)
        # +233244000011: the screen shows only 0011; a longer guess must not match.
        self.assertEqual(self.client.get("/api/marketing/consent/ledger/?contact=244000011").json()["count"], 0)
        self.assertEqual(self.client.get("/api/marketing/consent/ledger/?contact=0244000011").json()["count"], 0)
        self.assertEqual(self.client.get("/api/marketing/consent/ledger/?contact=0011").json()["count"], 3)

    def test_summary_counts_the_current_answers(self):
        self.as_staff(self.akua)
        by = {c["channel"]: c for c in self.client.get("/api/marketing/consent/summary/").json()["channels"]}
        self.assertEqual((by["sms"]["opted_in"], by["email"]["opted_in"], by["email"]["opted_out"]), (1, 1, 1))
        self.assertEqual(self.client.get("/api/marketing/consent/summary/").json()["opt_outs_7d"]["total"], 1)

    def test_reveal_and_export_need_the_password_and_are_recorded(self):
        row = ConsentRecord.objects.filter(customer=self.yaw, channel="sms").first()
        self.as_staff(self.akua)
        self.assertEqual(self.client.post(f"/api/marketing/consent/ledger/{row.pk}/reveal/").status_code, 403)
        self.assertEqual(self.client.get("/api/marketing/consent/export/").status_code, 403)
        self.as_staff(self.akua, sudo=True)
        shown = self.client.post(f"/api/marketing/consent/ledger/{row.pk}/reveal/").json()
        self.assertEqual(shown["phone"], "+233244000011")
        event = ActivityEvent.objects.get(verb="consent.contact_revealed")
        self.assertNotIn("+233244000011", str(event.after) + event.summary)
        response = self.client.get("/api/marketing/consent/export/?channel=sms")
        body = b"".join(response.streaming_content).decode("utf-8-sig")
        self.assertIn("Customer 11", body)
        self.assertNotIn("+233244000011", body)
        self.assertTrue(ActivityEvent.objects.filter(verb="report.exported", after__personal_data=True).exists())

    def test_only_people_with_consent_view_can_read(self):
        for who in (self.scout, self.accountant):
            self.as_staff(who)
            for path in ("summary", "ledger", "wordings"):
                self.assertEqual(self.client.get(f"/api/marketing/consent/{path}/").status_code, 403)

    def test_wordings_show_how_many_records_hold_each(self):
        self.as_staff(self.akua)
        rows = {w["label"]: w for w in self.client.get("/api/marketing/consent/wordings/").json()["wordings"]}
        self.assertEqual(rows["sms-offers v1"]["records"], 1)
        self.assertEqual(rows["email-offers v1"]["records"], 2)

    def test_overview_opt_in_tile_reads_the_ledger(self):
        self.as_staff(self.akua)
        data = self.client.get("/api/marketing/overview/").json()["opt_ins"]
        self.assertEqual((data["state"], data["joined"], data["left"], data["net"]), ("ok", 3, 1, 2))


class SegmentTests(MarketingBase):
    def setUp(self):
        super().setUp()
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.other_zone = Zone.objects.exclude(pk=self.manhyia.pk).first()
        self.cat = Category.objects.get(slug="hotels")
        owner = make_owner(3, zone=self.manhyia)
        self.listing = Listing.objects.create(business_owner=owner, name="Stole", category=self.cat, zone=self.manhyia, price_amount=Decimal("10.00"), status=Listing.PUBLISHED)
        self.buyer, self.lurker, self.silent = make_customer(21), make_customer(22), make_customer(23)
        order = Order.objects.create(customer=self.buyer, status=Order.PAID, total_amount=Decimal("10.00"))
        OrderItem.objects.create(order=order, listing=self.listing, quantity=1, unit_price=Decimal("10.00"), line_total=Decimal("10.00"))
        for c in (self.buyer, self.lurker):
            consent.record_consent(c, "sms", True, "signup")
        consent.record_consent(self.buyer, "email", True, "signup")

    def count(self, **filters):
        return audience.count_for("customer", filters, filters.pop("channel", "sms") if False else "sms")

    def test_only_opted_in_people_are_counted_and_the_rest_are_explained(self):
        result = audience.count_for("customer", {}, "sms")
        self.assertEqual((result["count"], result["matched"], result["no_opt_in"]), (2, 3, 1))
        self.assertEqual(audience.count_for("customer", {}, "whatsapp")["count"], 0)

    def test_zone_category_and_activity_filters(self):
        f = {"zones": [self.manhyia.pk], "activity": "active", "days": 30}
        self.assertEqual(audience.count_for("customer", f, "sms")["count"], 1)
        self.assertEqual(audience.count_for("customer", {"zones": [self.other_zone.pk]}, "sms")["count"], 0)
        self.assertEqual(audience.count_for("customer", {"categories": [self.cat.pk], "activity": "active"}, "sms")["count"], 1)
        self.assertEqual(audience.count_for("customer", {"activity": "inactive", "days": 30}, "sms")["count"], 1)   # the lurker
        old = Order.objects.get(customer=self.buyer)
        Order.objects.filter(pk=old.pk).update(placed_at=timezone.now() - timedelta(days=200))
        self.assertEqual(audience.count_for("customer", f, "sms")["count"], 0)
        by_zone = audience.count_for("customer", {"zones": [self.manhyia.pk]}, "sms")["by_zone"]
        self.assertEqual(by_zone, [{"zone_id": self.manhyia.pk, "label": "Manhyia", "count": 1}])

    def test_a_suspended_customer_is_never_counted(self):
        Customer.objects.filter(pk=self.lurker.pk).update(is_suspended=True)
        self.assertEqual(audience.count_for("customer", {}, "sms")["count"], 1)

    def test_businesses_by_zone_and_opt_in(self):
        o = BusinessOwner.objects.get(profile__business_name="Shop 3")
        consent.record_consent(o, "email", True, "settings")
        make_owner(4, zone=self.manhyia)
        self.assertEqual(audience.count_for("business_owner", {"zones": [self.manhyia.pk]}, "email")["count"], 1)
        self.assertEqual(audience.count_for("business_owner", {"activity": "live"}, "email")["count"], 1)

    def test_bad_filters_are_refused(self):
        for bad in ({"zones": [9999999]}, {"zones": "x"}, {"activity": "weird"}, {"days": 0}, {"days": True}):
            with self.assertRaises(audience.AudienceError):
                audience.clean_filters("customer", bad)
        with self.assertRaises(audience.AudienceError):
            audience.clean_filters("staff", {})

    def test_api_preview_save_edit_remove_and_permissions(self):
        self.as_staff(self.akua)
        body = {"name": "Manhyia buyers", "audience": "customer", "channel": "sms", "filters": {"zones": [self.manhyia.pk], "activity": "active", "days": 60}}
        preview = self.client.post("/api/marketing/segments/preview/", body, format="json").json()
        self.assertEqual(preview["count"], 1)
        self.assertEqual(preview["by_channel"]["sms"], 1)
        self.assertEqual(preview["by_channel"]["email"], 1)
        self.assertNotIn("Customer 21", str(preview))
        saved = self.client.post("/api/marketing/segments/", body, format="json")
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(saved.json()["size"], 1)
        self.assertIn("Manhyia", saved.json()["rules"])
        listing = self.client.get("/api/marketing/segments/").json()["results"]
        self.assertEqual([s["name"] for s in listing], ["Manhyia buyers"])
        sid = saved.json()["id"]
        self.assertEqual(self.client.patch(f"/api/marketing/segments/{sid}/", {"name": "Renamed"}, format="json").json()["name"], "Renamed")
        self.assertEqual(self.client.post("/api/marketing/segments/", {**body, "name": " "}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/marketing/segments/{sid}/").status_code, 204)
        self.assertEqual(self.client.get("/api/marketing/segments/").json()["results"], [])
        self.assertEqual(Segment.objects.count(), 1)       # archived, not erased
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/marketing/segments/").status_code, 403)
        self.assertEqual(self.client.post("/api/marketing/segments/preview/", body, format="json").status_code, 403)
