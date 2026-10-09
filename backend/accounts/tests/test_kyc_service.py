import threading
from decimal import Decimal

from django.core.cache import cache
from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import kyc
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest
from fraud import services as fraud
from fraud.models import FraudFlag
from listings.models import Category, Zone
from notifications.models import Notification


def make_business(*, name="Adwoa Fabrics", owner_name="Adwoa Mensah", phone="+233244123118", scout=None,
                  address_decided_by=None, **profile_fields):
    """An owner plus profile as the KYC queue sees it. With `scout`, the
    business was registered by that staff member, who also manages it."""
    owner = BusinessOwner.objects.create(
        full_name=owner_name, login_phone=phone, password_hash="x",
        registration_channel=BusinessOwner.SCOUT if scout else BusinessOwner.SELF,
        registered_by=scout, account_manager=scout,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name=name, gps_address="AK-039-5028", business_contact_phone=phone,
        address_verified=address_decided_by is not None, address_verified_by=address_decided_by,
        address_verified_at=timezone.now() if address_decided_by is not None else None,
        **profile_fields,
    )
    return owner


def submit_kyc(maker, owner):
    return approvals.submit(
        maker, "business.kyc", target=owner, title=f"New business: {owner.display_name}",
        payload={"business_owner_id": owner.pk},
    )


class QueueBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = make_business(scout=self.scout, address_decided_by=self.lead)
        self.approval = submit_kyc(self.scout, self.owner)

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def approve_in_queue(self, owner=None):
        return self.client.post(f"/api/accounts/kyc/{(owner or self.owner).id}/approve/", {}, format="json")

    def reject_in_queue(self, reason, owner=None):
        return self.client.post(
            f"/api/accounts/kyc/{(owner or self.owner).id}/reject/", {"reason": reason}, format="json",
        )


class KycQueueSettlesApprovalTests(QueueBase):
    """Review Focus 2: the KYC queue and the business.kyc request are one decision."""

    def test_approving_in_the_queue_settles_the_pending_request(self):
        self.as_(self.other_ops)
        response = self.approve_in_queue()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"id": self.owner.id, "kyc_status": "verified"})
        self.owner.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual((self.owner.kyc_status, self.owner.reviewed_by), ("verified", self.other_ops))
        self.assertIsNotNone(self.owner.reviewed_at)
        self.assertEqual(
            (self.approval.status, self.approval.decided_by, self.approval.decision_note),
            ("approved", self.other_ops, "Approved in the KYC queue."),
        )
        self.assertTrue(Notification.objects.filter(
            staff=self.scout, kind="approval_decided", title=f"Approved: {self.approval.title}",
        ).exists())
        self.assertEqual(Notification.objects.filter(business_owner=self.owner, kind="kyc_approved").count(), 1)
        event = ActivityEvent.objects.get(verb="kyc-approve")  # exactly one: the middleware adds nothing
        self.assertEqual(
            (event.actor_id, event.target_type, event.target_id),
            (self.other_ops.id, "accounts.businessowner", str(self.owner.id)),
        )
        self.assertEqual(event.after, {"via": "kyc-queue", "approval_ids": [self.approval.id]})
        self.assertFalse(ActivityEvent.objects.filter(verb="approval.approved").exists())

    def test_rejecting_in_the_queue_returns_the_request_with_the_reason(self):
        self.as_(self.other_ops)
        response = self.reject_in_queue("The signboard photo is of another shop")
        self.assertEqual(response.status_code, 200, response.content)
        self.owner.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual(
            (self.owner.kyc_status, self.owner.kyc_rejection_reason, self.owner.reviewed_by),
            ("rejected", "The signboard photo is of another shop", self.other_ops),
        )
        self.assertEqual(
            (self.approval.status, self.approval.decision_note), ("rejected", "The signboard photo is of another shop"),
        )
        self.assertTrue(Notification.objects.filter(
            staff=self.scout, kind="approval_decided", title=f"Returned: {self.approval.title}",
            body="The signboard photo is of another shop",
        ).exists())
        note = Notification.objects.get(business_owner=self.owner, kind="kyc_rejected")
        self.assertEqual(note.body, "The signboard photo is of another shop")
        event = ActivityEvent.objects.get(verb="kyc-reject")
        self.assertEqual(event.after, {
            "via": "kyc-queue", "reason": "The signboard photo is of another shop", "approval_ids": [self.approval.id],
        })

    def test_the_maker_cannot_decide_their_own_registration_in_the_queue(self):
        own = make_business(
            name="Kojo Spares", owner_name="Yaw Boakye", phone="+233201234567",
            scout=self.other_ops, address_decided_by=self.lead,
        )
        approval = submit_kyc(self.other_ops, own)  # an Operations lead registered it; it waits for the pool
        self.assertEqual(approval.stage, "pool")
        self.as_(self.other_ops)
        for response in (self.approve_in_queue(own), self.reject_in_queue("Wrong card", own)):
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json(), {"detail": "You can't approve your own request."})
        own.refresh_from_db()
        approval.refresh_from_db()
        self.assertEqual((own.kyc_status, approval.status), ("pending", "pending"))
        self.assertFalse(ActivityEvent.objects.filter(verb__startswith="kyc-").exists())
        self.as_(self.lead)
        self.assertEqual(self.approve_in_queue(own).status_code, 200)


