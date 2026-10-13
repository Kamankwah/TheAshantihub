import io
from decimal import Decimal
import tempfile
from datetime import timedelta
from itertools import count
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import BusinessOwner, BusinessOwnerProfile
from approvals import services as approvals
from approvals.models import ApprovalRequest
from billing.models import Subscription, SubscriptionPlan
from fraud.models import FraudFlag
from listings.models import Category, Listing, Promotion, Zone
from marketing import featured, overview
from marketing.calendar_sources import banner_entries
from marketing.models_banners import Banner, FeaturedBooking, FeaturedSlot

from .base import MarketingBase

MEDIA = tempfile.mkdtemp()
_n = count(100)


def image(name="b.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def form(**over):
    now = timezone.now()
    data = {"slot": "home_strip", "title": "Sell on AshantiHub", "alt_text": "A scout helping a seller", "link_path": "/register",
            "starts_at": (now + timedelta(hours=1)).isoformat(), "ends_at": (now + timedelta(days=5)).isoformat(), "image": image()}
    data.update(over)
    return {k: v for k, v in data.items() if v is not None}


@override_settings(MEDIA_ROOT=MEDIA)
class BannerBase(MarketingBase):
    def make(self, **over):
        now = timezone.now()
        fields = dict(slot="home_strip", title="Kente Friday", alt_text="Weaver", link_path="/events", starts_at=now - timedelta(hours=1),
                      ends_at=now + timedelta(days=2), state=Banner.APPROVED, created_by=self.akua)
        fields.update(over)
        banner = Banner(**fields)
        banner.image.save("x.jpg", image(), save=False)
        banner.save()
        return banner

    def create_via_api(self, **over):
        self.as_staff(self.akua)
        r = self.client.post("/api/marketing/site-banners/", form(**over), format="multipart")
        return r


class BannerStaffTests(BannerBase):
    def test_permission(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/marketing/site-banners/").status_code, 403)
        self.assertEqual(self.client.post("/api/marketing/site-banners/", form(), format="multipart").status_code, 403)
        self.as_staff(self.akua)
        self.assertEqual(self.client.get("/api/marketing/site-banners/").status_code, 200)

    def test_create_validates_image_link_and_contact_details(self):
        bad = SimpleUploadedFile("x.jpg", b"not an image at all", content_type="image/jpeg")
        self.assertEqual(self.create_via_api(image=bad).status_code, 400)
        for link in ("https://evil.example/x", "//evil.example", "wa.me/233244000000", "tel:0244000000"):
            self.assertEqual(self.create_via_api(link_path=link).status_code, 400, link)
        self.assertEqual(self.create_via_api(title="Call 0244 123 456 now").status_code, 400)
        self.assertEqual(self.create_via_api(alt_text="Message us on WhatsApp").status_code, 400)
        self.assertEqual(self.create_via_api(slot="category_top").status_code, 400)
        self.assertEqual(self.create_via_api(ends_at=(timezone.now() - timedelta(days=1)).isoformat()).status_code, 400)
        self.assertEqual(Banner.objects.count(), 0)

    def test_created_banner_is_a_draft_with_zero_counters_and_not_public(self):
        r = self.create_via_api()
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()["state"], r.json()["views"], r.json()["clicks"]), ("draft", 0, 0))
        self.assertEqual(self.client.get("/api/marketing/banners/?slot=home_strip").json()["banners"], [])

    def test_maker_submits_and_super_admin_approval_makes_it_live(self):
        pk = self.create_via_api(starts_at=(timezone.now() - timedelta(minutes=5)).isoformat()).json()["id"]
        r = self.client.post(f"/api/marketing/site-banners/{pk}/submit/")
        self.assertEqual(r.json()["state"], "waiting")
        approval = ApprovalRequest.objects.get(kind="marketing.banner")
        self.assertEqual(approval.status, ApprovalRequest.PENDING)
        self.assertIsNone(approval.amount)
        self.assertEqual(self.client.get("/api/marketing/banners/?slot=home_strip").json()["banners"], [])
        with self.assertRaises(approvals.MakerCannotDecide):
            approvals.approve(approval.pk, self.akua)
        approvals.approve(approval.pk, self.boss)
        banner = Banner.objects.get(pk=pk)
        self.assertEqual((banner.state, banner.approved_by), ("approved", self.boss))
        self.assertEqual(len(self.client.get("/api/marketing/banners/?slot=home_strip").json()["banners"]), 1)

    def test_super_admin_own_banner_goes_live_at_once(self):
        self.as_staff(self.boss)
        pk = self.client.post("/api/marketing/site-banners/", form(starts_at=(timezone.now() - timedelta(minutes=5)).isoformat()), format="multipart").json()["id"]
        self.assertEqual(self.client.post(f"/api/marketing/site-banners/{pk}/submit/").json()["state"], "approved")

    def test_returned_banner_can_be_edited_and_resent(self):
        pk = self.create_via_api().json()["id"]
        self.client.post(f"/api/marketing/site-banners/{pk}/submit/")
        approval = ApprovalRequest.objects.get(kind="marketing.banner")
        approvals.reject(approval.pk, self.boss, "Use a real photo")
        banner = Banner.objects.get(pk=pk)
        self.assertEqual((banner.state, banner.return_note), ("rejected", "Use a real photo"))
        self.as_staff(self.akua)
        self.assertEqual(self.client.patch(f"/api/marketing/site-banners/{pk}/", {"title": "Better"}, format="multipart").json()["state"], "draft")
        self.assertEqual(self.client.post(f"/api/marketing/site-banners/{pk}/submit/").json()["state"], "waiting")

    def test_withdraw_and_no_edit_while_waiting(self):
        pk = self.create_via_api().json()["id"]
        self.client.post(f"/api/marketing/site-banners/{pk}/submit/")
        self.assertEqual(self.client.patch(f"/api/marketing/site-banners/{pk}/", {"title": "x"}, format="multipart").status_code, 409)
        self.assertEqual(self.client.post(f"/api/marketing/site-banners/{pk}/withdraw/").json()["state"], "draft")
        self.assertEqual(ApprovalRequest.objects.get(kind="marketing.banner").status, ApprovalRequest.CANCELLED)

    def test_take_down_and_reschedule(self):
        banner = self.make()
        self.as_staff(self.akua)
        now = timezone.now()
        r = self.client.post(f"/api/marketing/site-banners/{banner.pk}/reschedule/", {"starts_at": (now - timedelta(hours=1)).isoformat(), "ends_at": (now + timedelta(days=9)).isoformat()}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.client.post(f"/api/marketing/site-banners/{banner.pk}/reschedule/", {"starts_at": now.isoformat(), "ends_at": (now - timedelta(days=1)).isoformat()}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/marketing/site-banners/{banner.pk}/take-down/").json()["state"], "taken_down")
        self.assertEqual(self.client.get("/api/marketing/banners/?slot=home_strip").json()["banners"], [])
        self.assertEqual(self.client.post(f"/api/marketing/site-banners/{banner.pk}/take-down/").status_code, 409)


class PublicBannerTests(BannerBase):
    def test_only_live_approved_and_no_internal_fields(self):
        live = self.make(title="Live")
        self.make(title="Draft", state=Banner.DRAFT)
        self.make(title="Waiting", state=Banner.WAITING)
        self.make(title="Future", starts_at=timezone.now() + timedelta(days=1))
        self.make(title="Ended", ends_at=timezone.now() - timedelta(minutes=1))
        self.make(title="Down", state=Banner.TAKEN_DOWN)
        self.make(title="Other slot", slot="events_top")
        r = self.client.get("/api/marketing/banners/?slot=home_strip")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([b["title"] for b in r.json()["banners"]], ["Live"])
        self.assertEqual(set(r.json()["banners"][0]), {"id", "slot", "title", "alt_text", "image", "link_path", "sponsored"})
        self.assertIn("max-age", r["Cache-Control"])
        self.assertEqual(live.views, 0)

    def test_category_banner_needs_its_category_and_slot_is_required(self):
        cat = Category.objects.get(slug="hotels")
        self.make(slot="category_top", category=cat, title="Hotels")
        self.assertEqual(len(self.client.get("/api/marketing/banners/?slot=category_top&category=hotels").json()["banners"]), 1)
        self.assertEqual(self.client.get("/api/marketing/banners/?slot=category_top&category=food").json()["banners"], [])
        self.assertEqual(self.client.get("/api/marketing/banners/").status_code, 400)

    def test_get_never_writes(self):
        banner = self.make()
        before = Banner.objects.values_list("views", "clicks", "updated_at").get(pk=banner.pk)
        for _ in range(3):
            self.client.get("/api/marketing/banners/?slot=home_strip")
        self.assertEqual(Banner.objects.values_list("views", "clicks", "updated_at").get(pk=banner.pk), before)
        self.assertEqual(self.client.get(f"/api/marketing/banners/{banner.pk}/view/").status_code, 405)


class BeaconTests(BannerBase):
    def test_counts_once_per_window_and_only_live_banners(self):
        live, down = self.make(), self.make(state=Banner.TAKEN_DOWN)
        self.assertEqual(self.client.post(f"/api/marketing/banners/{live.pk}/view/").status_code, 204)
        self.client.post(f"/api/marketing/banners/{live.pk}/view/")
        self.client.post(f"/api/marketing/banners/{live.pk}/click/")
        self.client.post(f"/api/marketing/banners/{down.pk}/view/")
        live.refresh_from_db(), down.refresh_from_db()
        self.assertEqual((live.views, live.clicks, down.views), (1, 1, 0))

    def test_another_address_counts_separately_and_no_pii_is_stored(self):
        live = self.make()
        self.client.post(f"/api/marketing/banners/{live.pk}/view/", REMOTE_ADDR="10.0.0.1")
        self.client.post(f"/api/marketing/banners/{live.pk}/view/", REMOTE_ADDR="10.0.0.2")
        live.refresh_from_db()
        self.assertEqual(live.views, 2)
        self.assertNotIn("10.0.0", "".join(str(v) for v in Banner.objects.values().get(pk=live.pk).values()))

    def test_rate_limited(self):
        live = self.make()
        rates = dict(ScopedRateThrottle.THROTTLE_RATES, banner_beacon="3/min")
        with mock.patch.object(ScopedRateThrottle, "THROTTLE_RATES", rates):
            cache.clear()
            codes = [self.client.post(f"/api/marketing/banners/{live.pk}/click/").status_code for _ in range(5)]
        self.assertEqual(codes, [204, 204, 204, 429, 429])


class OverviewAndCalendarTests(BannerBase):
    def test_overview_says_no_banners_then_uses_real_counters(self):
        now = timezone.now()
        self.assertEqual(overview.banners_section(now - timedelta(days=7), now)["state"], "not_tracked")
        self.make(views=200, clicks=5)
        section = overview.banners_section(now - timedelta(days=7), now)
        self.assertEqual((section["state"], section["views"], section["clicks"], section["ctr"]), ("ok", 200, 5, 2.5))
        self.make(title="Fresh", state=Banner.APPROVED, starts_at=now - timedelta(days=30), ends_at=now - timedelta(days=20))
        self.assertEqual(overview.banners_section(now - timedelta(days=7), now)["views"], 200)

    def test_ctr_is_none_without_views(self):
        self.make()
        now = timezone.now()
        self.assertIsNone(overview.banners_section(now - timedelta(days=7), now)["ctr"])

    def test_scheduled_next_lists_upcoming_banner_windows(self):
        soon = self.make(title="Soon", starts_at=timezone.now() + timedelta(days=2), ends_at=timezone.now() + timedelta(days=4))
        self.make(title="Later", starts_at=timezone.now() + timedelta(days=40), ends_at=None)
        self.make(title="Waiting", state=Banner.WAITING, starts_at=timezone.now() + timedelta(days=3))
        rows = overview.scheduled_next()
        rows = [r for r in rows if r["kind"] == "banner"]
        self.assertEqual([(r["what"].split(": ")[1], r["status"]) for r in rows], [("Soon", "Scheduled"), ("Waiting", "Waiting for Super Admin")])
        self.assertEqual(rows[0]["at"], soon.starts_at)

    def test_calendar_entries(self):
        now = timezone.now()
        a = self.make(title="Live now")
        self.make(title="Gone", starts_at=now - timedelta(days=9), ends_at=now - timedelta(days=8))
        self.make(title="Rejected", state=Banner.REJECTED)
        out = banner_entries(now - timedelta(days=1), now + timedelta(days=7))
        self.assertEqual([(e["id"], e["kind"], e["status"]) for e in out], [(a.pk, "banner", "live")])
        self.assertEqual(set(out[0]), {"id", "kind", "title", "starts_at", "ends_at", "status"})

    def test_overview_endpoint_still_works(self):
        self.make()
        self.as_staff(self.akua)
        r = self.client.get("/api/marketing/overview/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["banners"]["state"], "ok")


# ─── Featured slots ─────────────────────────────────────────────────────────
class FeaturedBase(MarketingBase):
    def setUp(self):
        super().setUp()
        self.cat = Category.objects.get(slug="hotels")
        self.cat2 = Category.objects.exclude(pk=self.cat.pk).first()
        self.zone = Zone.objects.get(name="Manhyia")
        self.monday = featured.week_start_of(timezone.localdate())

    def owner(self, name="Akosua Ntoma Kente", **extra):
        n = next(_n)
        o = BusinessOwner.objects.create(full_name=f"{name} owner", login_phone=f"+233207990{n:03d}", password_hash="x", **extra)
        BusinessOwnerProfile.objects.create(business_owner=o, business_name=name)
        return o

    def promo(self, owner=None, *, days=7, status=Promotion.ACTIVE, kind=Promotion.FEATURED, **listing_extra):
        owner = owner or self.owner()
        listing = Listing.objects.create(business_owner=owner, category=self.cat, zone=self.zone, name=f"Kente {next(_n)}", description="D.",
                                         contact_phone="+233207990999", price_amount="150.00", status=Listing.PUBLISHED, **listing_extra)
        now = timezone.now()
        return Promotion.objects.create(listing=listing, kind=kind, starts_at=now, ends_at=now + timedelta(days=days), amount_paid="35.00", status=status)

    def book(self, promo, slot="home-1", week=None, weeks=1, **extra):
        body = {"promotion_id": promo.pk, "slot_key": slot, "week_start": (week or self.monday).isoformat(), "weeks": weeks, **extra}
        self.as_staff(self.akua)
        return self.client.post("/api/marketing/featured/bookings/", body, format="json")


class FeaturedSeedTests(FeaturedBase):
    def test_slot_config_is_seeded_by_migration(self):
        got = {s.key: (s.kind, str(s.weekly_price), s.capacity) for s in FeaturedSlot.objects.all()}
        self.assertEqual(got, {"home-1": ("home", "150.00", 1), "home-2": ("home", "150.00", 1), "home-3": ("home", "150.00", 1),
                               "home-4": ("home", "150.00", 1), "category-top": ("category_top", "60.00", 2)})
        self.assertEqual(FeaturedBooking.objects.count(), 0)


class FeaturedBookingTests(FeaturedBase):
    def test_permissions(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/marketing/featured/grid/").status_code, 403)
        self.assertEqual(self.client.post("/api/marketing/featured/bookings/", {}, format="json").status_code, 403)

    def test_book_active_and_pending_promotions_and_conflict(self):
        p1, p2 = self.promo(), self.promo(status=Promotion.PENDING)
        r = self.book(p1)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.book(p2).status_code, 409)
        self.assertEqual(self.book(p2, slot="home-2").status_code, 201)
        self.assertEqual(Promotion.objects.get(pk=p1.pk).amount_paid, Decimal("35.00"))
        grid = self.client.get("/api/marketing/featured/grid/").json()
        cells = {row["name"]: row["cells"][0]["state"] for row in grid["rows"]}
        self.assertEqual((cells["Home · slot 1"], cells["Home · slot 2"], cells["Home · slot 3"]), ("booked", "waiting", "open"))
        self.assertEqual(grid["summary"]["booked"], 1)
        self.assertEqual(grid["summary"]["list_price_total"], "150.00")
        self.assertIn("not reconciled", grid["prices"]["note"])

    def test_boost_and_stopped_and_finished_promotions_cannot_book(self):
        self.assertEqual(self.book(self.promo(kind=Promotion.BOOST)).status_code, 400)
        self.assertEqual(self.book(self.promo(status=Promotion.REJECTED)).status_code, 400)
        p = self.promo()
        Promotion.objects.filter(pk=p.pk).update(ends_at=timezone.now() - timedelta(days=1))
        self.assertEqual(self.book(p).status_code, 400)

    def test_dates_must_be_a_current_or_future_monday(self):
        p = self.promo(days=28)
        self.assertEqual(self.book(p, week=self.monday + timedelta(days=1)).status_code, 400)
        self.assertEqual(self.book(p, week=self.monday - timedelta(weeks=1)).status_code, 400)
        self.assertEqual(self.book(p, week=self.monday + timedelta(weeks=40)).status_code, 400)
        self.assertEqual(self.book(p, weeks=5).status_code, 400)

    def test_cannot_hold_more_weeks_than_the_promotion_paid_for(self):
        p = self.promo(days=7)
        r = self.book(p, weeks=2)
        self.assertEqual((r.status_code, r.json()["code"]), (409, "beyond_paid"))
        p14 = self.promo(days=14)
        self.assertEqual(self.book(p14, weeks=2).status_code, 201)
        self.assertEqual(FeaturedBooking.objects.filter(promotion=p14).count(), 2)
        self.assertEqual(self.book(p14, slot="home-3").json()["code"], "already_placed")

    def test_category_top_has_two_places_per_category(self):
        a, b, c = self.promo(), self.promo(), self.promo()
        self.assertEqual(self.book(a, slot="category-top").status_code, 400)
        self.assertEqual(self.book(a, slot="category-top", category=self.cat.pk).status_code, 201)
        self.assertEqual(self.book(b, slot="category-top", category=self.cat.pk).status_code, 409)
        self.assertEqual(self.book(b, slot="category-top", category=self.cat.pk, position=2).status_code, 201)
        self.assertEqual(self.book(c, slot="category-top", category=self.cat.pk, position=3).status_code, 400)
        self.assertEqual(self.book(c, slot="category-top", category=self.cat2.pk).status_code, 201)
        self.assertEqual(self.book(self.promo(), slot="home-1", category=self.cat.pk).status_code, 400)

    def test_blocked_businesses_and_listings(self):
        cases = {}
        fraud_owner = self.owner("Suame Auto Parts")
        FraudFlag.objects.create(kind=FraudFlag.DUPLICATE, source=FraudFlag.STAFF, title="x", business_owner=fraud_owner)
        cases["fraud_hold"] = self.promo(fraud_owner)
        late_owner = self.owner("Late Payer")
        plan = SubscriptionPlan.objects.get(tier="product_basic")
        past = timezone.now() - timedelta(days=5)
        Subscription.objects.create(business_owner=late_owner, plan=plan, current_period_start=past - timedelta(days=30), current_period_end=past, overdue_since=past)
        cases["subscription_overdue"] = self.promo(late_owner)
        cases["hidden_business"] = self.promo(self.owner("Suspended", is_suspended=True))
        cases["out_of_stock"] = self.promo(stock_quantity=0)
        unmoderated = self.promo()
        Listing.objects.filter(pk=unmoderated.listing_id).update(status=Listing.PENDING_REVIEW)
        cases["listing_not_live"] = unmoderated
        for code, promo in cases.items():
            r = self.book(promo)
            self.assertEqual((r.status_code, r.json().get("code")), (409, code), code)
        self.assertEqual(FeaturedBooking.objects.count(), 0)
        cands = {c["promotion_id"]: [x["code"] for x in c["blockers"]] for c in self.client.get("/api/marketing/featured/candidates/").json()["promotions"]}
        self.assertIn("fraud_hold", cands[cases["fraud_hold"].pk])

    def test_open_fraud_case_after_booking_shows_held_and_leaves_the_site(self):
        owner = self.owner()
        p = self.promo(owner)
        self.book(p)
        self.assertEqual(len(featured.public_listings()), 1)
        FraudFlag.objects.create(kind=FraudFlag.DUPLICATE, source=FraudFlag.STAFF, title="x", business_owner=owner)
        grid = self.client.get("/api/marketing/featured/grid/").json()
        cell = next(r for r in grid["rows"] if r["slot_key"] == "home-1")["cells"][0]
        self.assertEqual(cell["state"], "held")
        self.assertEqual(featured.public_listings(), [])

    def test_release_frees_the_place_and_is_not_repeatable(self):
        p = self.promo()
        bid = self.book(p).json()["booked"][0]
        self.assertEqual(self.client.post(f"/api/marketing/featured/bookings/{bid}/release/", {"note": "Business asked"}, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"/api/marketing/featured/bookings/{bid}/release/", {}, format="json").status_code, 409)
        self.assertEqual(self.book(self.promo()).status_code, 201)

    def test_a_stopped_promotion_no_longer_holds_its_place(self):
        p = self.promo()
        self.book(p)
        Promotion.objects.filter(pk=p.pk).update(status=Promotion.CANCELLED)
        cell = next(r for r in self.client.get("/api/marketing/featured/grid/").json()["rows"] if r["slot_key"] == "home-1")["cells"][0]
        self.assertEqual(cell["state"], "stopped")
        self.assertEqual(self.book(self.promo()).status_code, 201)

    def test_category_rows_appear_for_booked_categories_only(self):
        self.book(self.promo(), slot="category-top", category=self.cat.pk)
        rows = [r["name"] for r in self.client.get("/api/marketing/featured/grid/").json()["rows"]]
        self.assertIn(f"{self.cat.label} · top 1", rows)
        self.assertEqual(sum(1 for r in rows if "top" in r), 1)


class PublicFeaturedTests(FeaturedBase):
    def test_home_row_shows_only_active_booked_this_week_without_private_fields(self):
        self.book(self.promo())
        self.book(self.promo(status=Promotion.PENDING), slot="home-2")
        self.book(self.promo(), slot="home-3", week=self.monday + timedelta(weeks=1))
        self.client.credentials()
        r = self.client.get("/api/marketing/featured/home/")
        self.assertEqual(r.status_code, 200)
        rows = r.json()["listings"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {"id", "name", "main_photo", "price_amount", "price_unit", "category", "business", "verified"})

    def test_category_row(self):
        self.book(self.promo(), slot="category-top", category=self.cat.pk)
        self.client.credentials()
        self.assertEqual(len(self.client.get("/api/marketing/featured/home/?category=hotels").json()["listings"]), 1)
        self.assertEqual(self.client.get("/api/marketing/featured/home/").json()["listings"], [])
