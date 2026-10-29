"""Variants and marketing: a variant listing is not eligible for a flash sale (decision V4)."""
from listings import variants
from listings.models import ListingVariant
from marketing import flash_sales as flash
from marketing.tests.test_promos import PromoBase


class VariantFlashTests(PromoBase):
    def test_flash_sale_refuses_a_variant_listing(self):
        self.assertIsNone(flash.eligibility_problem(self.stole))
        ListingVariant.objects.create(listing=self.stole, label="Large", price_amount="100.00", stock_quantity=5)
        variants.sync_listing(self.stole)
        self.stole.refresh_from_db()
        self.assertEqual(flash.eligibility_problem(self.stole), "Has variants: choose a single-price listing.")
