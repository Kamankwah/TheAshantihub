"""Plan 7F-C ruling R3: a scout cannot change a business's name or sign-in contact."""
from approvals import services
from approvals.models import ApprovalRequest
from approvals.services import ApprovalError
from accounts.models import BusinessOwner, BusinessOwnerProfile
from portfolio import proposals, undo
from portfolio.models import AppliedChange
from portfolio.tests.change_fixtures import ChangeTestBase
from portfolio.tests.test_registration import RegistrationBase


class ScoutCannotEditIdentityTests(ChangeTestBase):
    def post(self, fields):
        self.as_staff(self.scout)
        return self.client.post(
            f"/api/portfolio/businesses/{self.owner.pk}/changes/", {"fields": fields, "reason": "Owner asked"},
            format="json",
        )

    def refused(self, field, value, *, claimed=True):
        if not claimed:
            BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=None)
        response = self.post({field: value})
        self.assertEqual((response.status_code, response.json()), (400, {field: [proposals.PROTECTED_MESSAGE]}))
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_one_constant_names_the_protected_fields(self):
        self.assertEqual(set(proposals.PROTECTED_OWNER_FIELDS), {"full_name", "login_phone", "email"})
        self.assertFalse(set(proposals.PROTECTED_OWNER_FIELDS) & set(proposals.EDITABLE_FIELDS))

    def test_scout_cannot_propose_full_name(self):
        self.refused("full_name", "Abena Mensah")

    def test_scout_cannot_propose_login_phone_even_unclaimed(self):
        self.refused("login_phone", "0245550101")
        self.refused("login_phone", "0245550101", claimed=False)

    def test_scout_cannot_propose_email(self):
        self.refused("email", "me@example.com")
        self.refused("email", "me@example.com", claimed=False)

    def test_the_refusal_leaks_no_contact_data(self):
        text = self.post({"login_phone": "0245550101"}).content.decode()
        self.assertNotIn("0245550101", text)
        self.assertNotIn(self.owner.login_phone, text)
        self.assertIn("dashboard", text)

    def test_scout_can_still_propose_gps_address_business_name_contact_phone_hours_pin(self):
        response = self.post({
            "gps_address": "AK-041-7788", "business_name": "Abena Kente Palace",
            "business_contact_phone": "0555123456", "opening_hours": "Mon-Sun 7am-8pm",
            "lat": "6.7100", "lng": "-1.6200", "location_accuracy_m": 9, "location_is_manual": False,
        })
        self.assertEqual(response.status_code, 201, response.content)
        fields = ApprovalRequest.objects.get(pk=response.json()["approval_id"]).payload["fields"]
        self.assertEqual(
            set(fields),
            {"gps_address", "business_name", "business_contact_phone", "opening_hours", "lat", "lng",
             "location_accuracy_m", "location_is_manual"},
        )

    def test_mixed_payload_with_one_protected_field_refused_whole(self):
        response = self.post({"business_name": "Abena Kente Palace", "email": "me@example.com"})
        self.assertEqual((response.status_code, response.json()), (400, {"email": [proposals.PROTECTED_MESSAGE]}))
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_pending_old_update_with_protected_field_cannot_apply(self):
        approval = proposals.propose_update(self.scout, self.owner, {"business_name": "Abena Kente Palace"},
                                            reason="Owner asked")
        payload = dict(approval.payload)
        payload["fields"] = {**payload["fields"], "login_phone": "+233245550101"}  # as an old proposal held it
        ApprovalRequest.objects.filter(pk=approval.pk).update(
            payload=payload, before={**(approval.before or {}), "login_phone": "+233244100200"},
        )
        self.as_staff(self.lead)
        response = self.client.post(f"/api/approvals/{approval.pk}/approve/", {}, format="json")
        self.assertEqual((response.status_code, response.json()["detail"]), (400, proposals.NEEDS_OWN_REQUEST))
        message = response.json()["detail"]  # the approval stays pending, so it must not claim to be cancelled
        self.assertIn("cannot be approved", message)
        self.assertIn("Reject it", message)
        self.assertNotIn("Cancelled", message)
        self.assertNotIn("233245550101", message)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, "+233244100200")
        self.assertEqual(BusinessOwnerProfile.objects.get(business_owner=self.owner).business_name, "Abena Kente House")
        self.assertFalse(AppliedChange.objects.exists())
        approval.refresh_from_db()
        with self.assertRaises(ApprovalError):
            proposals.apply_update(approval)

    def test_undo_skips_protected_fields_and_restores_the_rest(self):
        approval = proposals.propose_update(
            self.scout, self.owner, {"business_name": "Abena Kente Palace", "gps_address": "AK-041-7788"},
            reason="Owner asked",
        )
        services.approve(approval.pk, self.lead)
        # Make it look like a change applied before the rule: it also changed the owner's name and phone.
        approval.refresh_from_db()
        ApprovalRequest.objects.filter(pk=approval.pk).update(
            payload={**approval.payload, "fields": {**approval.payload["fields"], "full_name": "New Name",
                                                    "login_phone": "+233245550101"}},
            before={**(approval.before or {}), "full_name": "Abena Owusu", "login_phone": "+233244100200"},
        )
        BusinessOwner.objects.filter(pk=self.owner.pk).update(full_name="New Name", login_phone="+233245550101")
        change = AppliedChange.objects.get(approval=approval)
        self.as_owner(self.owner)
        response = self.client.post(f"/api/portfolio/owner/changes/{change.pk}/undo/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["undo_failed"], undo.PARTLY_REVERTED)
        self.owner.refresh_from_db()
        self.assertEqual((self.owner.full_name, self.owner.login_phone), ("New Name", "+233245550101"))
        profile = BusinessOwnerProfile.objects.get(business_owner=self.owner)
        self.assertEqual((profile.business_name, profile.gps_address), ("Abena Kente House", "AK-039-5028"))


class RegistrationKeepsInitialIdentityTests(RegistrationBase):
    def test_registration_still_sets_initial_name_and_phone(self):
        response = self.register()
        self.assertEqual(response.status_code, 201, response.content)
        owner = BusinessOwner.objects.get(pk=response.json()["id"])
        self.assertEqual((owner.full_name, owner.login_phone, owner.email),
                         ("Gifty Asantewaa", "+233241234567", "gifty@example.com"))
