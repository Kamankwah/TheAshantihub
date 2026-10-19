"""Rider withdrawal events in the staff activity log show the amount (owner ruling 2026-10-18: "it should show the amount").
Never the payout number. Operations (Dispatch is in its activity domain) and the rider's line manager read it through the
existing activity visibility rules; nobody needs wallets.view for that."""
import json
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from ledger.tests import rider_helpers
from wallets.models import PayoutDestination

from .helpers import Holder

BASE = "/api/delivery/rider/wallet/"
MOMO = {"rail": "momo", "institution": "MTN", "account_number": "0241234567"}


def reader(staff):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
    return client


@override_settings(LEDGER_ENABLED=True)
class RiderEventAmountTests(TestCase):
    def setUp(self):
        self.swift = rider_helpers.rider()
        rider_helpers.ghana_card(self.swift)
        rider_helpers.earning(self.swift, gross=2000, at=timezone.now())
        self.me = Holder(self.swift.staff, "staff")
        added = self.me.post(BASE + "destinations/", MOMO, action="payout_destination")
        PayoutDestination.objects.filter(pk=added.json()["id"]).update(usable_from=timezone.now() - timedelta(hours=1))
        self.destination = added.json()["id"]

    def withdraw(self, amount="9.50", request_id="req-amount-0001"):
        return self.me.post(
            BASE + "withdrawals/", {"destination": self.destination, "amount": amount, "request_id": request_id}, action="withdrawal",
        )

    def event(self, verb):
        return ActivityEvent.objects.get(verb=verb)

    def test_rider_withdrawal_event_carries_amount(self):
        self.assertEqual(self.withdraw().status_code, 201)
        event = self.event("wallets.rider_withdrawal_requested")
        self.assertIn("GH₵ 9.50", event.summary)
        self.assertEqual(event.after["amount"], "9.50")
        self.assertEqual(event.after["amount_label"], "GH₵ 9.50")
        self.assertIn("GH₵ 9.50", json.dumps(event.after, ensure_ascii=False))

    def test_the_event_never_carries_the_payout_number(self):
        self.withdraw()
        for event in ActivityEvent.objects.all():
            self.assertNotIn("1234567", json.dumps([event.summary, event.target_label, event.before, event.after]))

    def test_one_helper_gives_every_withdrawal_event_its_amount(self):
        from wallets import withdrawals
        from wallets.models import Withdrawal
        self.withdraw()
        withdrawal = Withdrawal.objects.get()
        self.assertEqual(withdrawals.event_amount(withdrawal), {"amount": "9.50", "amount_label": "GH₵ 9.50"})

    def test_staff_without_wallets_view_can_read_event_amount_per_policy(self):
        self.withdraw()
        manager = make_staff("delivery_manager", "dm@example.com", phone="+233244000077")
        self.swift.staff.manager = manager
        self.swift.staff.save(update_fields=["manager"])
        operations = make_staff("operations", "ops@example.com", phone="+233244000078")
        scout = make_staff("scout", "scout@example.com", phone="+233244000079")
        for who in (manager, operations):
            self.assertNotIn("wallets.view", who.effective_permission_codenames(), who.role.name)
            rows = reader(who).get("/api/activity/", {"verb": "wallets.rider_withdrawal"}).json()["results"]
            self.assertEqual([row["verb"] for row in rows], ["wallets.rider_withdrawal_requested"], who.role.name)
            self.assertEqual(rows[0]["after"]["amount_label"], "GH₵ 9.50", who.role.name)
            self.assertIn("GH₵ 9.50", rows[0]["summary"])
        stranger = reader(scout).get("/api/activity/", {"verb": "wallets.rider_withdrawal"}).json()["results"]
        self.assertEqual(stranger, [])                                                    # policy unchanged: not widened
