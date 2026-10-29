"""OrderItem.line_name: what the seller packs, in the owner's new-order alert."""
from django.test import TestCase

from notifications.models import Notification
from orders.alerts import alert_owners_of_paid_order
from orders.models import Order, OrderItem

from .test_variant_checkout import VariantCheckoutBase


class LineNameTests(VariantCheckoutBase, TestCase):
    def setUp(self):
        self.setup_world()

    def test_line_name_adds_the_variant_only_when_there_is_one(self):
        self.put(self.vanilla, 1)
        self.put(self.choc, 2)
        self.assertEqual(self.checkout().status_code, 201)
        names = sorted(i.line_name for i in OrderItem.objects.all())
        self.assertEqual(names, ["Cake (Chocolate / 500 g)", "Cake (Vanilla / 500 g)"])
        plain = OrderItem(order=Order.objects.get(), listing=self.cake, quantity=1, unit_price="1.00", line_total="1.00")
        self.assertEqual(plain.line_name, "Cake")

    def test_the_owner_alert_names_both_variants(self):
        self.put(self.vanilla, 1)
        self.put(self.choc, 2)
        self.assertEqual(self.checkout().status_code, 201)
        Notification.objects.all().delete()  # checkout may already have alerted
        with self.captureOnCommitCallbacks(execute=True):
            alert_owners_of_paid_order(Order.objects.get())
        body = Notification.objects.filter(kind=Notification.NEW_ORDER).get().body
        self.assertIn("Cake (Vanilla / 500 g)", body)
        self.assertIn("Cake (Chocolate / 500 g)", body)
