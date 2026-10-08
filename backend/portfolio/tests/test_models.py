from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from activity.models import ActivityEvent
from approvals.models import ApprovalRequest
from listings.models import Category, Listing, Zone
from portfolio.models import AccountManagerAssignment, AppliedChange, BusinessHealthSnapshot, StagedPhoto
from portfolio.services import assign_account_manager


def make_owner(phone="+233241110001", *, name="Akosua Mensah", business_name="", **extra):
    owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x", **extra)
    BusinessOwnerProfile.objects.create(business_owner=owner, business_name=business_name)
    return owner


def make_approval(maker, owner, title="Change the opening hours"):
    return ApprovalRequest.objects.create(
        kind="business.update", title=title, maker=maker, due_at=timezone.now() + timedelta(hours=24),
        target_type="accounts.businessowner", target_id=str(owner.pk), target_label=owner.display_name,
    )


class BusinessIdentityTests(TestCase):
    def test_a_new_owner_is_self_registered_with_no_manager(self):
        owner = make_owner()
        self.assertEqual(owner.registration_channel, BusinessOwner.SELF)
        self.assertEqual((owner.registered_by, owner.account_manager, owner.claimed_at), (None, None, None))
        self.assertFalse(owner.needs_claim)

    def test_a_scout_registered_owner_needs_a_claim_until_claimed(self):
        scout = make_staff("scout", "kwame@example.com")
        owner = make_owner(registration_channel=BusinessOwner.SCOUT, registered_by=scout, account_manager=scout)
        self.assertTrue(owner.needs_claim)
        self.assertEqual(list(scout.registered_businesses.all()), [owner])
        self.assertEqual(list(scout.managed_businesses.all()), [owner])
        owner.claimed_at = timezone.now()
        owner.save(update_fields=["claimed_at"])
        self.assertFalse(BusinessOwner.objects.get(pk=owner.pk).needs_claim)

    def test_display_name_is_the_business_name_falling_back_to_the_owner(self):
        self.assertEqual(make_owner(business_name="Akosua's Kitchen").display_name, "Akosua's Kitchen")
        self.assertEqual(make_owner("+233241110002", name="Yaw Boateng").display_name, "Yaw Boateng")
        self.assertEqual(make_owner("+233241110003", name="Esi Owusu", business_name="   ").display_name, "Esi Owusu")
        no_profile = BusinessOwner.objects.create(full_name="Kofi Asare", login_phone="+233241110004", password_hash="x")
        self.assertEqual(no_profile.display_name, "Kofi Asare")

    def test_a_fresh_profile_has_no_identity_or_location(self):
        profile = BusinessOwnerProfile.objects.get(business_owner=make_owner())
        self.assertEqual(
            (profile.business_name, profile.business_description, profile.opening_hours, profile.location_set_by),
            ("", "", "", ""),
        )
        self.assertEqual(
            (profile.business_category, profile.zone, profile.lat, profile.lng,
             profile.location_accuracy_m, profile.location_set_at),
            (None, None, None, None, None, None),
        )
        self.assertFalse(profile.location_is_manual)
        self.assertFalse(profile.signboard_photo)

    def test_the_profile_keeps_the_business_details_location_and_signboard(self):
        category = Category.objects.create(slug="test-chop-bar", icon="🍲", label="Chop bar", color="#b45309", kind=Category.PRODUCT)
        zone = Zone.objects.create(name="Test Adum")
        owner = make_owner(business_name="Akosua's Kitchen")
        set_at = timezone.now()
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(
            business_category=category, zone=zone, business_description="Waakye and kelewele",
            opening_hours="Mon–Sat 7am–7pm", lat=Decimal("6.688500"), lng=Decimal("-1.624400"),
            location_accuracy_m=12, location_set_by=BusinessOwnerProfile.LOCATION_BY_SCOUT,
            location_set_at=set_at, location_is_manual=True, signboard_photo="signboards/kitchen.jpg",
        )
        profile = BusinessOwnerProfile.objects.get(business_owner=owner)
        self.assertEqual((profile.business_category, profile.zone), (category, zone))
        self.assertEqual((profile.business_description, profile.opening_hours), ("Waakye and kelewele", "Mon–Sat 7am–7pm"))
        self.assertEqual((profile.lat, profile.lng, profile.location_accuracy_m), (Decimal("6.688500"), Decimal("-1.624400"), 12))
        self.assertEqual((profile.location_set_by, profile.location_set_at, profile.location_is_manual), ("scout", set_at, True))
        self.assertEqual(profile.signboard_photo.name, "signboards/kitchen.jpg")

    def test_removing_a_category_or_zone_keeps_the_profile(self):
        category = Category.objects.create(slug="test-tailor", icon="🧵", label="Tailor", color="#1d4ed8", kind=Category.SERVICE)
        zone = Zone.objects.create(name="Test Bantama")
        owner = make_owner()
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(business_category=category, zone=zone)
        category.delete()
        zone.delete()
        profile = BusinessOwnerProfile.objects.get(business_owner=owner)
        self.assertEqual((profile.business_category, profile.zone), (None, None))


class ListingCreatedByStaffTests(TestCase):
    def test_a_listing_remembers_the_staff_member_who_created_it(self):
        scout = make_staff("scout", "kwame@example.com")
        owner = make_owner()
        category = Category.objects.create(slug="test-groceries", icon="🛒", label="Groceries", color="#15803d", kind=Category.PRODUCT)
        zone = Zone.objects.create(name="Test Kejetia")
        common = dict(business_owner=owner, category=category, zone=zone, description="Fresh", contact_phone="+233241110001")
        by_scout = Listing.objects.create(name="Gari", created_by_staff=scout, **common)
        by_owner = Listing.objects.create(name="Shito", **common)
        self.assertEqual(list(scout.listings_created_for_owners.all()), [by_scout])
        self.assertIsNone(by_owner.created_by_staff)


class AssignAccountManagerTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.yaw = make_staff("scout", "yaw@example.com", manager=self.lead)
        self.owner = make_owner()

    def test_the_first_assignment_opens_a_row_and_sets_the_manager(self):
        assignment = assign_account_manager(self.owner, self.kwame, by=self.lead, reason="Registered by Kwame")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.account_manager, self.kwame)
        self.assertEqual(
            (assignment.scout, assignment.assigned_by, assignment.reason, assignment.ended_at),
            (self.kwame, self.lead, "Registered by Kwame", None),
        )

    def test_reassigning_ends_the_open_row_and_keeps_the_history(self):
        first = assign_account_manager(self.owner, self.kwame, by=self.lead, reason="Registered by Kwame")
        second = assign_account_manager(self.owner, self.yaw, by=self.lead, reason="Kwame moved to Ejisu")
        first.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual(first.ended_at, second.started_at)
        self.assertIsNone(second.ended_at)
        self.assertEqual(self.owner.account_manager, self.yaw)
        self.assertEqual(self.owner.manager_assignments.filter(ended_at__isnull=True).count(), 1)
        self.assertEqual(list(self.owner.manager_assignments.all()), [second, first])

    def test_assigning_nobody_ends_the_open_row_and_clears_the_manager(self):
        assign_account_manager(self.owner, self.kwame, by=self.lead, reason="Registered by Kwame")
        self.assertIsNone(assign_account_manager(self.owner, None, by=self.lead, reason="Kwame left"))
        self.owner.refresh_from_db()
        self.assertIsNone(self.owner.account_manager)
        self.assertFalse(self.owner.manager_assignments.filter(ended_at__isnull=True).exists())
        self.assertEqual(self.owner.manager_assignments.count(), 1)

    def test_a_system_assignment_has_no_assigner(self):
        assignment = assign_account_manager(self.owner, self.kwame, by=None, reason="")
        self.assertEqual((assignment.assigned_by, assignment.reason), (None, ""))

    def test_the_database_allows_one_open_assignment_per_business(self):
        assign_account_manager(self.owner, self.kwame, by=self.lead, reason="")
        with self.assertRaises(IntegrityError), transaction.atomic():
            AccountManagerAssignment.objects.create(business_owner=self.owner, scout=self.yaw)

    def test_it_records_nothing_itself(self):
        assign_account_manager(self.owner, self.kwame, by=self.lead, reason="Registered by Kwame")
        self.assertFalse(ActivityEvent.objects.exists())


class PortfolioRecordTests(TestCase):
    def setUp(self):
        self.scout = make_staff("scout", "kwame@example.com")
        self.owner = make_owner(business_name="Akosua's Kitchen")

    def test_an_applied_change_belongs_to_exactly_one_approval(self):
        approval = make_approval(self.scout, self.owner)
        now = timezone.now()
        change = AppliedChange.objects.create(
            approval=approval, business_owner=self.owner, kind="business.update",
            summary="Changed the opening hours", applied_at=now, undo_until=now + timedelta(days=7),
        )
        self.assertEqual(approval.applied_change, change)
        self.assertEqual((change.result, change.undone_at, change.undo_failed, change.fraud_flag_id), ({}, None, "", None))
        with self.assertRaises(IntegrityError), transaction.atomic():
            AppliedChange.objects.create(
                approval=approval, business_owner=self.owner, kind="business.update",
                summary="Again", applied_at=now, undo_until=now,
            )

    def test_applied_changes_list_newest_first(self):
        now = timezone.now()
        older = AppliedChange.objects.create(
            approval=make_approval(self.scout, self.owner, "Add photos"), business_owner=self.owner,
            kind="listing.photos", summary="Added 4 photos", applied_at=now - timedelta(hours=2),
            undo_until=now + timedelta(days=7), result={"photo_ids": [1, 2, 3, 4], "set_main_photo": False},
        )
        newer = AppliedChange.objects.create(
            approval=make_approval(self.scout, self.owner), business_owner=self.owner,
            kind="business.update", summary="Changed the opening hours", applied_at=now,
            undo_until=now + timedelta(days=7),
        )
        self.assertEqual(list(self.owner.applied_changes.all()), [newer, older])

    def test_one_health_snapshot_per_business_per_day(self):
        today = timezone.localdate()
        snapshot = BusinessHealthSnapshot.objects.create(business_owner=self.owner, date=today, rating="healthy")
        self.assertEqual(snapshot.reasons, [])
        with self.assertRaises(IntegrityError), transaction.atomic():
            BusinessHealthSnapshot.objects.create(
                business_owner=self.owner, date=today, rating="at_risk", reasons=["No listing live"],
            )
        BusinessHealthSnapshot.objects.create(
            business_owner=self.owner, date=today - timedelta(days=1), rating="at_risk", reasons=["No listing live"],
        )
        self.assertEqual(self.owner.health_snapshots.count(), 2)

    def test_a_staged_photo_starts_unused_with_where_it_was_taken(self):
        photo = StagedPhoto.objects.create(
            business_owner=self.owner, uploaded_by=self.scout, image="staged_photos/front.jpg",
            taken_lat=Decimal("6.688500"), taken_lng=Decimal("-1.624400"), taken_accuracy_m=8,
        )
        photo.refresh_from_db()
        self.assertIsNone(photo.used_at)
        self.assertIsNotNone(photo.created_at)
        self.assertEqual((photo.taken_lat, photo.taken_lng, photo.taken_accuracy_m), (Decimal("6.688500"), Decimal("-1.624400"), 8))
        self.assertEqual(list(self.owner.staged_photos.all()), [photo])
