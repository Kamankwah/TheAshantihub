import tempfile
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, OwnerConsent
from accounts.testing import make_staff, staff_token
from activity.services import record
from approvals.models import ApprovalRequest
from billing.models import Subscription
from fraud.models import FraudFlag
from listings.models import Listing, Zone
from portfolio import health
from portfolio.models import BusinessHealthSnapshot
from portfolio.services import assign_account_manager
from portfolio.tests.health_fixtures import (
    add_listings,
    image,
    log_call,
    make_business,
    make_healthy,
    subscribe,
    subscribe_overdue,
    subscribe_paused,
)

TEST_MEDIA_ROOT = tempfile.mkdtemp()
URL = "/api/portfolio/businesses/"
ITEM_KEYS = {
    "id", "business_name", "owner_name", "login_phone", "zone", "kyc_status", "registration_channel",
    "needs_claim", "claimed_at", "account_manager", "health", "subscription", "listings_live",
    "listings_total", "listings_waiting", "last_order_at", "last_contact", "open_fraud_flags",
}
DETAIL_KEYS = ITEM_KEYS | {
    "business_kind", "business_category", "gps_address", "lat", "lng", "location_accuracy_m",
    "location_is_manual", "location_set_by", "business_contact_phone", "business_description", "opening_hours",
    "signboard_photo", "email", "registered_by", "created_at", "listings", "pending_requests", "recent_calls",
    "assignments", "open_flags", "can_manage",
}


class PortfolioApiBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_lead = make_staff("operations", "kojo@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.yaw = make_staff("scout", "yaw@example.com", manager=self.other_lead)

    def auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def ids(self, response):
        self.assertEqual(response.status_code, 200, response.content)
        return [item["id"] for item in response.json()["results"]]


class PortfolioScopeTests(PortfolioApiBase):
    def setUp(self):
        super().setUp()
        self.kwames = make_business("Adwoa Fabrics", manager=self.kwame)
        self.efuas = make_business("Akosua Ntoma Kente", manager=self.efua)
        self.unassigned = make_business("Manhyia Tailoring", kyc=BusinessOwner.PENDING)
        self.yaws = make_business("Ejisu Phone Accessories", manager=self.yaw)
        make_business("Gone Shop", manager=self.kwame, kyc=BusinessOwner.REJECTED)

    def test_a_scout_always_gets_their_own_businesses(self):
        self.auth(self.kwame)
        for scope in ("", "mine", "team", "all"):
            self.assertEqual(self.ids(self.client.get(URL, {"scope": scope})), [self.kwames.pk], scope)

    def test_operations_defaults_to_their_team_plus_businesses_without_a_manager(self):
        self.auth(self.lead)
        self.assertEqual(set(self.ids(self.client.get(URL))), {self.kwames.pk, self.efuas.pk, self.unassigned.pk})
        self.assertEqual(
            set(self.ids(self.client.get(URL, {"scope": "all"}))),
            {self.kwames.pk, self.efuas.pk, self.unassigned.pk, self.yaws.pk},
        )
        self.assertEqual(self.ids(self.client.get(URL, {"scope": "mine"})), [])
        self.auth(self.other_lead)
        self.assertEqual(set(self.ids(self.client.get(URL))), {self.yaws.pk, self.unassigned.pk})

    def test_staff_without_a_portfolio_permission_are_refused(self):
        self.auth(make_staff("support", "abena@example.com"))
        self.assertEqual(self.client.get(URL).status_code, 403)
        self.assertEqual(self.client.get(f"{URL}{self.kwames.pk}/").status_code, 403)


class PortfolioListTests(PortfolioApiBase):
    def five_businesses(self):
        self.healthy = make_healthy(make_business("Alpha Store", manager=self.kwame), self.kwame)
        self.new = make_business("Beta Store", manager=self.kwame, kyc=BusinessOwner.PENDING)
        self.attention = make_healthy(make_business("Gamma Store", manager=self.kwame), self.kwame, live_listings=2)
        self.risk_z = make_business("Zed Store", manager=self.kwame)
        self.risk_a = make_business("Abe Store", manager=self.kwame)

    def test_sorted_at_risk_then_attention_then_new_then_healthy_then_by_name(self):
        self.five_businesses()
        self.auth(self.kwame)
        self.assertEqual(
            self.ids(self.client.get(URL)),
            [self.risk_a.pk, self.risk_z.pk, self.attention.pk, self.new.pk, self.healthy.pk],
        )

    def test_the_summary_counts_every_rating_and_ignores_the_health_filter(self):
        self.five_businesses()
        self.auth(self.lead)
        body = self.client.get(URL, {"health": "at_risk"}).json()
        self.assertEqual([item["id"] for item in body["results"]], [self.risk_a.pk, self.risk_z.pk])
        self.assertEqual(body["summary"], {
            "total": 5, "healthy": 1, "needs_attention": 1, "at_risk": 2, "new": 1, "unassigned": 0,
            "at_risk_week_ago": None,  # no snapshot was taken that day: unknown, not 0
        })

    def test_at_risk_a_week_ago_comes_from_the_snapshot_dated_seven_days_back(self):
        first = make_business("Abe Store", manager=self.kwame)
        second = make_business("Bee Store", manager=self.kwame)
        elsewhere = make_business("Yaw Store", manager=self.yaw)
        week_ago = timezone.localdate() - timedelta(days=7)
        BusinessHealthSnapshot.objects.create(business_owner=first, date=week_ago, rating=health.AT_RISK, reasons=[])
        BusinessHealthSnapshot.objects.create(
            business_owner=second, date=week_ago - timedelta(days=1), rating=health.AT_RISK, reasons=[],
        )
        BusinessHealthSnapshot.objects.create(business_owner=second, date=week_ago, rating=health.HEALTHY, reasons=[])
        BusinessHealthSnapshot.objects.create(business_owner=elsewhere, date=week_ago, rating=health.AT_RISK, reasons=[])
        self.auth(self.kwame)
        self.assertEqual(self.client.get(URL).json()["summary"]["at_risk_week_ago"], 1)

    def test_at_risk_a_week_ago_is_unknown_when_no_snapshot_was_taken_that_day(self):
        owner = make_business("Abe Store", manager=self.kwame)
        week_ago = timezone.localdate() - timedelta(days=7)
        BusinessHealthSnapshot.objects.create(
            business_owner=owner, date=week_ago - timedelta(days=1), rating=health.AT_RISK, reasons=[],
        )
        self.auth(self.kwame)
        self.assertIsNone(self.client.get(URL).json()["summary"]["at_risk_week_ago"])
        # A snapshot that day for any business means the count is known, even when it is 0.
        other = make_business("Yaw Store", manager=self.yaw)
        BusinessHealthSnapshot.objects.create(business_owner=other, date=week_ago, rating=health.AT_RISK, reasons=[])
        self.assertEqual(self.client.get(URL).json()["summary"]["at_risk_week_ago"], 0)

    def test_filters_and_search(self):
        adum = Zone.objects.get(name="Adum")
        overdue = make_healthy(
            make_business("Kumasi Leather Works", manager=self.efua, zone="Adum"), self.efua,
            subscription=lambda owner: subscribe_overdue(owner, timezone.now() - timedelta(days=12)),
        )
        healthy = make_healthy(make_business("Tafo Grains", manager=self.kwame, phone="+233241234567"), self.kwame)
        unassigned = make_business("Manhyia Tailoring", kyc=BusinessOwner.PENDING)
        self.auth(self.lead)
        self.assertEqual(self.ids(self.client.get(URL, {"subscription": "overdue"})), [overdue.pk])
        self.assertEqual(self.ids(self.client.get(URL, {"subscription": "none"})), [unassigned.pk])
        self.assertEqual(self.ids(self.client.get(URL, {"zone": adum.pk})), [overdue.pk])
        self.assertEqual(self.ids(self.client.get(URL, {"scout": self.kwame.pk})), [healthy.pk])
        self.assertEqual(self.ids(self.client.get(URL, {"unassigned": "1"})), [unassigned.pk])
        self.assertEqual(self.ids(self.client.get(URL, {"health": "new"})), [unassigned.pk])
        self.assertEqual(self.ids(self.client.get(URL, {"q": "leather"})), [overdue.pk])
        self.assertEqual(self.ids(self.client.get(URL, {"q": "Adum"})), [overdue.pk])
        # The same phone written the other way still finds the business.
        self.assertEqual(self.ids(self.client.get(URL, {"q": "024 123 4567"})), [healthy.pk])
        for bad in ({"health": "great"}, {"subscription": "gold"}, {"scout": "abc"}, {"zone": "x"}):
            self.assertEqual(self.client.get(URL, bad).status_code, 400, bad)

    def test_an_item_carries_every_field(self):
        owner = make_business(
            "Adwoa Fabrics", manager=self.kwame, registration_channel=BusinessOwner.SCOUT, registered_by=self.kwame,
        )
        make_healthy(owner, self.kwame)
        add_listings(owner, 1, status=Listing.PENDING_REVIEW)
        ApprovalRequest.objects.create(
            kind="listing.create", title="Add Kente dress", maker=self.kwame,
            due_at=timezone.now() + timedelta(hours=24), payload={"business_owner_id": owner.pk, "reason": "x"},
        )
        FraudFlag.objects.create(
            kind=FraudFlag.SIMILAR_NEARBY, source=FraudFlag.SYSTEM, title="Similar business nearby",
            business_owner=owner,
        )
        self.auth(self.kwame)
        item = self.client.get(URL).json()["results"][0]
        self.assertEqual(set(item), ITEM_KEYS)
        self.assertEqual((item["id"], item["business_name"], item["owner_name"]), (owner.pk, "Adwoa Fabrics", "Adwoa Fabrics Owner"))
        self.assertEqual(item["zone"], {"id": Zone.objects.get(name="Bantama").pk, "name": "Bantama"})
        self.assertEqual(item["account_manager"], {"id": self.kwame.pk, "full_name": "Kwame"})
        self.assertEqual((item["registration_channel"], item["needs_claim"], item["claimed_at"]), ("scout", True, None))
        self.assertEqual(item["health"], {"rating": "healthy", "reasons": []})
        self.assertEqual(item["subscription"]["state"], "active")
        self.assertEqual((item["listings_live"], item["listings_total"], item["listings_waiting"]), (3, 4, 2))
        self.assertIsNotNone(parse_datetime(item["last_order_at"]))
        self.assertEqual(item["last_contact"]["kind"], "call")
        self.assertIsNotNone(parse_datetime(item["last_contact"]["at"]))
        self.assertEqual(item["open_fraud_flags"], 1)

    def test_pages_hold_25(self):
        for index in range(26):
            make_business(f"Shop {index:02d}", manager=self.kwame, kyc=BusinessOwner.PENDING)
        self.auth(self.kwame)
        first = self.client.get(URL).json()
        self.assertEqual((first["count"], len(first["results"])), (26, 25))
        self.assertIsNotNone(first["next"])
        second = self.client.get(URL, {"page": 2}).json()
        self.assertEqual(len(second["results"]), 1)
        self.assertEqual(second["summary"]["total"], 26)


class PortfolioQueryCountTests(PortfolioApiBase):
    """No N+1: every health input is a correlated subquery of ONE list query,
    so 2 businesses and 8 businesses cost the same (about a dozen queries
    today, mostly sign-in and permissions)."""

    BOUND = 20

    def add_businesses(self, start, count):
        for index in range(start, start + count):
            owner = make_healthy(make_business(f"Shop {index:02d}", manager=self.kwame), self.kwame)
            add_listings(owner, 1, status=Listing.PENDING_REVIEW)
            FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.STAFF, title="Check", business_owner=owner)

    def count_queries(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(URL, {"scope": "all"})
        self.assertEqual(response.status_code, 200, response.content)
        return len(queries)

    def test_the_list_runs_a_fixed_number_of_queries(self):
        self.add_businesses(0, 2)
        self.auth(self.lead)
        self.count_queries()  # warm-up: the first request also stamps the session's last_seen_at
        few = self.count_queries()
        self.add_businesses(2, 6)
        many = self.count_queries()
        self.assertEqual(few, many)
        self.assertLessEqual(many, self.BOUND)


class PortfolioDetailTests(PortfolioApiBase):
    def setUp(self):
        super().setUp()
        self.owner = make_business(
            "Adwoa Fabrics", manager=self.kwame, registration_channel=BusinessOwner.SCOUT, registered_by=self.kwame,
        )
        make_healthy(self.owner, self.kwame)
        assign_account_manager(self.owner, self.kwame, by=self.lead, reason="Registered by Kwame")

    def url(self, owner=None):
        return f"{URL}{(owner or self.owner).pk}/"

    def test_the_account_manager_sees_the_whole_business_page(self):
        now = timezone.now()
        log_call(self.owner, self.efua, days_ago=1, about_only=True)
        other = make_business("Bantama Cold Store", manager=self.efua)
        log_call(other, self.efua, days_ago=1)
        listing = self.owner.listings.order_by("pk").first()
        waiting = ApprovalRequest.objects.create(
            kind="business.update", title="Change phone and hours", maker=self.kwame,
            stage=ApprovalRequest.MANAGER, assigned_to=self.lead, target_type="accounts.businessowner",
            target_id=str(self.owner.pk), payload={"business_owner_id": self.owner.pk, "reason": "New number"},
            due_at=now + timedelta(hours=20),
        )
        pooled = ApprovalRequest.objects.create(
            kind="listing.photos", title="Add 4 photos", maker=self.kwame, stage=ApprovalRequest.POOL,
            pool_permission="portfolio.manage", target_type="listings.listing", target_id=str(listing.pk),
            payload={"business_owner_id": self.owner.pk, "listing_id": listing.pk, "photo_ids": [], "reason": "x"},
            due_at=now + timedelta(hours=30),
        )
        ApprovalRequest.objects.create(
            kind="business.update", title="Decided", maker=self.kwame, status=ApprovalRequest.APPROVED,
            target_type="accounts.businessowner", target_id=str(self.owner.pk),
            payload={"business_owner_id": self.owner.pk, "reason": "x"}, due_at=now,
        )
        ApprovalRequest.objects.create(
            kind="business.update", title="Another business", maker=self.efua,
            target_type="accounts.businessowner", target_id=str(other.pk),
            payload={"business_owner_id": other.pk, "reason": "x"}, due_at=now,
        )
        FraudFlag.objects.create(
            kind=FraudFlag.SIMILAR_NEARBY, source=FraudFlag.SYSTEM, title="Similar business nearby",
            business_owner=self.owner,
        )
        self.auth(self.kwame)
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertTrue(body["can_manage"])
        self.assertEqual(body["registered_by"], {"id": self.kwame.pk, "full_name": "Kwame"})
        self.assertEqual(len(body["listings"]), 3)
        self.assertEqual(
            set(body["listings"][0]), {"id", "name", "status", "main_photo", "photos_count", "price_amount"},
        )
        self.assertEqual(
            [(row["id"], row["waiting_for"]) for row in body["pending_requests"]],
            [(waiting.pk, "Ama"), (pooled.pk, "Operations")],
        )
        self.assertEqual(
            set(body["pending_requests"][0]), {"id", "kind", "title", "created_at", "due_at", "stage", "waiting_for"},
        )
        # The call with the owner and the one logged about the business; not the other business's.
        self.assertEqual(len(body["recent_calls"]), 2)
        self.assertEqual(body["recent_calls"][0]["staff_name"], "Efua")
        self.assertEqual(
            set(body["recent_calls"][0]), {"id", "direction", "outcome", "purpose", "started_at", "staff_name"},
        )
        self.assertEqual(
            {key: body["assignments"][0][key] for key in ("scout_name", "assigned_by_name", "reason", "ended_at")},
            {"scout_name": "Kwame", "assigned_by_name": "Ama", "reason": "Registered by Kwame", "ended_at": None},
        )
        # A case's title can name a staff member (self-dealing), so a scout sees only its kind.
        self.assertEqual(body["open_flags"], [{
            "id": FraudFlag.objects.get().pk, "kind": "similar_nearby", "kind_label": "Similar business nearby",
        }])

    def test_operations_see_each_open_cases_title(self):
        flag = FraudFlag.objects.create(
            kind=FraudFlag.SELF_DEALING, source=FraudFlag.SYSTEM, title="Owner's phone matches staff member Efua",
            business_owner=self.owner,
        )
        self.auth(self.lead)
        self.assertEqual(self.client.get(self.url()).json()["open_flags"], [{
            "id": flag.pk, "kind": "self_dealing", "kind_label": flag.get_kind_display(),
            "title": "Owner's phone matches staff member Efua",
        }])

    def test_another_scouts_business_is_not_found(self):
        self.auth(self.yaw)
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_operations_can_open_any_business_but_is_not_its_manager(self):
        self.auth(self.other_lead)
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["can_manage"])


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class BusinessReviewTests(PortfolioApiBase):
    def setUp(self):
        super().setUp()
        self.owner = make_business(
            "Asafo Hair Studio", manager=self.kwame, kyc=BusinessOwner.PENDING, phone="+233241112223",
            registration_channel=BusinessOwner.SCOUT, registered_by=self.kwame,
        )
        profile = self.owner.profile
        profile.gps_address = "AK-039-5028"
        profile.ghana_card_number = "GHA-712345678-2"
        profile.lat, profile.lng = Decimal("6.690000"), Decimal("-1.620000")
        profile.location_accuracy_m = 12
        profile.location_set_by = "scout"
        profile.location_set_at = timezone.now()
        profile.opening_hours = "Mon–Sat 08:00–18:00"
        profile.signboard_photo = image("sign.jpg")
        profile.ghana_card_front_image = image("card.jpg")
        profile.save()
        self.url = f"{URL}{self.owner.pk}/review/"

    def test_operations_gets_the_review_sheet_with_checks_run_now(self):
        duplicate = make_business("Other Shop", phone="0241112223")  # the same phone, written the other way
        similar = make_business("Asafo Hair Studios")
        similar.profile.lat, similar.profile.lng = Decimal("6.690100"), Decimal("-1.620100")
        similar.profile.save()
        make_staff("support", "esi@example.com", phone="+233241112223")
        FraudFlag.objects.create(
            kind=FraudFlag.DUPLICATE, source=FraudFlag.SYSTEM, title="Same phone as Other Shop",
            business_owner=duplicate, related_business_owner=self.owner,
        )
        OwnerConsent.objects.create(
            business_owner=self.owner, terms_version="September 2026", accepted_at=timezone.now(),
            channel="handover", staff=self.kwame, user_agent="Mozilla/5.0 (Linux; Android 14)", ip="102.176.44.9",
        )
        self.auth(self.lead)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.content)
        sheet = response.json()
        self.assertEqual(
            set(sheet),
            {"owner", "business", "photos", "location", "checks", "consent", "flags", "registered_by_name", "created_at"},
        )
        self.assertEqual(sheet["owner"]["ghana_card_number"], "GHA-712345678-2")
        self.assertTrue(sheet["owner"]["needs_claim"])
        self.assertEqual(sheet["business"]["business_name"], "Asafo Hair Studio")
        self.assertEqual(sheet["business"]["zone"]["name"], "Bantama")
        self.assertFalse(sheet["business"]["tin_given"])
        self.assertIsNotNone(sheet["photos"]["signboard"])
        self.assertIsNotNone(sheet["photos"]["ghana_card_front"])
        self.assertIsNone(sheet["photos"]["ghana_card_back"])
        self.assertEqual(sheet["location"]["lat"], 6.69)
        self.assertEqual((sheet["location"]["accuracy_m"], sheet["location"]["set_by"]), (12, "scout"))
        self.assertEqual(sheet["location"]["gps_address"], "AK-039-5028")
        self.assertFalse(sheet["location"]["address_verified"])
        self.assertIn("phone", sheet["checks"]["exact"])
        self.assertEqual([row["business_owner_id"] for row in sheet["checks"]["similar"]], [similar.pk])
        self.assertTrue(sheet["checks"]["staff_match"])
        self.assertEqual(sheet["checks"]["accuracy_m"], 12)
        self.assertEqual(
            {key: sheet["consent"][key] for key in ("terms_version", "channel", "staff_name", "ip")},
            {"terms_version": "September 2026", "channel": "handover", "staff_name": "Kwame", "ip": "102.176.x.x"},
        )
        self.assertEqual([flag["title"] for flag in sheet["flags"]], ["Same phone as Other Shop"])
        self.assertEqual(sheet["registered_by_name"], "Kwame")

    def test_a_clean_registration_with_no_consent_yet(self):
        self.auth(self.lead)
        sheet = self.client.get(self.url).json()
        self.assertIsNone(sheet["consent"])
        self.assertEqual(sheet["checks"]["exact"], [])
        self.assertEqual(sheet["checks"]["similar"], [])
        self.assertFalse(sheet["checks"]["staff_match"])
        self.assertEqual(sheet["flags"], [])

    def test_scouts_and_support_cannot_open_it(self):
        for staff in (self.kwame, make_staff("support", "abena@example.com")):
            self.auth(staff)
            self.assertEqual(self.client.get(self.url).status_code, 403)


