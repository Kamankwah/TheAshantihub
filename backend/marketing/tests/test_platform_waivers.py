"""AshantiHub-funded free-delivery promos (plan 7F-E Task 4, Ruling R2): created by Marketing, always approved by
Operations or a Super Admin through the approvals engine, capped by a required budget."""
from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from accounts.models import Permission, Role
from accounts.testing import make_staff
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.services import MakerCannotDecide, NotYourDecision
from ledger import escrow
from ledger.models import Account
from ledger.tests.test_refunds import RefundBase
from marketing import waivers
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from marketing.tests.test_waivers import DOOR, FEE_ON, WaiverBase, fee_patch

URL = "/api/marketing/delivery-promos/platform/"


class PlatformBase(WaiverBase):
    def setUp(self):
        super().setUp()
        self.ops = make_staff("operations", "ops-platform@example.com")
        self.support = make_staff("support", "support-platform@example.com")
        Role.objects.get(name="support").permissions.add(Permission.objects.get(codename="site_promo.manage"))

    def propose(self, staff=None, **kw):
        self.as_staff(staff or self.akua)
        return self.client.post(URL, self.body(business_owner=self.owner.pk, budget_cap="500.00", **kw), format="json")

    def pending(self):
        r = self.propose()
        self.assertEqual(r.status_code, 201, r.content)
        return DeliveryWaiver.objects.get(pk=r.json()["id"]), ApprovalRequest.objects.get(pk=r.json()["approval"]["id"])


class CreateAndApprove(PlatformBase):
    def test_marketing_creates_platform_promo_and_it_waits_for_approval(self):
        r = self.propose()
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual((body["status"], body["live"], body["funded_by"], body["budget_cap"]), ("pending", False, "platform", "500.00"))
        self.assertEqual((body["awaiting_approval"], body["approval"]["status"]), (True, "pending"))
        self.assertEqual(body["approval_id"], body["approval"]["id"])
        approval = ApprovalRequest.objects.get(pk=body["approval_id"])
        self.assertEqual((approval.kind, approval.amount, approval.maker), ("marketing.delivery_promo_funding", Decimal("500.00"), self.akua))
        self.assertEqual(approval.pool_permission, "delivery_promo.approve")

    def test_operations_can_approve_and_promo_goes_live(self):
        w, a = self.pending()
        approvals.approve(a.pk, self.ops)
        w.refresh_from_db()
        self.assertEqual((w.status, w.reviewed_by, w.is_live()), (DeliveryWaiver.ACTIVE, self.ops, True))
        self.assertEqual(w.charges.count(), 0)
        self.assertTrue(self.owner.notifications.filter(title="AshantiHub is covering delivery on your items").exists())

    def test_super_admin_can_approve(self):
        w, a = self.pending()
        approvals.approve(a.pk, self.boss)
        w.refresh_from_db()
        self.assertEqual((w.status, w.reviewed_by), (DeliveryWaiver.ACTIVE, self.boss))

    def test_maker_cannot_approve_own_promo(self):
        w, a = self.pending()
        with self.assertRaises(MakerCannotDecide):
            approvals.approve(a.pk, self.akua)
        w.refresh_from_db()
        self.assertEqual(w.status, DeliveryWaiver.PENDING)

    def test_super_admin_own_request_applies_at_once(self):
        self.as_staff(self.boss)
        r = self.client.post(URL, self.body(business_owner=self.owner.pk, budget_cap="200"), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()["status"], r.json()["live"], r.json()["approval"]["status"]), ("active", True, "approved"))

    def test_support_without_approve_permission_cannot_decide(self):
        w, a = self.pending()
        with self.assertRaises(NotYourDecision):
            approvals.approve(a.pk, self.support)
        w.refresh_from_db()
        self.assertEqual(w.status, DeliveryWaiver.PENDING)

    def test_rejected_promo_is_rejected_with_reason(self):
        w, a = self.pending()
        approvals.reject(a.pk, self.ops, "Too generous for this week")
        w.refresh_from_db()
        self.assertEqual((w.status, w.rejection_reason, w.reviewed_by), (DeliveryWaiver.REJECTED, "Too generous for this week", self.ops))

    def test_approving_after_window_ended_is_refused(self):
        w, a = self.pending()
        DeliveryWaiver.objects.filter(pk=w.pk).update(starts_at=self.t0 - timedelta(days=3), ends_at=self.t0 - timedelta(days=1))
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(a.pk, self.ops)

    def test_staff_without_fund_permission_gets_403(self):
        r = self.propose(self.support)
        self.assertEqual(r.status_code, 403)
        self.assertFalse(DeliveryWaiver.objects.exists())

    def test_operations_cannot_create(self):
        self.assertEqual(self.propose(self.ops).status_code, 403)

    def test_cap_required_and_positive(self):
        self.as_staff(self.akua)
        for cap in (None, "", "0", "-5", "abc", True, "NaN"):
            body = self.body(business_owner=self.owner.pk)
            if cap is not None:
                body["budget_cap"] = cap
            r = self.client.post(URL, body, format="json")
            self.assertEqual(r.status_code, 400, (cap, r.content))
        self.assertFalse(DeliveryWaiver.objects.exists())

    def test_blocked_business_is_403_and_bad_window_is_400(self):
        self.owner.kyc_status = "pending"
        self.owner.save()
        self.assertEqual(self.propose().status_code, 403)  # owner_blocker raises a 403 WaiverError, as for staff promos
        self.owner.kyc_status = "verified"
        self.owner.save()
        r = self.propose(ends_at=(self.t0 - timedelta(days=1)).isoformat())
        self.assertEqual(r.status_code, 400)

    def test_activity_event_written_with_cap_and_funder(self):
        w, _ = self.pending()
        event = ActivityEvent.objects.filter(verb="marketing.delivery_promo_created").get()
        self.assertEqual(event.after["budget_cap"], "500.00")
        self.assertEqual(event.after["funded_by"], "platform")
        self.assertEqual(event.after["business_id"], self.owner.pk)
        self.assertEqual(event.target_id, str(w.pk))