class KycQueueRulesTests(QueueBase):
    def test_approving_twice_is_refused_and_the_owner_hears_once(self):
        self.as_(self.lead)
        self.assertEqual(self.approve_in_queue().status_code, 200)
        again = self.approve_in_queue()
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.json(), {"detail": "This business has already been decided."})
        self.assertEqual(Notification.objects.filter(business_owner=self.owner, kind="kyc_approved").count(), 1)
        self.assertEqual(ActivityEvent.objects.filter(verb="kyc-approve").count(), 1)

    def test_rejecting_a_decided_business_is_refused(self):
        self.as_(self.lead)
        self.approve_in_queue()
        response = self.reject_in_queue("Too late")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "This business has already been decided."})
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, "verified")

    def test_rejecting_needs_a_reason(self):
        self.as_(self.lead)
        response = self.reject_in_queue("   ")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Write the reason the owner will see."})
        self.owner.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual((self.owner.kyc_status, self.approval.status), ("pending", "pending"))

    def test_an_open_self_dealing_case_holds_the_queue_approve(self):
        flag = fraud.raise_flag(
            FraudFlag.SELF_DEALING, title="Adwoa Fabrics · owner phone matches a staff member",
            business_owner=self.owner, staff_subject=self.scout,
        )
        self.as_(self.lead)
        response = self.approve_in_queue()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Decide the self-dealing case in Fraud cases first."})
        self.owner.refresh_from_db()
        self.approval.refresh_from_db()
        # the request it would have settled is untouched: the whole decision rolled back
        self.assertEqual((self.owner.kyc_status, self.approval.status), ("pending", "pending"))
        self.assertFalse(Notification.objects.filter(staff=self.scout, kind="approval_decided").exists())
        fraud.dismiss(flag.pk, self.boss, note="The owner is Kwame's sister and has her own phone")
        self.assertEqual(self.approve_in_queue().status_code, 200)

    def test_rejecting_is_allowed_while_a_self_dealing_case_is_open(self):
        fraud.raise_flag(
            FraudFlag.SELF_DEALING, title="Adwoa Fabrics · owner phone matches a staff member",
            business_owner=self.owner, staff_subject=self.scout,
        )
        self.as_(self.lead)
        self.assertEqual(self.reject_in_queue("The owner is a member of staff").status_code, 200)

    def test_an_owner_who_registered_online_has_no_request_to_settle(self):
        online = make_business(name="Yaa Provisions", owner_name="Yaa Asantewaa", phone="+233207778899")
        self.as_(self.lead)
        self.assertEqual(self.approve_in_queue(online).status_code, 200)
        event = ActivityEvent.objects.get(verb="kyc-approve", target_id=str(online.id))
        self.assertEqual(event.after, {"via": "kyc-queue", "approval_ids": []})

    def test_an_unknown_business_is_404(self):
        self.as_(self.lead)
        response = self.client.post("/api/accounts/kyc/999999/approve/", {}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "We couldn't find that business."})


