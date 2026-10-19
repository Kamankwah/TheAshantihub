"""The business's own name/contact change request (plan 7F-C Task 6, ruling R3): filing, listing and withdrawing it."""
import json

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from notifications.models import Notification
from otp import step_up
from portfolio.models import BusinessDetailChangeRequest as Request
from portfolio.tests.change_fixtures import make_business
from wallets.tests.helpers import Holder

URL = "/api/accounts/business-owners/me/detail-changes/"
NEW_PHONE = "+233207654321"
NEW_PHONE_DIGITS = "207654321"


class DetailChangeRequestTests(TestCase):
    def setUp(self):
        cache.clear()
        self.scout = make_staff("scout", "kofi.scout@example.com", phone="0501112223")
        self.ops = make_staff("operations", "ops.lead@example.com", phone="0501112224")
        self.owner = make_business(self.scout, email="abena@example.com")
        self.holder = Holder(self.owner, "business_owner")

    def file(self, field="login_phone", value=NEW_PHONE, reason="I lost my old SIM card.", holder=None, **extra):
        return (holder or self.holder).post(URL, {"field": field, "new_value": value, "reason": reason, **extra})

    def withdraw(self, pk, holder=None):
        return (holder or self.holder).post(f"{URL}{pk}/withdraw/")

    # ── filing ──────────────────────────────────────────────────────────────

    def test_owner_files_request_201(self):
        response = self.file()
        self.assertEqual(response.status_code, 201, response.content)
        change = Request.objects.get(business_owner=self.owner)
        self.assertEqual(change.field, "login_phone")
        self.assertEqual(change.new_value, NEW_PHONE)  # kept unmasked: applying needs it
        self.assertEqual(change.status, Request.REQUESTED)
        self.assertEqual(change.reason, "I lost my old SIM card.")
        self.assertEqual(response.data["status"], "requested")
        self.assertEqual(response.data["new_value"], "020 *** 4321")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, "+233244100200")  # nothing changes until it is approved

    def test_name_and_email_are_normalised(self):
        self.assertEqual(self.file("full_name", "  Abena Serwaa Owusu ").status_code, 201)
        self.assertEqual(self.file("email", " New.Mail@Example.COM ").status_code, 201)
        values = dict(Request.objects.values_list("field", "new_value"))
        self.assertEqual(values, {"full_name": "Abena Serwaa Owusu", "email": "new.mail@example.com"})

    def test_owner_cannot_set_status_or_verify_itself(self):
        response = self.file(status="verified", verified_at=timezone.now().isoformat(), assigned_scout=self.scout.pk)
        self.assertEqual(response.status_code, 201)
        change = Request.objects.get()
        self.assertEqual(change.status, Request.REQUESTED)
        self.assertIsNone(change.verified_at)
        self.assertIsNone(change.assigned_scout_id)

    def test_unclaimed_owner_cannot_file_409(self):
        unclaimed = BusinessOwner.objects.create(
            full_name="Kwame Mensah", login_phone="+233244100300", password_hash="!", kyc_status=BusinessOwner.PENDING,
            registration_channel=BusinessOwner.SCOUT, registered_by=self.scout, account_manager=self.scout,
        )
        response = self.file(holder=Holder(unclaimed, "business_owner"))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "not_claimed")
        self.assertFalse(Request.objects.exists())

    def test_second_live_request_for_same_field_409(self):
        self.assertEqual(self.file().status_code, 201)
        response = self.file(value="0207654322")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "change_pending")
        for status in (Request.ASSIGNED, Request.VERIFIED):
            Request.objects.update(status=status)
            self.assertEqual(self.file(value="0207654322").data["code"], "change_pending")
        # another field is its own request
        self.assertEqual(self.file("email", "other@example.com").status_code, 201)
        # an ended request no longer blocks a new one
        Request.objects.filter(field="login_phone").update(status=Request.NOT_VERIFIED)
        self.assertEqual(self.file(value="0207654322").status_code, 201)

    def test_unchanged_value_400(self):
        for field, value in (("login_phone", "024 410 0200"), ("email", "ABENA@example.com"), ("full_name", " Abena Owusu ")):
            response = self.file(field, value)
            self.assertEqual(response.status_code, 400, field)
            self.assertEqual(response.data["code"], "no_change", field)
        self.assertFalse(Request.objects.exists())

    def test_invalid_values_400(self):
        for field, value in (("login_phone", "12345"), ("email", "not-an-email"), ("full_name", ""), ("full_name", "x" * 151),
                             ("payout_momo_number", "0241234567")):
            response = self.file(field, value)
            self.assertEqual(response.status_code, 400, (field, value))
        self.assertEqual(self.file("full_name", "").data["code"], "invalid")
        self.assertEqual(self.file("payout_momo_number", "0241234567").data["code"], "invalid_field")
        self.assertEqual(self.file(reason="  ").data["code"], "reason_required")
        self.assertFalse(Request.objects.exists())

    def test_value_belonging_to_another_business_refused(self):
        make_business(self.scout, phone="+233209998887", name="Other Shop", gps="AK-039-5029", email="other@example.com")
        for field, value in (("login_phone", "020 999 8887"), ("email", "OTHER@example.com")):
            response = self.file(field, value)
            self.assertEqual(response.status_code, 400, field)
            self.assertEqual(response.data["code"], "taken", field)
        self.assertFalse(Request.objects.exists())

    def test_staff_phone_or_email_refused(self):
        for field, value in (("login_phone", "0501112224"), ("email", "ops.lead@example.com")):
            response = self.file(field, value)
            self.assertEqual(response.status_code, 400, field)
            self.assertEqual(response.data["code"], "taken")
            self.assertIn("staff", response.data["detail"])

    def test_customer_recovery_contact_refused(self):
        Customer.objects.create(
            full_name="Yaw Boateng", email="yaw@example.com", phone="+233271234567", password_hash="x",
            secondary_phone="0207654321", secondary_phone_verified=True,
            secondary_email="spare@example.com", secondary_email_verified=True,
        )
        for field, value in (("login_phone", NEW_PHONE), ("email", "spare@example.com")):
            response = self.file(field, value)
            self.assertEqual(response.status_code, 400, field)
            self.assertEqual(response.data["code"], "taken")
        # an unverified recovery contact is only typed text: it blocks nothing
        Customer.objects.update(secondary_phone_verified=False)
        self.assertEqual(self.file().status_code, 201)

    def test_masked_value_refused(self):
        for field, value in (("login_phone", "020 *** 4321"), ("email", "ne•••@example.com"), ("full_name", "Ab*na")):
            response = self.file(field, value)
            self.assertEqual(response.status_code, 400, field)
            self.assertEqual(response.data["code"], "invalid")

    def test_step_up_required_when_ledger_on(self):
        with override_settings(LEDGER_ENABLED=True):
            response = self.holder.client.post(
                URL, {"field": "login_phone", "new_value": NEW_PHONE, "reason": "New SIM."}, format="json",
            )
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.data["code"], "step_up_required")
            self.assertEqual(response.data["action"], step_up.DETAIL_CHANGE)
            self.assertFalse(Request.objects.exists())
            # a token for another action does not do
            wrong = self.holder.post(
                URL, {"field": "login_phone", "new_value": NEW_PHONE, "reason": "New SIM."}, action=step_up.CONTACT_CHANGE,
            )
            self.assertEqual(wrong.status_code, 403)
            ok = self.holder.post(
                URL, {"field": "login_phone", "new_value": NEW_PHONE, "reason": "New SIM."}, action=step_up.DETAIL_CHANGE,
            )
            self.assertEqual(ok.status_code, 201, ok.content)
        # with the ledger (and the OTP switches) off no code is asked
        self.assertEqual(self.file("email", "fresh@example.com").status_code, 201)

    def test_refused_value_keeps_the_step_up_token(self):
        with override_settings(LEDGER_ENABLED=True):
            token = self.holder.step_up(step_up.DETAIL_CHANGE)
            refused = self.holder.post(URL, {"field": "login_phone", "new_value": "12", "reason": "x"}, token=token)
            self.assertEqual(refused.status_code, 400)
            ok = self.holder.post(URL, {"field": "login_phone", "new_value": NEW_PHONE, "reason": "x"}, token=token)
            self.assertEqual(ok.status_code, 201)

    def test_step_up_code_is_offered_to_owners_only_while_ledger_on(self):
        from otp.views_step_up import _codes_off

        customer = Customer.objects.create(full_name="Yaw", email="yaw2@example.com", phone="+233271234568", password_hash="x")
        self.assertTrue(_codes_off(self.owner, step_up.DETAIL_CHANGE))
        with override_settings(LEDGER_ENABLED=True):
            self.assertFalse(_codes_off(self.owner, step_up.DETAIL_CHANGE))
            self.assertTrue(_codes_off(customer, step_up.DETAIL_CHANGE))
            self.assertTrue(_codes_off(self.ops, step_up.DETAIL_CHANGE))

    # ── listing ─────────────────────────────────────────────────────────────

    def test_list_shows_masked_value_only(self):
        self.file()
        self.file("email", "new.mail@example.com")
        self.file("full_name", "Abena Serwaa Owusu")
        other = make_business(self.scout, phone="+233209998887", name="Other Shop", gps="AK-039-5029")
        Holder(other, "business_owner").post(URL, {"field": "full_name", "new_value": "Someone Else", "reason": "Typo."})

        response = self.holder.get(URL)
        self.assertEqual(response.status_code, 200)
        rows = {row["field"]: row for row in response.data["results"]}
        self.assertEqual(set(rows), {"login_phone", "email", "full_name"})  # never another business's
        self.assertEqual(rows["login_phone"]["new_value"], "020 *** 4321")
        self.assertEqual(rows["email"]["new_value"], "ne•••@example.com")
        self.assertEqual(rows["full_name"]["new_value"], "Abena Serwaa Owusu")
        body = response.content.decode()
        self.assertNotIn(NEW_PHONE_DIGITS, body)
        self.assertNotIn("new.mail@", body)
        self.assertIsNone(rows["login_phone"]["assigned_scout_first_name"])
        self.assertTrue(rows["login_phone"]["can_withdraw"])

        independent = make_staff("scout", "yaa.asantewaa@example.com", phone="0501112225")
        independent.full_name = "Yaa Asantewaa"
        independent.save(update_fields=["full_name"])
        Request.objects.filter(field="login_phone").update(
            status=Request.ASSIGNED, assigned_scout=independent, assigned_by=self.ops, assigned_at=timezone.now(),
        )
        row = next(r for r in self.holder.get(URL).data["results"] if r["field"] == "login_phone")
        self.assertEqual(row["assigned_scout_first_name"], "Yaa")
        self.assertNotIn("Asantewaa", json.dumps(row, default=str))

    # ── withdrawing ─────────────────────────────────────────────────────────

    def test_withdraw_before_verification(self):
        self.file()
        change = Request.objects.get()
        response = self.withdraw(change.pk)
        self.assertEqual(response.status_code, 200, response.content)
        change.refresh_from_db()
        self.assertEqual(change.status, Request.WITHDRAWN)
        self.assertIsNotNone(change.decided_at)
        self.assertEqual(self.withdraw(change.pk).data["code"], "not_withdrawable")
        # a withdrawn request frees the field for a new one
        self.assertEqual(self.file().status_code, 201)

        assigned = Request.objects.get(status=Request.REQUESTED)
        Request.objects.filter(pk=assigned.pk).update(status=Request.ASSIGNED, assigned_scout=self.scout)
        self.assertEqual(self.withdraw(assigned.pk).status_code, 200)
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="detail_change_withdrawn").exists())

        self.file()
        verified = Request.objects.get(status=Request.REQUESTED)
        Request.objects.filter(pk=verified.pk).update(status=Request.VERIFIED)
        response = self.withdraw(verified.pk)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "not_withdrawable")

    def test_cannot_withdraw_another_business_request(self):
        other = make_business(self.scout, phone="+233209998887", name="Other Shop", gps="AK-039-5029")
        Holder(other, "business_owner").post(URL, {"field": "full_name", "new_value": "Someone Else", "reason": "Typo."})
        theirs = Request.objects.get(business_owner=other)
        response = self.withdraw(theirs.pk)
        self.assertEqual(response.status_code, 404)
        theirs.refresh_from_db()
        self.assertEqual(theirs.status, Request.REQUESTED)

    # ── what is written down ────────────────────────────────────────────────

    def test_activity_and_notice_hold_no_raw_contact(self):
        self.file()
        self.file("email", "new.mail@example.com")
        change = Request.objects.get(field="login_phone")

        notices = Notification.objects.filter(kind="detail_change_requested")
        self.assertEqual(set(notices.values_list("staff", flat=True)), {self.ops.pk})  # holders of portfolio.manage
        self.assertEqual(notices.count(), 2)
        events = ActivityEvent.objects.filter(verb="business.detail_change_requested")
        self.assertEqual(events.count(), 2)
        event = events.get(after__field="login_phone")
        self.assertEqual(event.actor_type, ActivityEvent.BUSINESS_OWNER)
        self.assertEqual(event.after, {"request_id": change.pk, "field": "login_phone", "new_value": "020 *** 4321"})

        self.withdraw(change.pk)
        written = json.dumps([
            list(Notification.objects.values("title", "body")),
            list(ActivityEvent.objects.values("summary", "before", "after", "target_label")),
        ], default=str)
        self.assertNotIn(NEW_PHONE_DIGITS, written)
        self.assertNotIn("new.mail@", written)

    def test_customer_and_staff_tokens_403(self):
        customer = Customer.objects.create(full_name="Yaw", email="yaw3@example.com", phone="+233271234569", password_hash="x")
        self.file()
        pk = Request.objects.get().pk
        for token in (issue_token(customer, "customer"), staff_token(self.ops, sudo=True)):
            headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
            self.assertEqual(self.client.get(URL, **headers).status_code, 403)
            self.assertEqual(self.client.post(URL, {"field": "full_name", "new_value": "X Y", "reason": "r"},
                                              content_type="application/json", **headers).status_code, 403)
            self.assertEqual(self.client.post(f"{URL}{pk}/withdraw/", **headers).status_code, 403)
        self.assertEqual(Request.objects.get().status, Request.REQUESTED)
