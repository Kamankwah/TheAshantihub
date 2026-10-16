"""Who a rider works for (wallets Plan 5, Task 1; spec §1 rows 4-5, §7): AshantiHub's own by default, third-party only
through the delivery.rider_employment approval, and never switched back while money is open. Review Focus 4."""
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

from django.db import transaction
from django.test import override_settings
from django.utils import timezone

from accounts.models import StaffUser
from accounts.testing import make_staff
from approvals import registry
from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.services import MakerCannotDecide
from delivery import employment
from delivery.models import Rider, RiderEmploymentPeriod
from ledger import escrow, posting
from ledger.models import Account
from orders.models import DeliveryAssignment

from .base import DeliveryCase

URL = "/api/delivery/riders/{}/employment/"


class EmploymentTests(DeliveryCase):
    def super_admin(self):
        return StaffUser.objects.filter(email="sa@example.com").first() or make_staff("super_admin", "sa@example.com")

    def propose(self, staff, body, rider=None):
        sudo = staff.role.name == "super_admin"                       # a Super Admin's own change needs the password
        return self.as_staff(staff, sudo=sudo).post(URL.format((rider or self.rider).pk), body, format="json")

    def make_third_party(self):
        self.rider.employment, self.rider.company_name = Rider.THIRD_PARTY, "Swift Riders Ltd"
        self.rider.third_party_since = timezone.now() - timedelta(days=3)
        self.rider.save(update_fields=["employment", "company_name", "third_party_since"])
        RiderEmploymentPeriod.objects.create(rider=self.rider, started_at=self.rider.third_party_since)

    def fund_rider(self, pesewas, key="fund-rider"):
        posting.post(key=key, kind="test_fund", lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas),
            posting.credit(posting.account_for(Account.RIDER_BALANCE, self.rider_staff), pesewas),
        ])

    def test_a_new_rider_is_ashantihubs_own_and_has_no_wallet(self):
        self.assertEqual(self.rider.employment, Rider.ASHANTIHUB)
        self.assertIsNone(employment.wallet_rider(self.rider_staff))
        profile = self.as_staff(self.manager).get(f"/api/delivery/riders/{self.rider.pk}/").json()
        self.assertEqual((profile["employment"]["employment"], profile["employment"]["wallet"]), ("ashantihub", False))
        self.assertIsNone(profile["employment"]["pending"])

    def test_review_focus_the_manager_proposes_and_only_a_super_admin_makes_a_rider_third_party(self):
        response = self.propose(self.manager, {"employment": "third_party", "company_name": "Swift Riders Ltd"})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], ApprovalRequest.PENDING)
        self.assertEqual(response.json()["employment"]["pending"]["company_name"], "Swift Riders Ltd")
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.ASHANTIHUB)                         # nothing changes until approved
        with self.assertRaises(MakerCannotDecide):
            approvals.approve(response.json()["approval_id"], self.manager)               # the maker never decides
        approvals.approve(response.json()["approval_id"], self.super_admin())
        self.rider.refresh_from_db()
        self.assertEqual((self.rider.employment, self.rider.company_name), (Rider.THIRD_PARTY, "Swift Riders Ltd"))
        self.assertIsNotNone(self.rider.third_party_since)
        self.assertEqual(employment.wallet_rider(self.rider_staff), self.rider)

    def test_a_super_admins_own_change_applies_at_once(self):
        response = self.propose(self.super_admin(), {"employment": "third_party", "company_name": "Swift Riders Ltd"})
        self.assertEqual((response.status_code, response.json()["status"]), (201, ApprovalRequest.APPROVED))
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.THIRD_PARTY)

    def test_a_third_party_rider_needs_a_company_and_a_second_request_waits(self):
        blank = self.propose(self.manager, {"employment": "third_party", "company_name": " "})
        self.assertEqual((blank.status_code, blank.json()["field"]), (400, "company_name"))
        unknown = self.propose(self.manager, {"employment": "freelance"})
        self.assertEqual((unknown.status_code, unknown.json()["field"]), (400, "employment"))
        same = self.propose(self.manager, {"employment": "ashantihub"})
        self.assertEqual((same.status_code, same.json()["code"]), (409, "no_change"))
        self.assertEqual(self.propose(self.manager, {"employment": "third_party", "company_name": "Swift"}).status_code, 201)
        again = self.propose(self.manager, {"employment": "third_party", "company_name": "Other Riders"})
        self.assertEqual((again.status_code, again.json()["code"]), (409, "already_pending"))

    def test_a_rider_cannot_change_their_own_employment(self):
        self.assertEqual(self.propose(self.rider_staff, {"employment": "third_party", "company_name": "Me Ltd"}).status_code, 403)

    def test_a_super_admin_cannot_make_themselves_third_party(self):
        sa = self.super_admin()
        own = Rider.objects.get_or_create(staff=sa)[0]                    # any Dispatch holder gets a Rider row; a Super Admin holds every permission
        body = {"employment": "third_party", "company_name": "Me Ltd"}
        mine = self.as_staff(sa, sudo=True).post(URL.format(own.pk), body, format="json")
        self.assertEqual((mine.status_code, mine.json()["code"]), (403, "own_rider"))
        other = StaffUser.objects.filter(email="sa2@example.com").first() or make_staff("super_admin", "sa2@example.com")
        not_a_rider = self.as_staff(other, sudo=True).post(URL.format(own.pk), body, format="json")   # the row's owner is no Dispatch rider
        self.assertEqual((not_a_rider.status_code, not_a_rider.json()["code"]), (409, "not_a_rider"))
        own.refresh_from_db()
        self.assertEqual(own.employment, Rider.ASHANTIHUB)

    @override_settings(LEDGER_ENABLED=True)
    def test_the_approval_needs_the_password_and_says_what_it_does(self):
        kind = registry.get_kind(employment.KIND)
        self.assertTrue(kind.requires_sudo)
        said = kind.consequences(SimpleNamespace(payload={"employment": "third_party"}))[0]
        self.assertIn("10%", said)
        self.assertIn("before approval stay AshantiHub's", said)
        self.assertIn("payroll", kind.consequences(SimpleNamespace(payload={"employment": "ashantihub"}))[0])

    @override_settings(LEDGER_ENABLED=True)
    def test_review_focus_switching_back_is_refused_while_the_rider_has_money(self):
        self.make_third_party()
        self.fund_rider(900)
        response = self.propose(self.super_admin(), {"employment": "ashantihub"})
        self.assertEqual(
            (response.status_code, response.json()["code"], response.json()["open"]), (409, "rider_money_open", ["balance"]),
        )
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.THIRD_PARTY)

    @override_settings(LEDGER_ENABLED=True)
    def test_a_delivered_order_waiting_for_supports_call_blocks_switching_back(self):
        self.make_third_party()
        order = self.make_order()
        escrow.record_order_payment(order)
        DeliveryAssignment.objects.create(
            order=order, dispatch=self.rider_staff, status=DeliveryAssignment.DELIVERED, delivered_at=timezone.now(),
        )
        self.assertEqual(list(employment.unreleased_deliveries(self.rider).values_list("order_id", flat=True)), [order.pk])
        response = self.propose(self.manager, {"employment": "ashantihub"})
        self.assertEqual((response.status_code, response.json()["open"]), (409, ["deliveries"]))

    @override_settings(LEDGER_ENABLED=True)
    def test_switching_back_once_settled_closes_the_wallet(self):
        self.make_third_party()
        response = self.propose(self.super_admin(), {"employment": "ashantihub"})
        self.assertEqual(response.json()["status"], ApprovalRequest.APPROVED, response.content)
        self.rider.refresh_from_db()
        self.assertEqual((self.rider.employment, self.rider.company_name, self.rider.third_party_since), (Rider.ASHANTIHUB, "", None))
        self.assertIsNone(employment.wallet_rider(self.rider_staff))

    @override_settings(LEDGER_ENABLED=True)
    def test_money_arriving_before_the_decision_refuses_the_approval(self):
        self.make_third_party()
        response = self.propose(self.manager, {"employment": "ashantihub"})                 # nothing open yet: staged
        self.assertEqual(response.status_code, 201, response.content)
        self.fund_rider(500)                                                                  # a release paid them meanwhile
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(response.json()["approval_id"], self.super_admin())
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.THIRD_PARTY)
        self.assertEqual(ApprovalRequest.objects.get(pk=response.json()["approval_id"]).status, ApprovalRequest.PENDING)

    def test_a_super_admins_own_proposal_needs_the_password(self):
        sa = self.super_admin()
        response = self.as_staff(sa).post(URL.format(self.rider.pk), {"employment": "third_party", "company_name": "Swift"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "sudo_required"))
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.ASHANTIHUB)

    def test_another_delivery_manager_cannot_approve_and_the_http_approval_asks_for_the_password(self):
        response = self.propose(self.manager, {"employment": "third_party", "company_name": "Swift"})
        peer = make_staff("delivery_manager", "dm2@example.com", phone="+233244000009")
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(response.json()["approval_id"], peer)
        url = f"/api/approvals/{response.json()['approval_id']}/approve/"
        answer = self.as_staff(self.super_admin()).post(url, {}, format="json")
        self.assertEqual((answer.status_code, answer.json().get("code")), (403, "sudo_required"))
        self.assertEqual(self.as_staff(self.super_admin(), sudo=True).post(url, {}, format="json").status_code, 200)

    def test_the_rider_cannot_decide_their_own_change(self):
        response = self.propose(self.manager, {"employment": "third_party", "company_name": "Swift"})
        request = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        request.decided_by = self.rider_staff
        with self.assertRaises(MakerCannotDecide), transaction.atomic():
            employment.apply(request)

    def test_not_a_rider_at_decision_time(self):
        response = self.propose(self.manager, {"employment": "third_party", "company_name": "Swift"})
        self.rider_staff.role = make_staff("scout", "scout@example.com").role
        self.rider_staff.save(update_fields=["role"])
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(response.json()["approval_id"], self.super_admin())

    @override_settings(LEDGER_ENABLED=True)
    def test_the_reserve_and_an_open_withdrawal_each_block_switching_back(self):
        self.make_third_party()
        posting.post(key="fund-reserve", kind="test_fund", lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), 100),
            posting.credit(posting.account_for(Account.RIDER_RESERVE, self.rider_staff), 100),
        ])
        self.assertEqual(employment.money_open(self.rider), ["reserve"])
        from otp.identity import ref
        from wallets.models import Withdrawal

        holder_type, holder_id = ref(self.rider_staff)
        with mock.patch.object(Withdrawal.objects, "filter") as fake:
            fake.return_value.exists.return_value = True
            self.assertEqual(employment.money_open(self.rider), ["reserve", "withdrawal"])
            fake.assert_called_once_with(holder_type=holder_type, holder_id=holder_id, status__in=Withdrawal.OPEN)

    @override_settings(LEDGER_ENABLED=True)
    def test_apply_decides_on_locked_balances_so_money_posted_after_the_proposal_refuses(self):
        self.make_third_party()
        response = self.propose(self.manager, {"employment": "ashantihub"})
        self.fund_rider(300)                                          # e.g. a withdrawal returned between propose and apply
        request = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        request.decided_by = self.super_admin()
        with mock.patch("ledger.posting.lock", wraps=posting.lock) as locked:
            with self.assertRaises(approvals.ApprovalError), transaction.atomic():
                employment.apply(request)
        locked.assert_called_once()
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.THIRD_PARTY)

    @override_settings(LEDGER_ENABLED=True)
    def test_history_is_kept_in_periods_so_payroll_still_leaves_out_third_party_days(self):
        now = timezone.now()
        orders = []
        for days in (5, 15, 25):                                        # delivered 5, 15 and 25 days ago
            order = self.make_order()
            DeliveryAssignment.objects.create(
                order=order, dispatch=self.rider_staff, status=DeliveryAssignment.DELIVERED, delivered_at=now - timedelta(days=days),
            )
            orders.append(order.pk)
        self.rider.employment, self.rider.company_name = Rider.THIRD_PARTY, "Swift"
        self.rider.third_party_since = now - timedelta(days=20)
        self.rider.save(update_fields=["employment", "company_name", "third_party_since"])
        RiderEmploymentPeriod.objects.create(rider=self.rider, started_at=now - timedelta(days=20))
        response = self.propose(self.super_admin(), {"employment": "ashantihub"})          # switched back (10 days ago in effect: now)
        self.assertEqual(response.json()["status"], ApprovalRequest.APPROVED, response.content)
        RiderEmploymentPeriod.objects.filter(rider=self.rider).update(ended_at=now - timedelta(days=10))
        kept = employment.payroll_jobs(DeliveryAssignment.objects.filter(dispatch=self.rider_staff))
        self.assertEqual(sorted(kept.values_list("order_id", flat=True)), sorted([orders[0], orders[2]]))   # the day-15 delivery is excluded
        self.assertTrue(employment.third_party_at(self.rider, now - timedelta(days=15)))
        self.assertFalse(employment.third_party_at(self.rider, now - timedelta(days=5)))
        again = self.propose(self.super_admin(), {"employment": "third_party", "company_name": "Other"})   # switching again later
        self.assertEqual(again.json()["status"], ApprovalRequest.APPROVED, again.content)
        self.assertEqual(self.rider.employment_periods.count(), 2)
        self.assertEqual(self.rider.employment_periods.filter(ended_at__isnull=True).count(), 1)
        kept = employment.payroll_jobs(DeliveryAssignment.objects.filter(dispatch=self.rider_staff))
        self.assertEqual(sorted(kept.values_list("order_id", flat=True)), sorted([orders[0], orders[2]]))   # both periods kept

    def test_the_wallet_flag_needs_the_dispatch_role(self):
        self.make_third_party()
        self.assertTrue(employment.row(self.rider)["wallet"])
        self.rider_staff.role = make_staff("scout", "scout2@example.com").role
        self.rider_staff.save(update_fields=["role"])
        self.rider.refresh_from_db()
        self.assertFalse(employment.row(self.rider)["wallet"])