class KycQueueFieldsTests(QueueBase):
    def setUp(self):
        super().setUp()
        category = Category.objects.create(slug="kyc-test-fabrics", icon="🧵", label="Fabrics", color="#7c3aed", kind="product")
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(
            business_category=category, zone=Zone.objects.get(name="Bantama"),
            lat=Decimal("6.688000"), lng=Decimal("-1.624000"), location_accuracy_m=12,
            location_set_by="scout", location_set_at=timezone.now(),
        )
        self.online = BusinessOwner.objects.create(full_name="Yaa Trader", login_phone="+233207778899", password_hash="x")

    def test_a_queue_row_says_who_registered_it_and_what_is_open(self):
        flag = fraud.raise_flag(FraudFlag.SIMILAR_NEARBY, title="Similar name 38 m away", business_owner=self.owner)
        self.as_(self.lead)
        rows = {row["id"]: row for row in self.client.get("/api/accounts/kyc/pending/").json()}
        scouted, online = rows[self.owner.id], rows[self.online.id]
        self.assertEqual(
            (scouted["registration_channel"], scouted["registered_by_name"], scouted["pending_approval_id"]),
            ("scout", "Kwame", self.approval.id),
        )
        self.assertEqual((scouted["registered_by_role"], online["registered_by_role"]), ("Scout", None))
        self.assertEqual(scouted["open_fraud_flags"], [
            {"id": flag.id, "kind": "similar_nearby", "kind_label": "Similar business nearby", "title": "Similar name 38 m away"},
        ])
        self.assertEqual(
            (online["registration_channel"], online["registered_by_name"], online["open_fraud_flags"], online["pending_approval_id"]),
            ("self", None, [], None),
        )

    def test_a_decided_request_is_no_longer_pending_on_the_row(self):
        approvals.approve(self.approval.pk, self.lead)
        self.as_(self.lead)
        [row] = [r for r in self.client.get("/api/accounts/kyc/pending/?status=approved").json() if r["id"] == self.owner.id]
        self.assertIsNone(row["pending_approval_id"])

    def test_the_detail_carries_the_business_and_its_pin(self):
        self.as_(self.lead)
        body = self.client.get(f"/api/accounts/kyc/{self.owner.id}/").json()
        keys = (
            "business_name", "business_category_name", "zone_name", "lat", "lng", "location_accuracy_m",
            "location_is_manual", "signboard_photo", "registration_channel", "registered_by_name", "registered_by_role", "pending_approval_id",
            "open_fraud_flags",
        )
        self.assertEqual({key: body[key] for key in keys}, {
            "business_name": "Adwoa Fabrics", "business_category_name": "Fabrics", "zone_name": "Bantama",
            "lat": "6.688000", "lng": "-1.624000", "location_accuracy_m": 12, "location_is_manual": False,
            "signboard_photo": None, "registration_channel": "scout", "registered_by_name": "Kwame",
            "pending_approval_id": self.approval.id, "open_fraud_flags": [], "registered_by_role": "Scout",
        })
        self.assertEqual(body["profile"]["gps_address"], "AK-039-5028")

    def test_an_owner_without_a_profile_still_opens(self):
        self.as_(self.lead)
        response = self.client.get(f"/api/accounts/kyc/{self.online.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(
            (body["profile"], body["business_name"], body["zone_name"], body["lat"], body["signboard_photo"]),
            (None, None, None, None, None),
        )


class KycDoubleDecisionTests(TransactionTestCase):
    """Review Focus 2: KYC decided in two places at once — exactly one wins and
    the owner hears once."""

    serialized_rollback = True

    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = make_business(scout=self.scout, address_decided_by=self.lead)
        self.approval = submit_kyc(self.scout, self.owner)

    def race(self, *deciders):
        results = []
        barrier = threading.Barrier(len(deciders))

        def run(decide):
            try:
                barrier.wait()
                decide()
                results.append(("decided", None))
            except (kyc.KycError, approvals.ApprovalError) as exc:
                results.append(("refused", exc.status_code))
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(decide,)) for decide in deciders]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(sorted(outcome for outcome, _ in results), ["decided", "refused"])
        self.assertIn([code for outcome, code in results if outcome == "refused"][0], (400, 409))
        return results

    def test_the_queue_and_the_inbox_approving_at_once_decide_it_once(self):
        self.race(
            lambda: kyc.approve_owner(self.owner.pk, self.other_ops),
            lambda: approvals.approve(self.approval.pk, self.lead),
        )
        self.owner.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual((self.owner.kyc_status, self.approval.status), ("verified", "approved"))
        self.assertEqual(Notification.objects.filter(business_owner=self.owner, kind="kyc_approved").count(), 1)
        self.assertEqual(ActivityEvent.objects.filter(verb="kyc-approve", target_id=str(self.owner.pk)).count(), 1)
        self.assertEqual(Notification.objects.filter(staff=self.scout, kind="approval_decided").count(), 1)

    def test_two_queue_approvals_at_once_decide_it_once(self):
        online = make_business(name="Yaa Provisions", owner_name="Yaa Asantewaa", phone="+233207778899")
        self.race(
            lambda: kyc.approve_owner(online.pk, self.lead),
            lambda: kyc.approve_owner(online.pk, self.other_ops),
        )
        self.assertEqual(Notification.objects.filter(business_owner=online, kind="kyc_approved").count(), 1)
        self.assertEqual(ActivityEvent.objects.filter(verb="kyc-approve", target_id=str(online.pk)).count(), 1)

    def test_a_queue_reject_and_an_inbox_approve_at_once_agree(self):
        self.race(
            lambda: kyc.reject_owner(self.owner.pk, self.other_ops, "The Ghana Card photo is unreadable"),
            lambda: approvals.approve(self.approval.pk, self.lead),
        )
        self.owner.refresh_from_db()
        self.approval.refresh_from_db()
        expected = {"verified": "approved", "rejected": "rejected"}
        self.assertEqual(self.approval.status, expected[self.owner.kyc_status])
        self.assertEqual(
            Notification.objects.filter(business_owner=self.owner, kind__in=["kyc_approved", "kyc_rejected"]).count(), 1,
        )


