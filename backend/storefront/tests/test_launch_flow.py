"""The launch night, end to end, against the seeded opening (2026-11-06 06:00 Africa/Accra). Time is driven by
replacing `timezone` inside the two storefront modules only, so the test never depends on today's date and JWT
auth (which reads the real clock) is untouched."""
from datetime import datetime
from types import SimpleNamespace
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.test import override_settings

from accounts.testing import make_staff
from orders.models import Order
from orders.tests.test_checkout import CheckoutTestsBase
from otp import senders
from storefront import notify, opening
from storefront.models import OpeningTime, TestAccount
from storefront.tasks import send_opening_notices


def at(hour, minute):
    return datetime(2026, 11, 6, hour, minute, tzinfo=opening.ACCRA)


def clock(moment):
    """Pin 'now' as seen by the opening gate and the notice sender."""
    fake = SimpleNamespace(now=lambda: moment)
    return mock.patch.multiple("storefront.opening", timezone=fake), mock.patch.multiple("storefront.notify", timezone=fake)


class pinned:
    def __init__(self, moment):
        self.patches = clock(moment)

    def __enter__(self):
        for p in self.patches:
            p.start()

    def __exit__(self, *exc):
        for p in self.patches:
            p.stop()


@override_settings(MARKETPLACE_GATE_ENABLED=True, FRONTEND_BASE_URL="https://staging.example.com")
class LaunchFlowTests(CheckoutTestsBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        senders.sms_outbox.clear()

    def checkout(self, customer):
        self._auth(customer)
        self.assertIn(self._add_to_cart(self.listing_a, 1).status_code, (200, 201))
        return self.client.post("/api/orders/checkout/")

    def test_launch_flow(self):
        row = OpeningTime.objects.get()  # the seeded row
        self.assertEqual(row.opens_at, at(6, 0))
        admin = make_staff("super_admin", "root-launch@example.com")
        TestAccount.objects.create(customer=self.other_customer, added_by=admin)
        notify.subscribe(phone="0244123456", email="fan@example.com")

        with pinned(at(5, 59)):
            self.assertFalse(opening.is_open())
            refused = self.checkout(self.customer)
            self.assertEqual(refused.status_code, 403, refused.content)
            self.assertEqual(refused.json()["code"], "not_open")
            self.assertEqual(refused.json()["detail"], "The marketplace opens on 6 Nov 2026 at 06:00.")
            self.assertFalse(Order.objects.filter(customer=self.customer).exists())

            self.assertEqual(self.checkout(self.other_customer).status_code, 201)  # allowlisted test customer

            self.assertEqual(send_opening_notices(), 0)  # a notify-me subscriber gets nothing yet
            self.assertEqual(senders.sms_outbox, [])
            self.assertEqual(mail.outbox, [])

        with pinned(at(6, 0)):
            self.assertTrue(opening.is_open())
            self.assertEqual(send_opening_notices(), 1)
            self.assertEqual(len(senders.sms_outbox), 1)
            self.assertEqual(len(mail.outbox), 1)
            self.assertIn("https://staging.example.com/notify/stop/", senders.sms_outbox[0].body)

            self.assertEqual(self.checkout(self.customer).status_code, 201)  # the earlier cart add (merged) now checks out

            self.assertEqual(send_opening_notices(), 0)  # the second tick sends nothing
            self.assertEqual(len(senders.sms_outbox), 1)
            self.assertEqual(len(mail.outbox), 1)
