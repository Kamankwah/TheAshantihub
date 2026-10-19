"""Only a manual release by staff asks for the password (wallet rulings 7C, task 1). The system's own releases do not:
the verification call and the hourly job post the release themselves, with no staff password in the loop. The one manual
door is the events ticket release (events/tests/test_escrow_release_sudo.py); no ledger door releases by hand."""
from django.test import override_settings

from ledger import escrow
from ledger.models import Account, FulfilmentCheck, Journal

from .test_verification import VerificationBase


@override_settings(LEDGER_ENABLED=True)
class AutomaticReleaseNeedsNoSudoTests(VerificationBase):
    def test_automatic_release_needs_no_sudo(self):
        order = self.paid_order(customer_confirmed=True)
        FulfilmentCheck.objects.update_or_create(order=order, defaults={"outcome": FulfilmentCheck.MATCHES})
        escrow.release_verified(order)  # no request, no session: the system's own release
        self.assertTrue(Journal.objects.filter(key=escrow.release_key(order)).exists())
        self.assertEqual(self.balance(Account.VENDOR_PENDING, self.kofi), 0)

    def test_the_support_verification_call_releases_without_a_fresh_password(self):
        order = self.paid_order(customer_confirmed=True)
        self.as_staff(self.support)  # token without sudo
        response = self.verify(order, "matches")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["released"])
