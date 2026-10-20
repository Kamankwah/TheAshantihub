"""Only a manual release by staff asks for the password (wallet rulings 7C, task 1). Support's positive verification call
("matches") is the manual release door, for orders and for bookings; its non-releasing outcomes, the system's own release
(escrow.release_verified, the hourly job) and the events ticket release (events/tests/test_escrow_release_sudo.py) are
covered alongside."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from accounts.testing import make_staff
from ledger import escrow, sales
from ledger.models import Account, FulfilmentCheck, Journal
from services.models import ServiceRequest

from .booking_helpers import BookingBase
from .test_verification import VerificationBase


@override_settings(LEDGER_ENABLED=True)
class ManualOrderReleaseSudoTests(VerificationBase):
    def test_manual_release_without_sudo_is_403(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support, sudo=False)
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "sudo_required")
        self.assertFalse(Journal.objects.filter(key=escrow.release_key(order)).exists())
        self.assertFalse(FulfilmentCheck.objects.filter(order=order, outcome=FulfilmentCheck.MATCHES).exists())

    def test_manual_release_with_sudo_works(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support, sudo=True)
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["released"])

    def test_a_non_releasing_outcome_needs_no_sudo(self):
        order = self.paid_order()
        self.as_staff(self.support, sudo=False)
        self.assertEqual(self.verify(order, "unreachable").status_code, 200)
        self.assertEqual(self.verify(order, "does_not_match", note="Wrong item").status_code, 200)

    def test_automatic_release_needs_no_sudo(self):
        order = self.paid_order(customer_confirmed=True)
        FulfilmentCheck.objects.update_or_create(order=order, defaults={"outcome": FulfilmentCheck.MATCHES})
        escrow.release_verified(order)  # no request, no session: the system's own release
        self.assertTrue(Journal.objects.filter(key=escrow.release_key(order)).exists())
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)


@override_settings(LEDGER_ENABLED=True)
class ManualBookingReleaseSudoTests(BookingBase):
    def setUp(self):
        super().setUp()
        self.support = make_staff("support", "esi-sudo@example.com")

    def ready(self):
        sale = self.paid_service()
        ServiceRequest.objects.filter(pk=sale.service_request_id).update(
            status=ServiceRequest.COMPLETED, completed_at=timezone.now() - timedelta(hours=1),
        )
        return sale

    def verify(self, sale, **body):
        return self.client.post(f"/api/ledger/bookings/{sale.pk}/verification/", body, format="json")

    def test_manual_release_without_sudo_is_403(self):
        sale = self.ready()
        self.as_staff(self.support, sudo=False)
        response = self.verify(sale, outcome="matches", customer_confirmed_by_phone=True)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "sudo_required")
        sale.refresh_from_db()
        self.assertIsNone(sale.released_at)

    def test_manual_release_with_sudo_works(self):
        sale = self.ready()
        self.as_staff(self.support, sudo=True)
        response = self.verify(sale, outcome="matches", customer_confirmed_by_phone=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["released"])

    def test_a_non_releasing_outcome_needs_no_sudo(self):
        sale = self.ready()
        self.as_staff(self.support, sudo=False)
        self.assertEqual(self.verify(sale, outcome="unreachable").status_code, 200)

    def test_booking_release_due_manual_door_needs_sudo(self):
        """A booking whose release time has passed is still released by the clock alone: the manual door asks for the
        password, the hourly job (sales.release_due) has no session and asks for nothing."""
        sale = self.ready()
        self.as_staff(self.support, sudo=False)
        refused = self.verify(sale, outcome="matches", customer_confirmed_by_phone=True)
        self.assertEqual((refused.status_code, refused.json()["code"]), (403, "sudo_required"))
        sale.refresh_from_db()
        self.assertIsNone(sale.released_at)
        self.assertEqual(sales.release_due(sales.release_at(sale) + timedelta(minutes=1)), 1)
        sale.refresh_from_db()
        self.assertIsNotNone(sale.released_at)
        self.assertIsNone(sale.outcome_by)
