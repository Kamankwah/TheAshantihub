"""Fulfilment shows which variant was bought: the rider's stop lists both flavours of one listing."""
from delivery import payloads
from orders.models import OrderItem

from .base import DeliveryCase


class VariantLineTests(DeliveryCase):
    def test_a_two_variant_order_names_both_variants_on_the_rider_stop(self):
        shop, item = self.make_shop("Ama Bakes", "+233207000301", (6.70, -1.62))
        order = self.multi_order(item, item)
        first, second = list(order.items.order_by("pk"))
        OrderItem.objects.filter(pk=first.pk).update(variant_label="Vanilla")
        OrderItem.objects.filter(pk=second.pk).update(variant_label="Chocolate")
        assignment = self.assign(order)
        stop = assignment.stops.get()
        row = payloads.stop_row(stop, order)
        self.assertEqual(row["items"], ["Ama Bakes item (Vanilla) × 1", "Ama Bakes item (Chocolate) × 1"])
