"""Plan 3b groundwork: the withdrawal limits and the cooling period as governed money settings, step-up codes for wallet
actions and for adding a recovery contact whenever the ledger is on (spec §8, §11), and the name check. Review Focus 5
(the code channel) and 8 (switches off)."""
from types import SimpleNamespace

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff, staff_token
from ledger import approval_kinds, settings_store
from otp import senders
from otp.tests.helpers import last_sms_code
from wallets import names

SECONDARY_EMAIL = "/api/accounts/customers/me/secondary-email/"
SECONDARY_PHONE = "/api/accounts/customers/me/secondary-phone/"


class LimitSettingsTests(TestCase):
    def test_the_new_settings_have_their_defaults(self):
        self.assertEqual(settings_store.current("withdrawal_per_tx_limit_pesewas"), 500_000)
        self.assertEqual(settings_store.current("withdrawal_daily_limit_pesewas"), 1_000_000)
        self.assertEqual(settings_store.current("payout_cooling_hours"), 24)

    def test_their_bounds(self):
        self.assertEqual(settings_store.clean("payout_cooling_hours", 1), 1)
        for key, raw in (
            ("payout_cooling_hours", 0), ("payout_cooling_hours", 721), ("withdrawal_per_tx_limit_pesewas", 99),
            ("withdrawal_daily_limit_pesewas", None),
        ):
            with self.assertRaises(settings_store.SettingError, msg=f"{key}={raw!r}"):
                settings_store.clean(key, raw)

    def test_they_change_only_through_the_money_setting_approval(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('accountant', 'kofi@example.com'))}")
        response = client.post("/api/ledger/settings/", {"key": "payout_cooling_hours", "value": 48}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(settings_store.current("payout_cooling_hours"), 24)                    # waits for a Super Admin

    def test_the_approval_says_what_a_withdrawal_setting_applies_to(self):
        said = approval_kinds.setting_consequences(SimpleNamespace(payload={"key": "payout_cooling_hours"}))
        self.assertIn("withdrawals", said[0])
        self.assertNotIn("orders", said[0])
        self.assertEqual(
            approval_kinds.setting_consequences(SimpleNamespace(payload={"key": "rider_commission_bp"})),
            ["Applies only to orders paid after it starts."],
        )


class WalletStepUpTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")

    def send(self, action):
        return self.client.post("/api/otp/step-up/send/", {"action": action, "channel": "sms"}, format="json")

    @override_settings(LEDGER_ENABLED=True, OTP_STEP_UP_ENFORCED=False, OTP_SIGNIN_ENFORCED=False)
    def test_with_the_ledger_on_wallet_actions_get_a_code_whatever_the_otp_switches_say(self):
        for action in ("withdrawal", "payout_destination", "contact_change"):
            with self.subTest(action=action):
                self.assertEqual(self.send(action).status_code, 200)
                verified = self.client.post("/api/otp/step-up/verify/", {"action": action, "code": last_sms_code()}, format="json")
                self.assertEqual(verified.status_code, 200, verified.content)
                self.assertEqual(verified.json()["action"], action)
        self.assertEqual(self.send("authenticator_change").json()["code"], "otp_off")          # not the other actions

    @override_settings(LEDGER_ENABLED=True, OTP_STEP_UP_ENFORCED=False, OTP_SIGNIN_ENFORCED=False)
    def test_review_focus_a_recovery_email_needs_a_code_while_the_ledger_is_on(self):
        # A verified recovery email is a code channel for a customer with no email (otp.identity.contacts): a stolen
        # session must not be able to add its own and then confirm withdrawals with it.
        for url, body in ((SECONDARY_EMAIL, {"secondary_email": "x@example.com"}), (SECONDARY_PHONE, {"secondary_phone": "0241234599"})):
            with self.subTest(url=url):
                response = self.client.post(url, body, format="json")
                self.assertEqual((response.status_code, response.json()["code"]), (403, "step_up_required"))
        self.customer.refresh_from_db()
        self.assertEqual((self.customer.secondary_email, self.customer.secondary_phone), (None, None))

    @override_settings(LEDGER_ENABLED=True, OTP_STEP_UP_ENFORCED=False, OTP_SIGNIN_ENFORCED=False)
    def test_a_contact_change_token_lets_the_recovery_email_through(self):
        self.send("contact_change")
        token = self.client.post("/api/otp/step-up/verify/", {"action": "contact_change", "code": last_sms_code()}, format="json").json()["step_up_token"]
        response = self.client.post(SECONDARY_EMAIL, {"secondary_email": "x@example.com"}, format="json", HTTP_X_STEP_UP_TOKEN=token)
        self.assertEqual(response.status_code, 200, response.content)

    @override_settings(LEDGER_ENABLED=False, OTP_STEP_UP_ENFORCED=False, OTP_SIGNIN_ENFORCED=False)
    def test_review_focus_with_the_ledger_off_nothing_changes(self):
        for action in ("withdrawal", "contact_change"):
            response = self.send(action)
            self.assertEqual((response.status_code, response.json()["code"]), (409, "otp_off"), action)
        self.assertEqual(senders.sms_outbox, [])
        added = self.client.post(SECONDARY_EMAIL, {"secondary_email": "x@example.com"}, format="json")
        self.assertEqual(added.status_code, 200, added.content)                                  # no code asked, as before


class NameMatchTests(SimpleTestCase):
    def test_the_same_words_in_any_case_order_or_accents_match(self):
        self.assertTrue(names.matches("AMA OWUSU", "Ama Owusu"))
        self.assertTrue(names.matches("Owusu, Ama", "Ama Owusu"))
        self.assertTrue(names.matches("Ábena Ófori", "Abena Ofori"))

    def test_extra_words_on_the_account_still_match(self):
        self.assertTrue(names.matches("KWAME ASANTE MENSAH JR", "Kwame Asante Mensah"))
        self.assertTrue(names.matches("ADEPA VENTURES LTD", "Adepa Ventures"))
        self.assertTrue(names.matches("KWAME ASANTE MENSAH", "Kwame Mensah"))

    def test_the_account_must_carry_every_word_of_the_verified_name(self):
        for account, verified in (
            ("ASANTE MENSAH", "Kwame Asante Mensah"), ("VENTURES LTD", "Adepa Ventures Ltd"),
            ("ENTERPRISE GHANA", "Ama Owusu Enterprise Ghana"), ("A MENSAH", "Kwame A Mensah"),
        ):
            self.assertFalse(names.matches(account, verified), (account, verified))

    def test_one_word_alone_or_another_person_never_matches(self):
        self.assertFalse(names.matches("MENSAH", "Kwame Mensah"))
        self.assertFalse(names.matches("MENSAH", "Mensah"))
        self.assertFalse(names.matches("Kwame A", "Kwame A"))                                   # an initial is not a word
        self.assertFalse(names.matches("Kofi Boateng", "Ama Owusu"))
        self.assertFalse(names.matches("", "Ama Owusu"))
        self.assertFalse(names.matches("Ama Owusu", None))


class VerifiedNameTests(TestCase):
    def test_a_customer_has_their_profile_name(self):
        customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.assertEqual(names.verified_names(customer), ["Ama Owusu"])
        self.assertEqual(names.matching_name("AMA OWUSU", customer), "Ama Owusu")

    def test_a_vendor_has_names_only_once_kyc_verified(self):
        owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Adepa Ventures")
        self.assertEqual(names.verified_names(owner), [])
        owner.kyc_status = BusinessOwner.VERIFIED
        owner.save(update_fields=["kyc_status"])
        self.assertEqual(names.verified_names(owner), ["Kwame Mensah", "Adepa Ventures"])
        self.assertEqual(names.matching_name("ADEPA VENTURES LTD", owner), "Adepa Ventures")
        self.assertIsNone(names.matching_name("KOFI BOATENG", owner))
