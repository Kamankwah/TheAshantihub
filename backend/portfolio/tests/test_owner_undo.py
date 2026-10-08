"""Owner undo — "This wasn't me" (Task 10, Review Focus 5)."""
from datetime import timedelta

from django.http import Http404
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile
from activity.models import ActivityEvent
from approvals import services
from fraud.models import FraudFlag
from listings.models import Listing, ListingPhoto
from notifications.models import Notification
from portfolio import proposals, undo
from portfolio.models import AppliedChange
from portfolio.tests.change_fixtures import ChangeTestBase, jpeg, make_business, make_listing, product_body

CHANGES_URL = "/api/portfolio/owner/changes/"


class UndoTestBase(ChangeTestBase):
    def setUp(self):
        super().setUp()
        self.other_owner = make_business(self.other_scout, phone="+233244900900", name="Kofi Spare Parts",
                                         gps="AK-100-2000")

    def applied_update(self, fields):
        approval = proposals.propose_update(self.scout, self.owner, fields, reason="Owner asked")
        services.approve(approval.pk, self.lead)
        return AppliedChange.objects.get(approval=approval)

    def undo_url(self, change):
        return f"{CHANGES_URL}{change.pk}/undo/"

    def profile(self):
        return BusinessOwnerProfile.objects.get(business_owner=self.owner)


class OwnerUndoTests(UndoTestBase):
    def test_a_full_revert(self):
        change = self.applied_update({"business_name": "Abena Kente Palace", "opening_hours": "Mon–Sun 7am–8pm"})
        self.as_owner(self.owner)
        response = self.client.post(self.undo_url(change))
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["id"], change.pk)
        self.assertIsNotNone(body["undone_at"])
        self.assertEqual((body["undo_failed"], body["can_undo"]), ("", False))
        profile = self.profile()
        self.assertEqual((profile.business_name, profile.opening_hours), ("Abena Kente House", "Mon–Sat 8am–6pm"))
        flag = FraudFlag.objects.get(dedupe_key=f"undo:{change.pk}")
        self.assertEqual((flag.kind, flag.status, flag.source), (FraudFlag.OWNER_OBJECTED, FraudFlag.OPEN, FraudFlag.OWNER))
        self.assertEqual((flag.business_owner, flag.staff_subject), (self.owner, self.scout))
        change.refresh_from_db()
        self.assertEqual(change.fraud_flag_id, flag.pk)

    def test_a_partial_revert_leaves_the_case_open(self):
        change = self.applied_update({"business_name": "Abena Kente Palace", "opening_hours": "Mon–Sun 7am–8pm"})
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(opening_hours="Daily 6am–10pm")
        self.as_owner(self.owner)
        body = self.client.post(self.undo_url(change)).json()
        self.assertEqual(body["undo_failed"], "Some details changed again since — Operations will sort them out.")
        profile = self.profile()
        self.assertEqual((profile.business_name, profile.opening_hours), ("Abena Kente House", "Daily 6am–10pm"))
        flag = FraudFlag.objects.get(dedupe_key=f"undo:{change.pk}")
        self.assertEqual(flag.status, FraudFlag.OPEN)
        self.assertIn("Not reverted: Opening hours", flag.evidence)

    def test_a_number_taken_since_is_not_restored(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=None)  # a scout can only set sign-in details before a login
        change = self.applied_update({"login_phone": "024 555 0101"})
        BusinessOwner.objects.create(full_name="Yaa Asantewaa", login_phone="0244100200", password_hash="x")
        self.as_owner(self.owner)
        self.assertEqual(self.client.post(self.undo_url(change)).json()["undo_failed"], undo.PARTLY_REVERTED)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, "+233245550101")

    def test_after_seven_days_the_owner_is_pointed_to_support(self):
        change = self.applied_update({"business_name": "Abena Kente Palace"})
        AppliedChange.objects.filter(pk=change.pk).update(undo_until=timezone.now() - timedelta(minutes=1))
        self.as_owner(self.owner)
        response = self.client.post(self.undo_url(change))
        self.assertEqual(
            (response.status_code, response.json()["detail"]),
            (400, "The 7 days to undo this have passed — contact AshantiHub Support."),
        )
        self.assertEqual(self.profile().business_name, "Abena Kente Palace")
        self.assertFalse(FraudFlag.objects.exists())
        self.assertFalse(self.client.get(CHANGES_URL).json()[0]["can_undo"])

    def test_a_second_undo_is_refused(self):
        change = self.applied_update({"business_name": "Abena Kente Palace"})
        self.as_owner(self.owner)
        self.assertEqual(self.client.post(self.undo_url(change)).status_code, 200)
        response = self.client.post(self.undo_url(change))
        self.assertEqual((response.status_code, response.json()["detail"]), (400, "You've already undone this."))
        self.assertEqual(FraudFlag.objects.count(), 1)

    def test_another_owners_change_is_not_found(self):
        change = self.applied_update({"business_name": "Abena Kente Palace"})
        self.as_owner(self.other_owner)
        self.assertEqual(self.client.post(self.undo_url(change)).status_code, 404)
        self.assertEqual(self.client.get(CHANGES_URL).json(), [])
        with self.assertRaises(Http404):
            undo.undo_change(change.pk, self.other_owner)
        self.assertIsNone(AppliedChange.objects.get(pk=change.pk).undone_at)
        self.assertFalse(FraudFlag.objects.exists())

    def test_undoing_a_new_listing_takes_it_down(self):
        approval = proposals.propose_listing(self.scout, self.owner, product_body(), main_photo_id=self.staged().pk,
                                             photo_ids=[], reason="Owner showed me the stock")
        services.approve(approval.pk, self.lead)
        change = AppliedChange.objects.get(approval=approval)
        self.as_owner(self.owner)
        self.assertEqual(self.client.post(self.undo_url(change)).status_code, 200)
        listing = Listing.objects.get(pk=change.result["listing_id"])
        self.assertEqual(
            (listing.status, listing.rejection_reason),
            (Listing.REJECTED, "Removed by the owner within 7 days (“This wasn't me”)."),
        )
        self.client.credentials()
        self.assertNotIn(listing.pk, [row["id"] for row in self.client.get("/api/listings/").json()["results"]])

    def test_undoing_photos_deletes_only_this_changes_photos(self):
        listing = make_listing(self.owner)
        own = ListingPhoto.objects.create(listing=listing, image=jpeg("own.jpg"), order=1)
        approval = proposals.propose_photos(self.scout, listing, photo_ids=[self.staged().pk, self.staged().pk],
                                            reason="Better light")
        services.approve(approval.pk, self.lead)
        change = AppliedChange.objects.get(approval=approval)
        self.assertEqual(listing.photos.count(), 3)
        self.as_owner(self.owner)
        self.assertEqual(self.client.post(self.undo_url(change)).status_code, 200)
        self.assertEqual(list(listing.photos.values_list("pk", flat=True)), [own.pk])
        listing.refresh_from_db()
        self.assertFalse(listing.main_photo)  # the main photo this change set is cleared

    def test_the_maker_and_their_manager_are_told(self):
        change = self.applied_update({"business_name": "Abena Kente Palace"})
        self.as_owner(self.owner)
        self.client.post(self.undo_url(change))
        to_scout = Notification.objects.get(staff=self.scout, kind="account_manager_change_undone")
        to_lead = Notification.objects.get(staff=self.lead, kind="account_manager_change_undone")
        self.assertEqual((to_scout.title, to_scout.link), ("Abena Kente House undid your change", f"portfolio/{self.owner.pk}"))
        self.assertEqual((to_lead.title, to_lead.link), ("Abena Kente House undid Kwame's change", "fraud-cases"))

    def test_the_undo_is_recorded_with_the_owner_as_actor(self):
        change = self.applied_update({"business_name": "Abena Kente Palace"})
        self.as_owner(self.owner)
        self.client.post(self.undo_url(change))
        event = ActivityEvent.objects.order_by("-id").first()
        self.assertEqual(
            (event.verb, event.actor_type, event.actor_id),
            ("business.change_undone", ActivityEvent.BUSINESS_OWNER, self.owner.pk),
        )
        self.assertEqual((event.target_type, event.target_id), ("accounts.businessowner", str(self.owner.pk)))
        self.assertEqual((event.after["change_id"], event.after["reverted"]), (change.pk, "fully"))
        self.assertTrue(ActivityEvent.objects.filter(verb="fraud.flag_raised").exists())