class BusinessSideUnchanged(PlatformBase):
    def test_business_cannot_create_platform_funded(self):
        self.as_owner(self.owner)
        r = self.client.post("/api/marketing/owner/delivery-promos/", self.body(funded_by="platform", budget_cap="900"), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        w = DeliveryWaiver.objects.get()
        self.assertEqual((w.funded_by, w.budget_cap, w.status), ("business", None, "pending"))

    def test_create_for_staff_ignores_funded_by(self):
        self.as_staff(self.akua)
        r = self.client.post("/api/marketing/delivery-promos/", self.body(business_owner=self.owner.pk, funded_by="platform", budget_cap="900"), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        w = DeliveryWaiver.objects.get()
        self.assertEqual((w.funded_by, w.budget_cap, w.status), ("business", None, "active"))

    def test_waivers_approve_reject_refuse_platform_promo(self):
        w, _ = self.pending()
        for call in (lambda: waivers.approve(w.pk, self.akua), lambda: waivers.reject(w.pk, self.akua, "no"), lambda: waivers.re_review(w.pk)):
            with self.assertRaises(waivers.WaiverError) as ctx:
                call()
            self.assertEqual(ctx.exception.status_code, 409)
        self.as_staff(self.akua)
        self.assertEqual(self.client.post(f"/api/marketing/delivery-promos/{w.pk}/approve/").status_code, 409)
        w.refresh_from_db()
        self.assertEqual(w.status, DeliveryWaiver.PENDING)

    def test_permission_seed_roles(self):
        def roles(code):
            return set(Role.objects.filter(permissions__codename=code).values_list("name", flat=True))
        self.assertEqual(roles("delivery_promo.fund"), {"marketing", "super_admin"})
        self.assertEqual(roles("delivery_promo.approve"), {"operations", "super_admin"})

    def test_coupon_and_campaign_kinds_unchanged(self):
        from approvals.registry import get_kind
        for key in ("marketing.coupon", "marketing.campaign", "marketing.banner", "marketing.send_policy"):
            kind = get_kind(key)
            self.assertEqual((kind.chain_note, kind.pool_permission), ("Super Admin only", ""), key)
        kind = get_kind("marketing.delivery_promo_funding")
        self.assertEqual((kind.chain_note, kind.requires_sudo), ("Operations or Super Admin", True))


@FEE_ON
class CheckoutAndCap(PlatformBase):
    def live_platform_promo(self, cap="500.00"):
        return DeliveryWaiver.objects.create(
            business_owner=self.owner, name="AshantiHub free", status=DeliveryWaiver.ACTIVE, all_items=True, source="staff",
            funded_by="platform", budget_cap=Decimal(cap), starts_at=self.t0 - timedelta(hours=1), ends_at=self.t0 + timedelta(days=1),
        )

    def test_checkout_copies_platform_funder_to_charge(self):
        self.live_platform_promo()
        r = self.order_for(self.stole)
        self.assertEqual(r.status_code, 201, r.content)
        c = WaivedFeeCharge.objects.get()
        self.assertEqual((c.funded_by, c.amount), ("platform", Decimal("15.00")))

    def test_exhausted_cap_stops_waiving_the_fee(self):
        w = self.live_platform_promo(cap="20.00")
        self.assertEqual(self.order_for(self.stole).status_code, 201)       # 15 of 20 used, one more order still quoted waived
        self.assertEqual(waivers.spent(w), Decimal("15.00"))
        self.assertEqual(waivers.cap_left(w), Decimal("5.00"))
        self.assertEqual(self.order_for(self.stole).status_code, 201)       # the second is still waived (cap left > 0)
        self.assertEqual(waivers.cap_left(w), Decimal("-10.00"))
        self.assertEqual(waivers.live_waivers(self.owner.pk, timezone.now()), [])
        self.assertIsNone(waivers.covering_waiver([self.stole], timezone.now()))
        w.refresh_from_db()
        self.assertEqual(w.status, DeliveryWaiver.ACTIVE)                    # derived, not a status change
        self.assertEqual(self.order_for(self.stole).status_code, 201)
        self.assertEqual(WaivedFeeCharge.objects.count(), 2)                 # the third paid its own fee

    def test_reversed_charge_frees_the_cap(self):
        w = self.live_platform_promo(cap="10.00")
        self.order_for(self.stole)
        self.assertEqual(waivers.live_waivers(self.owner.pk, timezone.now()), [])
        WaivedFeeCharge.objects.update(status=WaivedFeeCharge.REVERSED)
        self.assertEqual(len(waivers.live_waivers(self.owner.pk, timezone.now())), 1)


@override_settings(LEDGER_ENABLED=True)
class PlatformLedger(RefundBase):
    def test_platform_promo_release_charges_subsidy_account_not_vendor(self):
        kofi = self.owner("Kofi")
        order = self.paid([(self.listing(kofi, "120.00"), 1)], delivery="0.00")
        now = timezone.now()
        w = DeliveryWaiver.objects.create(
            business_owner=kofi, name="AH free", status=DeliveryWaiver.ACTIVE, all_items=True, source="staff", funded_by="platform",
            budget_cap=Decimal("100.00"), starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
        )
        waivers.record_charge(order, w, Decimal("15.00"))
        escrow.charge_waiver(order)
        self.assertEqual(self.balance(Account.PLATFORM_PROMO_SUBSIDY), 1500)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, kofi), 0)


