import os
import tempfile
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff
from approvals.models import ApprovalRequest
from bookings.models import Booking
from disputes.models import Dispute
from fraud.models import FraudFlag
from listings.models import Listing
from orders.models import Order
from portfolio import health
from portfolio.models import BusinessHealthSnapshot, StagedPhoto
from portfolio.tasks import purge_staged_photos, snapshot_business_health
from portfolio.tests.health_fixtures import (
    add_listings,
    add_order,
    image,
    log_call,
    make_business,
    make_healthy,
    subscribe,
    subscribe_overdue,
    subscribe_paused,
)
from services.models import ServiceRequest

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def rated(owner):
    now = timezone.now()
    return health.rate(health.with_health_inputs(BusinessOwner.objects.filter(pk=owner.pk), now).get(), now)


class HealthRuleTests(TestCase):
    """Decision 12: one test per rule, including the KYC-age gate on the
    "no order" rules."""

    def setUp(self):
        self.scout = make_staff("scout", "kwame@example.com")
        self.owner = make_business("Adwoa Fabrics", manager=self.scout)

    def healthy(self, **knock_out):
        return make_healthy(self.owner, self.scout, **knock_out)

    def test_a_healthy_business_has_nothing_to_fix(self):
        self.healthy()
        self.assertEqual(rated(self.owner), (health.HEALTHY, []))

    def test_kyc_pending_is_new_and_waiting(self):
        owner = make_business("Nana's Chop Bar", kyc=BusinessOwner.PENDING)
        self.assertEqual(rated(owner), (health.NEW, ["KYC waiting"]))

    def test_a_rejected_business_is_new_without_claiming_it_waits(self):
        owner = make_business("Gone Shop", kyc=BusinessOwner.REJECTED)
        self.assertEqual(rated(owner), (health.NEW, []))

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_a_paused_subscription_is_at_risk(self):
        self.healthy(subscription=subscribe_paused)
        self.assertEqual(rated(self.owner), (health.AT_RISK, ["Subscription paused"]))

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=False)
    def test_with_the_pause_off_a_paused_row_is_only_overdue(self):
        # User decision U3: "Subscription paused" can't occur while pausing is off.
        self.healthy(subscription=subscribe_paused)
        self.assertEqual(rated(self.owner), (health.NEEDS_ATTENTION, ["Subscription overdue"]))

    def test_no_listing_live_is_at_risk_and_not_also_fewer_than_three(self):
        self.healthy(live_listings=0)
        add_listings(self.owner, 2, status=Listing.PENDING_REVIEW)
        self.assertEqual(rated(self.owner), (health.AT_RISK, ["No listing live"]))

    def test_no_paid_order_in_60_days_is_at_risk(self):
        self.healthy(order_days_ago=70)
        self.assertEqual(rated(self.owner), (health.AT_RISK, ["No order in 60 days"]))

    def test_never_ordered_once_kyc_is_30_days_old_is_at_risk(self):
        owner = make_business("Asafo Hair Studio", kyc_days=31)
        make_healthy(owner, self.scout, order_days_ago=None)
        self.assertEqual(rated(owner), (health.AT_RISK, ["No order in 60 days"]))

    def test_the_order_rules_wait_until_kyc_is_30_days_old(self):
        never = make_business("Kejetia Phone Hub", kyc_days=29)
        make_healthy(never, self.scout, order_days_ago=None)
        self.assertEqual(rated(never), (health.HEALTHY, []))
        quiet = make_business("Suame Auto Parts", kyc_days=29)
        make_healthy(quiet, self.scout, order_days_ago=45)
        self.assertEqual(rated(quiet), (health.HEALTHY, []))

    def test_only_a_confirmed_fraud_case_puts_a_business_at_risk(self):
        self.healthy()
        FraudFlag.objects.create(
            kind=FraudFlag.FAKE_BUSINESS, status=FraudFlag.OPEN, source=FraudFlag.STAFF,
            title="Looks fake", business_owner=self.owner,
        )
        FraudFlag.objects.create(
            kind=FraudFlag.DUPLICATE, status=FraudFlag.DISMISSED, source=FraudFlag.SYSTEM,
            title="Same phone", business_owner=self.owner,
        )
        self.assertEqual(rated(self.owner), (health.HEALTHY, []))
        FraudFlag.objects.create(
            kind=FraudFlag.FAKE_BUSINESS, status=FraudFlag.CONFIRMED, source=FraudFlag.STAFF,
            title="Fake shop", business_owner=self.owner,
        )
        self.assertEqual(rated(self.owner), (health.AT_RISK, ["Confirmed fraud case"]))

    def test_an_overdue_subscription_needs_attention(self):
        self.healthy(subscription=lambda owner: subscribe_overdue(owner, timezone.now() - timedelta(days=3)))
        self.assertEqual(rated(self.owner), (health.NEEDS_ATTENTION, ["Subscription overdue"]))

    def test_a_lapse_the_clock_has_not_marked_yet_counts_as_overdue(self):
        self.healthy(subscription=lambda owner: subscribe(owner, ends_at=timezone.now() - timedelta(hours=2)))
        self.assertEqual(rated(self.owner), (health.NEEDS_ATTENTION, ["Subscription overdue"]))

    def test_fewer_than_three_live_listings_needs_attention(self):
        self.healthy(live_listings=2)
        self.assertEqual(rated(self.owner), (health.NEEDS_ATTENTION, ["Fewer than 3 listings live"]))

    def test_no_paid_order_in_30_days_needs_attention(self):
        self.healthy(order_days_ago=45)
        add_order(self.owner, days_ago=2, status=Order.PENDING)  # unpaid: not an order
        other = make_business("Bantama Cold Store")
        add_listings(other, 1)
        add_order(other, days_ago=1)  # another business's sale
        self.assertEqual(rated(self.owner), (health.NEEDS_ATTENTION, ["No order in 30 days"]))

    def service_business(self):
        owner = make_business("Asafo Guest House")
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(business_kind="service")
        make_healthy(owner, self.scout, order_days_ago=None)
        customer = Customer.objects.create(full_name="Kofi Guest", phone="+233209876543", password_hash="x")
        return owner, owner.listings.order_by("pk").first(), customer

    def test_a_recent_booking_counts_as_an_order(self):
        owner, listing, customer = self.service_business()
        today = timezone.localdate()
        booking = Booking.objects.create(
            customer=customer, listing=listing, business_owner=owner, check_in=today + timedelta(days=3),
            check_out=today + timedelta(days=5), nightly_rate="200.00", total_price="400.00",
            status=Booking.CANCELLED,
        )
        self.assertEqual(rated(owner), (health.AT_RISK, ["No order in 60 days"]))  # a cancelled one doesn't
        Booking.objects.filter(pk=booking.pk).update(status=Booking.CONFIRMED)
        self.assertEqual(rated(owner), (health.HEALTHY, []))
        Booking.objects.filter(pk=booking.pk).update(created_at=timezone.now() - timedelta(days=45))
        self.assertEqual(rated(owner), (health.NEEDS_ATTENTION, ["No order in 30 days"]))

    def test_an_accepted_or_completed_service_request_counts_as_an_order(self):
        owner, listing, customer = self.service_business()
        request = ServiceRequest.objects.create(
            customer=customer, listing=listing, business_owner=owner, message="Braids for Saturday",
        )
        for status in (ServiceRequest.REQUESTED, ServiceRequest.DECLINED, ServiceRequest.CANCELLED):
            ServiceRequest.objects.filter(pk=request.pk).update(status=status)
            self.assertEqual(rated(owner), (health.AT_RISK, ["No order in 60 days"]), status)
        for status in (ServiceRequest.ACCEPTED, ServiceRequest.IN_PROGRESS, ServiceRequest.COMPLETED):
            ServiceRequest.objects.filter(pk=request.pk).update(status=status)
            self.assertEqual(rated(owner), (health.HEALTHY, []), status)

    def test_the_latest_of_order_booking_and_service_request_wins(self):
        owner, listing, customer = self.service_business()
        add_order(owner, days_ago=50)
        request = ServiceRequest.objects.create(
            customer=customer, listing=listing, business_owner=owner, message="Hair", status=ServiceRequest.COMPLETED,
        )
        ServiceRequest.objects.filter(pk=request.pk).update(created_at=timezone.now() - timedelta(days=2))
        now = timezone.now()
        annotated = health.with_health_inputs(BusinessOwner.objects.filter(pk=owner.pk), now).get()
        self.assertGreater(annotated.last_order_at, now - timedelta(days=3))

    def test_an_open_or_investigating_dispute_needs_attention(self):
        self.healthy()
        dispute = Dispute.objects.create(
            order=add_order(self.owner, days_ago=4), reason=Dispute.DELIVERY_ISSUE, description="Late",
            status=Dispute.RESOLVED,
        )
        self.assertEqual(rated(self.owner), (health.HEALTHY, []))
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.INVESTIGATING)
        self.assertEqual(rated(self.owner), (health.NEEDS_ATTENTION, ["Open dispute"]))
        Dispute.objects.filter(pk=dispute.pk).update(status=Dispute.OPEN)
        self.assertEqual(rated(self.owner), (health.NEEDS_ATTENTION, ["Open dispute"]))

    def test_a_dispute_on_another_business_order_does_not_count(self):
        self.healthy()
        other = make_business("Tafo Grains")
        add_listings(other, 1)
        Dispute.objects.create(order=add_order(other, days_ago=2), reason=Dispute.QUALITY_ISSUE, description="Torn")
        self.assertEqual(rated(self.owner), (health.HEALTHY, []))

    def test_no_call_in_30_days_needs_attention(self):
        self.healthy(call_days_ago=40)
        self.assertEqual(rated(self.owner), (health.NEEDS_ATTENTION, ["No contact in 30 days"]))

    def test_a_call_logged_about_the_business_counts_as_contact(self):
        self.healthy(call_days_ago=None)
        log_call(self.owner, self.scout, days_ago=2, about_only=True)
        self.assertEqual(rated(self.owner), (health.HEALTHY, []))

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_at_risk_reasons_come_first(self):
        self.healthy(subscription=subscribe_paused, live_listings=2, call_days_ago=40)
        Dispute.objects.create(
            order=add_order(self.owner, days_ago=3), reason=Dispute.QUALITY_ISSUE, description="Torn",
        )
        self.assertEqual(
            rated(self.owner),
            (health.AT_RISK, [
                "Subscription paused", "Fewer than 3 listings live", "Open dispute", "No contact in 30 days",
            ]),
        )

    def test_the_inputs_are_annotated_in_one_row(self):
        self.healthy()
        add_listings(self.owner, 1, status=Listing.PENDING_REVIEW)
        ApprovalRequest.objects.create(
            kind="listing.create", title="Add Kente", maker=self.scout, due_at=timezone.now() + timedelta(hours=24),
            payload={"business_owner_id": self.owner.pk, "reason": "New stock"},
        )
        ApprovalRequest.objects.create(
            kind="listing.create", title="Old", maker=self.scout, status=ApprovalRequest.APPROVED,
            due_at=timezone.now(), payload={"business_owner_id": self.owner.pk, "reason": "x"},
        )
        FraudFlag.objects.create(
            kind=FraudFlag.OTHER, source=FraudFlag.STAFF, title="Check", business_owner=self.owner,
        )
        now = timezone.now()
        owner = health.with_health_inputs(BusinessOwner.objects.filter(pk=self.owner.pk), now).get()
        self.assertEqual(
            (owner.live_listings, owner.total_listings, owner.listings_waiting, owner.open_disputes,
             owner.confirmed_fraud, owner.open_fraud_flags),
            (3, 4, 2, 0, 0, 1),
        )
        self.assertGreater(owner.last_order_at, now - timedelta(days=6))
        self.assertGreater(owner.last_call_at, now - timedelta(days=4))