class OwnerChangesListTests(UndoTestBase):
    def test_the_owner_sees_the_last_30_days_newest_first(self):
        older = self.applied_update({"business_name": "Abena Kente Palace"})
        newer = self.applied_update({"opening_hours": "Mon–Sun 7am–8pm"})
        ancient = self.applied_update({"business_description": "Kente, adinkra and batik."})
        AppliedChange.objects.filter(pk=ancient.pk).update(applied_at=timezone.now() - timedelta(days=31))
        AppliedChange.objects.filter(pk=older.pk).update(applied_at=timezone.now() - timedelta(days=2))
        self.as_owner(self.owner)
        rows = self.client.get(CHANGES_URL).json()
        self.assertEqual([row["id"] for row in rows], [newer.pk, older.pk])
        self.assertEqual(set(rows[0]), {
            "id", "kind", "summary", "made_by_name", "applied_at", "undo_until", "can_undo", "undone_at", "undo_failed",
        })
        self.assertEqual(
            (rows[0]["kind"], rows[0]["summary"], rows[0]["made_by_name"], rows[0]["can_undo"], rows[0]["undo_failed"]),
            ("business.update", "Changed opening hours", "Kwame", True, ""),
        )

    def test_only_business_owners_use_these_endpoints(self):
        change = self.applied_update({"business_name": "Abena Kente Palace"})
        self.as_staff(self.scout)
        self.assertEqual(self.client.get(CHANGES_URL).status_code, 403)
        self.assertEqual(self.client.post(self.undo_url(change)).status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get(CHANGES_URL).status_code, 401)
