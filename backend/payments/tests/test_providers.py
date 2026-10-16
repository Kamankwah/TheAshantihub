"""The payment provider interface (spec §2.3): simulated by default, steered by settings; Hubtel's unknowns refuse
instead of guessing (payments/hubtel_client.py has no payout, status or name-lookup call)."""
from django.test import SimpleTestCase, override_settings

from payments import providers

NUMBER = "+233241234567"


class SelectionTests(SimpleTestCase):
    def test_the_default_is_the_simulated_provider(self):
        self.assertEqual(providers.get_provider().name, "simulated")

    @override_settings(PAYMENTS_PROVIDER="hubtel")
    def test_payments_provider_picks_hubtel(self):
        self.assertEqual(providers.get_provider().name, "hubtel")

    def test_a_name_overrides_the_setting_and_an_unknown_one_raises(self):
        self.assertEqual(providers.get_provider("hubtel").name, "hubtel")
        with self.assertRaises(providers.ProviderError):
            providers.get_provider("stripe")


class SimulatedProviderTests(SimpleTestCase):
    def setUp(self):
        self.provider = providers.SimulatedProvider()

    def test_charges_are_zero_unless_set(self):
        self.assertEqual(self.provider.collection_charge(12000), 0)
        self.assertEqual(self.provider.payout_charge(12000, providers.MOMO), 0)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=195, SIMULATED_PAYOUT_CHARGE_PESEWAS=150)
    def test_charges_follow_the_settings_and_round_half_up(self):
        self.assertEqual(self.provider.collection_charge(10000), 195)      # 1.95% of GH₵ 100.00
        self.assertEqual(self.provider.collection_charge(1000), 20)        # 19.5 pesewas rounds up
        self.assertEqual(self.provider.payout_charge(50000, providers.BANK), 150)

    def test_payouts_end_as_the_setting_says_and_anything_else_waits(self):
        cases = (("succeed", providers.SUCCEEDED), ("fail", providers.FAILED), ("pending", providers.PROCESSING), ("typo", providers.PROCESSING))
        for setting, expected in cases:
            with self.subTest(setting=setting), override_settings(SIMULATED_PAYOUT_OUTCOME=setting):
                result = self.provider.payout(reference="AH-WD-1", rail=providers.MOMO, institution="MTN", account_number=NUMBER, amount_pesewas=5000)
                self.assertEqual((result.status, result.provider_reference), (expected, "SIM-AH-WD-1"))
                self.assertEqual(self.provider.status("AH-WD-1").status, expected)
        self.assertTrue(self.provider.payouts_available())

    def test_the_name_lookup_answers_the_holder_unless_the_number_is_listed(self):
        self.assertEqual(self.provider.lookup_account_name(providers.MOMO, "MTN", NUMBER, holder_name="Ama Owusu"), "Ama Owusu")
        with override_settings(SIMULATED_ACCOUNT_NAMES={NUMBER: "KOFI BOATENG"}):
            self.assertEqual(self.provider.lookup_account_name(providers.MOMO, "MTN", NUMBER, holder_name="Ama Owusu"), "KOFI BOATENG")
        self.assertIsNone(self.provider.lookup_account_name(providers.MOMO, "MTN", NUMBER))


class HubtelProviderTests(SimpleTestCase):
    def setUp(self):
        self.provider = providers.HubtelProvider()

    def test_only_the_collection_charge_is_known(self):
        self.assertEqual(self.provider.collection_charge(10000), 0)
        with override_settings(HUBTEL_COLLECTION_CHARGE_BP=100):
            self.assertEqual(self.provider.collection_charge(10000), 100)
        self.assertFalse(self.provider.payouts_available())

    def test_payouts_status_charges_and_name_lookups_are_not_connected(self):
        calls = (
            lambda: self.provider.payout(reference="AH-WD-1", rail=providers.MOMO, institution="MTN", account_number=NUMBER, amount_pesewas=5000),
            lambda: self.provider.status("AH-WD-1"),
            lambda: self.provider.lookup_account_name(providers.MOMO, "MTN", NUMBER, holder_name="Ama Owusu"),
            lambda: self.provider.payout_charge(5000, providers.MOMO),
        )
        for call in calls:
            with self.assertRaises(providers.NotConnected):
                call()