class HealthSnapshotTests(TestCase):
    def setUp(self):
        self.scout = make_staff("scout", "kwame@example.com")

    def test_one_row_per_business_and_day_and_rejected_businesses_are_skipped(self):
        healthy = make_healthy(make_business("Akosua Ntoma Kente"), self.scout)
        bare = make_business("Kejetia Phone Hub")
        pending = make_business("Nana's Chop Bar", kyc=BusinessOwner.PENDING)
        make_business("Gone Shop", kyc=BusinessOwner.REJECTED)
        day = timezone.localdate()
        self.assertEqual(health.snapshot(day), 3)
        rows = {row.business_owner_id: row for row in BusinessHealthSnapshot.objects.filter(date=day)}
        self.assertEqual(set(rows), {healthy.pk, bare.pk, pending.pk})
        self.assertEqual((rows[healthy.pk].rating, rows[healthy.pk].reasons), (health.HEALTHY, []))
        self.assertEqual(rows[bare.pk].rating, health.AT_RISK)
        self.assertIn("No listing live", rows[bare.pk].reasons)
        self.assertEqual((rows[pending.pk].rating, rows[pending.pk].reasons), (health.NEW, ["KYC waiting"]))

    def test_a_second_run_on_the_same_day_updates_instead_of_duplicating(self):
        bare = make_business("Kejetia Phone Hub")
        day = timezone.localdate()
        health.snapshot(day)
        make_healthy(bare, self.scout)
        health.snapshot(day)
        self.assertEqual(BusinessHealthSnapshot.objects.filter(business_owner=bare).count(), 1)
        self.assertEqual(BusinessHealthSnapshot.objects.get(business_owner=bare).rating, health.HEALTHY)

    def test_the_nightly_job_snapshots_today(self):
        owner = make_business("Tafo Grains")
        self.assertEqual(snapshot_business_health(), 1)
        self.assertTrue(
            BusinessHealthSnapshot.objects.filter(business_owner=owner, date=timezone.localdate()).exists()
        )


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class StagedPhotoPurgeTests(TestCase):
    def setUp(self):
        self.scout = make_staff("scout", "kwame@example.com")
        self.owner = make_business("Adwoa Fabrics", manager=self.scout)

    def stage(self, *, days_old, used=False):
        photo = StagedPhoto.objects.create(
            business_owner=self.owner, uploaded_by=self.scout, image=image(),
            used_at=timezone.now() if used else None,
        )
        StagedPhoto.objects.filter(pk=photo.pk).update(created_at=timezone.now() - timedelta(days=days_old))
        return photo

    def test_old_unused_photos_and_their_files_are_purged(self):
        old = self.stage(days_old=8)
        recent = self.stage(days_old=2)
        used = self.stage(days_old=30, used=True)
        held = self.stage(days_old=9)
        ApprovalRequest.objects.create(
            kind="listing.photos", title="Photos for Kente dress", maker=self.scout,
            due_at=timezone.now() + timedelta(hours=24),
            payload={"business_owner_id": self.owner.pk, "listing_id": 1, "photo_ids": [held.pk], "reason": "x"},
        )
        old_path = old.image.path
        self.assertTrue(os.path.exists(old_path))
        self.assertEqual(purge_staged_photos(), 1)
        self.assertFalse(os.path.exists(old_path))
        self.assertEqual(set(StagedPhoto.objects.values_list("pk", flat=True)), {recent.pk, used.pk, held.pk})