class KycMakerAndAddressTests(QueueBase):
    """Fix round 1: the registrar never decides their own registration, and a
    scout-registered business needs the address decision on both doors."""

    def setUp(self):
        super().setUp()
        self.own = make_business(
            name="Kojo Spares", owner_name="Yaw Boakye", phone="+233201234567",
            scout=self.other_ops, address_decided_by=self.lead,
        )

    def assert_own_refused(self, response):
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "You can't approve your own request."})
        self.own.refresh_from_db()
        self.assertEqual(self.own.kyc_status, "pending")
        self.assertFalse(ActivityEvent.objects.filter(verb__startswith="kyc-").exists())

    def test_a_registrar_who_cancelled_their_request_cannot_approve_in_the_queue(self):
        approval = submit_kyc(self.other_ops, self.own)
        approvals.cancel(approval.pk, self.other_ops)
        self.as_(self.other_ops)
        self.assert_own_refused(self.approve_in_queue(self.own))

    def test_a_registrar_whose_request_was_returned_cannot_approve_in_the_queue(self):
        approval = submit_kyc(self.other_ops, self.own)
        approvals.reject(approval.pk, self.lead, note="Retake the photo")
        self.as_(self.other_ops)
        self.assert_own_refused(self.approve_in_queue(self.own))

    def test_a_super_admin_registrar_cannot_approve_their_own_registration(self):
        own = make_business(name="Boss Stores", owner_name="Efua", phone="+233205550000", scout=self.boss)
        self.as_(self.boss)
        response = self.approve_in_queue(own)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "You can't approve your own request."})
        own.refresh_from_db()
        self.assertEqual(own.kyc_status, "pending")

    def test_the_registrar_cannot_reject_either(self):
        self.as_(self.other_ops)
        self.assert_own_refused(self.reject_in_queue("Not good", self.own))

    def test_a_refusal_rolls_back_requests_the_queue_door_had_closed(self):
        approval = submit_kyc(self.scout, self.own)  # someone else's request on the registrar's business
        self.as_(self.other_ops)
        self.assert_own_refused(self.approve_in_queue(self.own))
        approval.refresh_from_db()
        self.assertEqual(approval.status, "pending")

    def test_the_inbox_door_refuses_the_registrar_with_a_403_too(self):
        approval = submit_kyc(self.scout, self.own)
        BusinessOwner.objects.filter(pk=self.own.pk).update(registered_by=self.lead)
        with self.assertRaises(approvals.MakerCannotDecide) as raised:
            approvals.approve(approval.pk, self.lead)
        self.assertEqual((raised.exception.status_code, raised.exception.message), (403, "You can't approve your own request."))
        approval.refresh_from_db()
        self.assertEqual(approval.status, "pending")

    def test_the_registrar_cannot_decide_the_address_either(self):
        BusinessOwnerProfile.objects.filter(business_owner=self.own).update(
            address_verified=False, address_verified_by=None, address_verified_at=None,
        )
        self.as_(self.other_ops)
        response = self.client.post(f"/api/accounts/kyc/{self.own.id}/address-verify/", {"verified": True}, format="json")
        self.assertEqual((response.status_code, response.json()), (403, {"detail": "You can't approve your own request."}))
        profile = BusinessOwnerProfile.objects.get(business_owner=self.own)
        self.assertEqual((profile.address_verified, profile.address_verified_at), (False, None))
        self.as_(self.lead)
        response = self.client.post(f"/api/accounts/kyc/{self.own.id}/address-verify/", {"verified": True}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def grant_kyc_approve(self, staff):
        from accounts.models import Permission

        staff.extra_permissions.add(Permission.objects.get(codename="kyc.approve"))
        self.assertIn("kyc.approve", staff.effective_permission_codenames())

    def test_a_resubmitter_who_did_not_register_it_cannot_decide_it_either(self):
        # The account manager (not the registrar) sent the evidence: the request was returned.
        resubmitter = make_staff("scout", "yaw@example.com", manager=self.lead)
        self.grant_kyc_approve(resubmitter)
        BusinessOwnerProfile.objects.filter(business_owner=self.own).update(
            address_verified=False, address_verified_by=None, address_verified_at=None,
        )
        approval = submit_kyc(resubmitter, self.own)
        approvals.reject(approval.pk, self.lead, note="Retake the photo")
        self.as_(resubmitter)
        self.assert_own_refused(self.approve_in_queue(self.own))
        self.assert_own_refused(self.reject_in_queue("No good", self.own))
        response = self.client.post(f"/api/accounts/kyc/{self.own.id}/address-verify/", {"verified": True}, format="json")
        self.assertEqual((response.status_code, response.json()), (403, {"detail": "You can't approve your own request."}))
        profile = BusinessOwnerProfile.objects.get(business_owner=self.own)
        self.assertEqual(profile.address_verified_at, None)

    def test_a_cancelled_request_still_marks_its_maker_as_the_submitter(self):
        resubmitter = make_staff("scout", "yaw@example.com", manager=self.lead)
        self.grant_kyc_approve(resubmitter)
        approval = submit_kyc(resubmitter, self.own)
        approvals.cancel(approval.pk, resubmitter)
        self.as_(resubmitter)
        self.assert_own_refused(self.approve_in_queue(self.own))
        self.as_(self.lead)
        self.assertEqual(self.approve_in_queue(self.own).status_code, 200)

    def test_a_reassigned_account_manager_cannot_decide_it(self):
        manager = make_staff("scout", "efua@example.com", manager=self.lead)
        self.grant_kyc_approve(manager)
        BusinessOwner.objects.filter(pk=self.own.pk).update(account_manager=manager)
        BusinessOwnerProfile.objects.filter(business_owner=self.own).update(
            address_verified=False, address_verified_by=None, address_verified_at=None,
        )
        self.as_(manager)
        self.assert_own_refused(self.approve_in_queue(self.own))
        response = self.client.post(f"/api/accounts/kyc/{self.own.id}/address-verify/", {"verified": True}, format="json")
        self.assertEqual((response.status_code, response.json()), (403, {"detail": "You can't approve your own request."}))

    def test_the_maker_of_an_approved_business_update_cannot_decide_it(self):
        editor = make_staff("scout", "yaw@example.com", manager=self.lead)
        self.grant_kyc_approve(editor)
        update = approvals.submit(
            editor, "business.update", title="Change address", payload={"business_owner_id": self.own.pk},
            target_type="accounts.businessowner", target_id=str(self.own.pk),
        )
        ApprovalRequest.objects.filter(pk=update.pk).update(status="approved")
        self.as_(editor)
        self.assert_own_refused(self.approve_in_queue(self.own))

    def test_a_different_operations_staffer_can_still_approve(self):
        self.as_(self.lead)
        self.assertEqual(self.approve_in_queue(self.own).status_code, 200)

    def test_a_scout_business_without_the_address_decision_is_refused_in_the_queue(self):
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(
            address_verified=False, address_verified_by=None, address_verified_at=None,
        )
        self.as_(self.lead)
        response = self.approve_in_queue()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Record the Ghana Post address decision first."})
        self.owner.refresh_from_db()
        self.approval.refresh_from_db()
        self.assertEqual((self.owner.kyc_status, self.approval.status), ("pending", "pending"))
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(
            address_verified=True, address_verified_by=self.lead, address_verified_at=timezone.now(),
        )
        self.assertEqual(self.approve_in_queue().status_code, 200)

    def test_a_self_registered_owner_without_the_decision_is_still_approved(self):
        online = make_business(name="Yaa Provisions", owner_name="Yaa Asantewaa", phone="+233207778899")
        self.as_(self.lead)
        self.assertEqual(self.approve_in_queue(online).status_code, 200)