class SubscriptionsDueTests(PortfolioApiBase):
    DUE_URL = "/api/portfolio/subscriptions-due/"

    def test_overdue_most_urgent_first_paused_and_cleared_this_week(self):
        now = timezone.now()
        late = make_healthy(
            make_business("Kumasi Leather Works", manager=self.efua, email="leather@example.com"), self.efua,
            subscription=lambda owner: subscribe_overdue(owner, now - timedelta(days=12, hours=1)),
        )
        Subscription.objects.filter(business_owner=late).update(
            overdue_notice_at=now - timedelta(days=12), reminder_day7_at=now - timedelta(days=6),
        )
        recent = make_healthy(
            make_business("Suame Auto Parts", manager=self.kwame), self.kwame,
            subscription=lambda owner: subscribe_overdue(owner, now - timedelta(days=1, hours=1)),
        )
        unmarked = make_healthy(
            make_business("Adum Bakery", manager=self.kwame), self.kwame,
            subscription=lambda owner: subscribe(owner, ends_at=now - timedelta(hours=2)),
        )
        paused = make_healthy(
            make_business("Bantama Shoe Palace", manager=self.kwame), self.kwame, subscription=subscribe_paused,
        )
        make_healthy(make_business("Tafo Grains", manager=self.kwame), self.kwame)  # active: not listed
        elsewhere = make_healthy(
            make_business("Ejisu Phones", manager=self.yaw), self.yaw,
            subscription=lambda owner: subscribe_overdue(owner, now - timedelta(days=3)),
        )
        paid = make_healthy(make_business("Akosua Ntoma Kente", manager=self.efua), self.efua)
        yaw_paid = make_healthy(make_business("Ejisu Crafts", manager=self.yaw), self.yaw)
        resumed = {"was": "overdue", "paid_on_day": 7, "overdue_since": None, "paused_at": None}
        record(paid, "subscription.resumed", target=paid, after={**resumed, "business_name": "Akosua Ntoma Kente"})
        record(yaw_paid, "subscription.resumed", target=yaw_paid, after={**resumed, "business_name": "Ejisu Crafts"})
        with mock.patch("django.utils.timezone.now", return_value=now - timedelta(days=8)):
            # Last week's payment: outside the 7-day "cleared" window.
            record(paid, "subscription.resumed", target=paid, after={**resumed, "paid_on_day": 3})

        self.auth(self.lead)
        response = self.client.get(self.DUE_URL)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual([row["id"] for row in body["overdue"]], [late.pk, recent.pk, unmarked.pk])
        self.assertEqual(set(body["overdue"][0]), ITEM_KEYS | {"notices", "owner_has_email"})
        # Whether the clock's notices also went by email (SMS isn't connected).
        self.assertEqual([row["owner_has_email"] for row in body["overdue"]], [True, False, False])
        self.assertEqual(body["paused"][0]["owner_has_email"], False)
        self.assertEqual([notice["label"] for notice in body["overdue"][0]["notices"]], ["Overdue notice", "Day 7 reminder"])
        self.assertEqual(body["overdue"][1]["notices"], [])
        self.assertEqual(body["overdue"][0]["subscription"]["state"], "overdue")
        self.assertEqual(body["overdue"][0]["account_manager"]["full_name"], "Efua")
        self.assertEqual([row["id"] for row in body["paused"]], [paused.pk])
        self.assertEqual(
            [{key: row[key] for key in ("id", "business_name", "paid_on_day")} for row in body["cleared"]],
            [{"id": paid.pk, "business_name": "Akosua Ntoma Kente", "paid_on_day": 7}],
        )
        self.assertIsNotNone(parse_datetime(body["cleared"][0]["at"]))

        everything = self.client.get(self.DUE_URL, {"scope": "all"}).json()
        self.assertIn(elsewhere.pk, [row["id"] for row in everything["overdue"]])
        self.assertEqual({row["id"] for row in everything["cleared"]}, {paid.pk, yaw_paid.pk})

    def test_scouts_cannot_open_subscriptions_due(self):
        self.auth(self.kwame)
        self.assertEqual(self.client.get(self.DUE_URL).status_code, 403)
