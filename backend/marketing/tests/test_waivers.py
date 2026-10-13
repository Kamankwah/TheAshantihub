"""Free-delivery promos: ownership isolation, moderation, the checkout waiver math and window edges."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from marketing import waivers
from marketing.models_waivers import DeliveryWaiver
from marketing.tests.test_promos import PromoBase
from orders.models import Order

FEE = {"total": "15.00", "lines": [], "distance_km": "3", "distance_basis": "test"}
FEE_ON = override_settings(DELIVERY_FEE_ENABLED=True)
DOOR = {"delivery_method": "door_to_door", "delivery_address": "1 Road", "delivery_phone": "+233200660001", "delivery_lat": 6.69, "delivery_lng": -1.62}


def fee_patch():
    return mock.patch("delivery.rates.checkout_fee", lambda items, lat, lng, **kw: (None, dict(FEE)))


class WaiverBase(PromoBase):
    def setUp(self):
        super().setUp()
        self.t0 = timezone.now()

    def body(self, **kw):
        d = {"name": "Free delivery week", "starts_at": (self.t0 - timedelta(hours=1)).isoformat(),
             "ends_at": (self.t0 + timedelta(days=3)).isoformat(), "all_items": True}
        d.update(kw)
        return d

    def waiver(self, owner=None, status=DeliveryWaiver.ACTIVE, listings=None, start=None, end=None):
        w = DeliveryWaiver.objects.create(
            business_owner=owner or self.owner, name="Free", status=status, all_items=listings is None,
            starts_at=start or self.t0 - timedelta(hours=1), ends_at=end or self.t0 + timedelta(days=1),
        )
        if listings:
            w.listings.set(listings)
        return w

    def order_for(self, *listings, **body):
        for l in listings:
            self.add(self.ama, l, 1)
        with fee_patch():
            return self.checkout(self.ama, **{**DOOR, **body})


class OwnerIsolation(WaiverBase):
    def test_owner_creates_pending_promo_on_own_items_only(self):
        self.as_owner(self.owner)
        r = self.client.post("/api/marketing/owner/delivery-promos/", self.body(all_items=False, listing_ids=[self.stole.pk]), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()["status"], r.json()["live"]), ("pending", False))

    def test_owner_cannot_name_another_vendors_item(self):
        self.as_owner(self.owner)
        r = self.client.post("/api/marketing/owner/delivery-promos/", self.body(all_items=False, listing_ids=[self.stole.pk, self.cloth.pk]), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(DeliveryWaiver.objects.exists())

    def test_owner_cannot_see_or_change_another_vendors_promo(self):
        other = self.waiver(self.owner2)
        self.as_owner(self.owner)
        self.assertEqual(self.client.get("/api/marketing/owner/delivery-promos/").json()["results"], [])
        for action in ("pause", "resume", "end"):
            self.assertEqual(self.client.post(f"/api/marketing/owner/delivery-promos/{other.pk}/{action}/").status_code, 404)
        other.refresh_from_db()
        self.assertEqual(other.status, DeliveryWaiver.ACTIVE)

    def test_owner_pause_resume_end_own(self):
        w = self.waiver()
        self.as_owner(self.owner)
        base = f"/api/marketing/owner/delivery-promos/{w.pk}"
        self.assertEqual(self.client.post(f"{base}/pause/").json()["status"], "paused")
        self.assertEqual(self.client.post(f"{base}/resume/").json()["status"], "active")
        self.assertEqual(self.client.post(f"{base}/end/").json()["status"], "ended")
        self.assertEqual(self.client.post(f"{base}/pause/").status_code, 409)

    def test_customer_and_anonymous_are_refused_and_owner_cannot_use_staff_queue(self):
        self.client.credentials()
        self.assertIn(self.client.get("/api/marketing/owner/delivery-promos/").status_code, (401, 403))
        self.as_customer(self.ama)
        self.assertEqual(self.client.post("/api/marketing/owner/delivery-promos/", self.body(), format="json").status_code, 403)
        w = self.waiver(status=DeliveryWaiver.PENDING)
        self.as_owner(self.owner)
        self.assertEqual(self.client.post(f"/api/marketing/delivery-promos/{w.pk}/approve/").status_code, 403)

    def test_owner_cannot_resume_a_rejected_or_pending_promo_into_life(self):
        w = self.waiver(status=DeliveryWaiver.PENDING)
        self.as_owner(self.owner)
        self.assertEqual(self.client.post(f"/api/marketing/owner/delivery-promos/{w.pk}/resume/").status_code, 409)


class Moderation(WaiverBase):
    def test_queue_defaults_to_pending_and_unknown_status_falls_back(self):
        self.waiver(status=DeliveryWaiver.PENDING)
        self.waiver(status=DeliveryWaiver.ACTIVE)
        self.as_staff(self.akua)
        self.assertEqual(len(self.client.get("/api/marketing/delivery-promos/").json()["results"]), 1)
        self.assertEqual(len(self.client.get("/api/marketing/delivery-promos/?status=bogus").json()["results"]), 1)
        self.assertEqual(len(self.client.get("/api/marketing/delivery-promos/?status=approved").json()["results"]), 1)

    def test_approve_reject_rereview_set_reviewer(self):
        w = self.waiver(status=DeliveryWaiver.PENDING)
        self.as_staff(self.scout)
        self.assertEqual(self.client.post(f"/api/marketing/delivery-promos/{w.pk}/approve/").status_code, 403)
        self.as_staff(self.akua)
        self.assertEqual(self.client.post(f"/api/marketing/delivery-promos/{w.pk}/reject/", {}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/marketing/delivery-promos/{w.pk}/re-review/").status_code, 400)
        self.client.post(f"/api/marketing/delivery-promos/{w.pk}/reject/", {"reason": "Too long"}, format="json")
        w.refresh_from_db()
        self.assertEqual((w.status, w.reviewed_by), ("rejected", self.akua))
        self.client.post(f"/api/marketing/delivery-promos/{w.pk}/re-review/")
        w.refresh_from_db()
        self.assertEqual((w.status, w.reviewed_by, w.rejection_reason), ("pending", None, ""))
        self.assertEqual(self.client.post(f"/api/marketing/delivery-promos/{w.pk}/approve/").json()["status"], "active")

    def test_staff_create_is_live_at_once_for_one_business(self):
        self.as_staff(self.akua)
        r = self.client.post("/api/marketing/delivery-promos/", self.body(business_owner=self.owner.pk), format="json")
        self.assertEqual((r.status_code, r.json()["status"], r.json()["source"]), (201, "active", "staff"))
        self.assertEqual(self.client.post("/api/marketing/delivery-promos/", self.body(), format="json").status_code, 400)

    def test_pending_promo_does_not_waive(self):
        self.waiver(status=DeliveryWaiver.PENDING)
        with FEE_ON:
            r = self.order_for(self.stole)
        self.assertEqual(Decimal(str(r.json()["total_amount"])), Decimal("115.00"))


@FEE_ON
class WaiverCheckout(WaiverBase):
    def charged(self, r):
        self.assertEqual(r.status_code, 201, r.content)
        return Decimal(str(r.json()["total_amount"])), r.json()["delivery_fee"]

    def test_no_promo_charges_the_fee(self):
        total, fee = self.charged(self.order_for(self.stole))
        self.assertEqual((total, Decimal(str(fee))), (Decimal("115.00"), Decimal("15.00")))

    def test_waiver_zeroes_the_fee_and_keeps_the_original_in_the_breakdown(self):
        w = self.waiver()
        total, fee = self.charged(self.order_for(self.stole))
        self.assertEqual((total, Decimal(str(fee))), (Decimal("100.00"), Decimal("0.00")))
        order = Order.objects.get()
        self.assertEqual(order.delivery_fee_breakdown["waived"], {"amount": "15.00", "waiver_id": w.pk, "name": "Free", "business_id": self.owner.pk})

    @override_settings(MARKETING_PROMOS_ENABLED=True)
    def test_waiver_stacks_with_a_coupon_only_on_items(self):
        self.waiver()
        self.coupon()
        r = self.order_for(self.stole, coupon_code="SAVE10")
        self.assertEqual(self.charged(r)[0], Decimal("90.00"))

    def test_only_listed_items_qualify(self):
        other = self.listing(self.owner, "Scarf", "50.00", 10)
        self.waiver(listings=[self.stole])
        total, _ = self.charged(self.order_for(self.stole, other))
        self.assertEqual(total, Decimal("165.00"))  # 150 + 15: the Scarf is not covered

    def test_listed_items_all_covered(self):
        other = self.listing(self.owner, "Scarf", "50.00", 10)
        self.waiver(listings=[self.stole, other])
        self.assertEqual(self.charged(self.order_for(self.stole, other))[0], Decimal("150.00"))

    def test_mixed_business_cart_is_never_waived(self):
        self.waiver(self.owner)
        self.waiver(self.owner2)
        total, fee = self.charged(self.order_for(self.stole, self.cloth))
        self.assertEqual((total, Decimal(str(fee))), (Decimal("315.00"), Decimal("15.00")))

    def test_another_vendors_promo_never_waives_my_order(self):
        self.waiver(self.owner2)
        self.assertEqual(self.charged(self.order_for(self.stole))[0], Decimal("115.00"))

    def test_paused_ended_and_pickup_orders(self):
        self.waiver(status=DeliveryWaiver.PAUSED)
        self.waiver(status=DeliveryWaiver.ENDED)
        self.assertEqual(self.charged(self.order_for(self.stole))[0], Decimal("115.00"))
        self.waiver()
        self.add(self.ama, self.stole, 1)
        r = self.checkout(self.ama)  # store pickup: no fee, nothing to waive
        self.assertIsNone(r.json()["delivery_fee"])

    @override_settings(DELIVERY_FEE_ENABLED=False)
    def test_fee_switch_off_changes_nothing(self):
        self.waiver()
        r = self.order_for(self.stole)
        self.assertEqual((Decimal(str(r.json()["total_amount"])), r.json()["delivery_fee"]), (Decimal("100.00"), None))

    def test_window_edges_are_half_open(self):
        now = self.t0
        w = self.waiver(start=now, end=now + timedelta(hours=1))
        self.assertIsNotNone(waivers.covering_waiver([self.stole], now))                               # starts_at: in
        self.assertIsNone(waivers.covering_waiver([self.stole], now - timedelta(microseconds=1)))      # just before: out
        self.assertIsNotNone(waivers.covering_waiver([self.stole], now + timedelta(hours=1) - timedelta(microseconds=1)))
        self.assertIsNone(waivers.covering_waiver([self.stole], now + timedelta(hours=1)))             # ends_at: out
        self.assertTrue(w.is_live(now) and not w.is_live(now + timedelta(hours=1)))

    def test_expired_but_still_active_status_never_waives(self):
        self.waiver(start=self.t0 - timedelta(days=2), end=self.t0 - timedelta(days=1))
        self.assertEqual(self.charged(self.order_for(self.stole))[0], Decimal("115.00"))


@override_settings(MARKETING_PROMOS_ENABLED=True, DELIVERY_FEE_ENABLED=True)
class WaiverQuote(WaiverBase):
    def quote(self, *listings):
        from cart.models import CartItem

        CartItem.objects.all().delete()
        for l in listings:
            self.add(self.ama, l, 1)
        self.as_customer(self.ama)
        with fee_patch():
            return self.client.post("/api/marketing/cart/quote/", DOOR, format="json").json()["delivery"]

    def test_quote_matches_checkout(self):
        self.assertEqual(self.quote(self.stole)["fee"], "15.00")
        DeliveryWaiver.objects.all().delete()
        self.waiver()
        d = self.quote(self.stole)
        self.assertEqual((d["fee"], d["waived"], d["waived_fee"], d["waiver_name"]), ("0.00", True, "15.00", "Free"))

    def test_quote_says_why_a_mixed_cart_is_not_free(self):
        self.waiver(self.owner)
        d = self.quote(self.stole, self.cloth)
        self.assertFalse(d["waived"])
        self.assertIn("same business", d["mixed_note"])

    def test_quote_has_no_delivery_block_for_pickup(self):
        self.add(self.ama, self.stole, 1)
        self.as_customer(self.ama)
        self.assertIsNone(self.client.post("/api/marketing/cart/quote/", {}, format="json").json()["delivery"])