class BusinessSearch(PlatformBase):
    URL = "/api/marketing/delivery-promos/business-search/"

    def get(self, q, staff=None):
        self.as_staff(staff or self.akua)
        return self.client.get(self.URL, {"q": q})

    def test_needs_the_fund_permission(self):
        self.assertEqual(self.get("ab", staff=self.support).status_code, 403)

    def test_short_query_returns_nothing(self):
        r = self.get("a")
        self.assertEqual((r.status_code, r.json()), (200, {"results": []}))

    def test_returns_only_id_and_name_of_a_verified_business(self):
        name = self.owner.display_name
        r = self.get(name[:3])
        self.assertEqual(r.status_code, 200, r.content)
        rows = r.json()["results"]
        self.assertIn({"id": self.owner.pk, "name": name}, rows)
        self.assertTrue(all(set(row) == {"id", "name"} for row in rows))
        self.assertLessEqual(len(rows), 10)

    def test_excludes_unverified_and_suspended_businesses(self):
        name = self.owner.display_name
        self.owner.kyc_status = "pending"
        self.owner.save(update_fields=["kyc_status"])
        self.assertEqual(self.get(name[:3]).json()["results"], [])
        self.owner.kyc_status, self.owner.is_suspended = "verified", True
        self.owner.save(update_fields=["kyc_status", "is_suspended"])
        self.assertEqual(self.get(name[:3]).json()["results"], [])
