from decimal import Decimal

from django.test import SimpleTestCase

from ledger.money import from_pesewas, to_pesewas


class MoneyTests(SimpleTestCase):
    def test_whole_cedis_and_pesewas_convert_exactly(self):
        self.assertEqual(to_pesewas("99.99"), 9999)
        self.assertEqual(to_pesewas(Decimal("100.00")), 10000)
        self.assertEqual(to_pesewas(Decimal("0.1")), 10)
        self.assertEqual(to_pesewas(0), 0)

    def test_a_fraction_of_a_pesewa_is_refused_not_rounded(self):
        with self.assertRaises(ValueError):
            to_pesewas("1.005")

    def test_round_trip(self):
        self.assertEqual(from_pesewas(9999), Decimal("99.99"))
        self.assertEqual(from_pesewas(5000000), Decimal("50000.00"))
        self.assertEqual(from_pesewas(0), Decimal("0.00"))
