"""Re-delivery at the customer's request (Plan 7F-E Task 7, owner Rulings R4 and R5): the rules (delivery.redelivery)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from delivery import redelivery
from delivery.models import Redelivery
from delivery.redelivery import RedeliveryError
from ledger.models import MoneySetting
from ledger.tests.redelivery_helpers import DA, RedeliveryBase
from notifications.models import Notification


@override_settings(LEDGER_ENABLED=True)
class RedeliveryRequestTests(RedeliveryBase):
    def refused(self, order, code="not_redeliverable"):
        with self.assertRaises(RedeliveryError) as raised:
            self.ask(order)
        self.assertEqual((raised.exception.status_code, raised.exception.code), (409, code))

    def test_request_refused_unless_failed_no_answer_after_arrival(self):
        self.refused(self.failed_other("wrong_address"))                 # case (a): a plain re-assignment, no fee
        self.refused(self.failed_other("refused"))
        on_the_road = self.door_order()
        self.give(on_the_road, self.swift)
        self.collect_all(on_the_road, self.swift)
        self.refused(on_the_road)                                         # still with the rider
        self.refused(self.door_order())                                   # never assigned
        order = self.unavailable()
        row = self.ask(order)
        self.assertEqual((row.status, row.attempt, row.first_rider_id), (Redelivery.AWAITING_PAYMENT, 1, self.swift.staff_id))
        self.assertIsNotNone(row.first_leg_ended_at)
        notice = Notification.objects.filter(customer=self.customer).order_by("-id").first()
        self.assertIn("Pay GH₵ 15.00", notice.title)
        self.assertEqual(notice.link, "/my-account")

    def test_request_refused_for_a_wholly_refunded_order(self):
        from ledger import refunds

        order = self.unavailable()
        refunds.refund_order(order, source="cancel")
        self.refused(order)

    def test_request_needs_a_reason(self):
        with self.assertRaises(RedeliveryError) as raised:
            redelivery.request(self.unavailable(), self.support, "   ")
        self.assertEqual(raised.exception.status_code, 400)

    def test_request_snapshots_fee_from_setting(self):
        MoneySetting.objects.create(key="redelivery_fee_pesewas", value=2500, effective_from=timezone.now() - timedelta(minutes=1))
        row = self.ask(self.unavailable())
        self.assertEqual(row.fee_pesewas, 2500)

    def test_setting_change_does_not_change_open_request(self):
        row = self.ask(self.unavailable())
        MoneySetting.objects.create(key="redelivery_fee_pesewas", value=900, effective_from=timezone.now() - timedelta(seconds=1))
        row.refresh_from_db()
        self.assertEqual(row.fee_pesewas, 1500)
        self.pay(row)
        self.assertEqual(row.pay_journal.lines.first().amount, 1500)

    def test_a_free_redelivery_needs_no_payment(self):
        MoneySetting.objects.create(key="redelivery_fee_pesewas", value=0, effective_from=timezone.now() - timedelta(minutes=1))
        row = self.ask(self.unavailable())
        self.assertEqual((row.status, row.fee_pesewas, row.pay_journal), (Redelivery.PAID, 0, None))

    def test_one_open_redelivery_per_order(self):
        order = self.unavailable()
        self.ask(order)
        self.refused(order, "redelivery_open")
        self.assertEqual(Redelivery.objects.filter(order=order).count(), 1)
        redelivery.cancel(Redelivery.objects.get(order=order).pk, self.support)
        second = self.ask(order)                                          # a closed request does not block a new one
        self.assertEqual(second.attempt, 2)

    def test_cancel_before_payment(self):
        row = self.ask(self.unavailable())
        redelivery.cancel(row.pk, self.support)
        row.refresh_from_db()
        self.assertEqual((row.status, row.refund_journal), (Redelivery.CANCELLED, None))
        self.assertIsNotNone(row.cancelled_at)

    def test_cancel_refused_once_assigned(self):
        order = self.unavailable()
        row = self.ask(order)
        self.pay(row)
        self.second_trip(order, self.own)
        with self.assertRaises(RedeliveryError) as raised:
            redelivery.cancel(row.pk, self.support)
        self.assertEqual(raised.exception.code, "redelivery_not_cancellable")

    def test_a_second_payment_after_the_first_goes_to_the_wallet(self):
        order = self.unavailable()
        row = self.ask(order)
        self.pay(row, wallet=False)
        session = self.pay(row, wallet=False)              # a second mobile-money session for the same request lands later
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.PAID)
        session.refresh_from_db()
        self.assertEqual(session.metadata["journal_key"], f"redelivery-stray-{session.reference}")
        self.assertEqual(self.wallet(), 1500)
        self.assert_balanced()


@override_settings(LEDGER_ENABLED=True)
class CustomerUnavailableReasonTests(RedeliveryBase):
    """Director ruling 3 (2026-10-20): "the customer was not available" is a failure at the address (arrived_drop_at set)
    for no answer OR a refusal at the door (CUSTOMER_UNAVAILABLE_REASONS). Any other reason is a plain re-assignment."""

    def unavailable_now(self, order):
        return redelivery.customer_unavailable(DA.objects.get(order=order))

    def test_the_named_reasons_are_no_answer_and_refused(self):
        self.assertEqual(redelivery.CUSTOMER_UNAVAILABLE_REASONS, ("no_answer", "refused"))

    def test_no_answer_after_arrival_counts(self):
        order = self.unavailable()
        self.assertTrue(self.unavailable_now(order))
        self.assertEqual(self.ask(order).status, Redelivery.AWAITING_PAYMENT)

    def test_refused_at_the_door_counts(self):
        order = self.failed_at_the_door("refused")
        self.assertTrue(self.unavailable_now(order))
        row = self.ask(order)
        self.assertEqual((row.status, row.first_rider_id), (Redelivery.AWAITING_PAYMENT, self.swift.staff_id))

    def test_refused_before_reaching_the_address_does_not_count(self):
        order = self.failed_other("refused")                              # no arrived_drop_at: the trip was not completed
        self.assertFalse(self.unavailable_now(order))
        self.refused(order)

    def test_another_reason_at_the_door_does_not_count(self):
        order = self.failed_at_the_door("wrong_address")
        self.assertFalse(self.unavailable_now(order))
        self.refused(order)
        self.assertEqual(self.give(order, self.own).dispatch_id, self.own.staff_id)   # a plain re-assignment, no fee

    def refused(self, order, code="not_redeliverable"):
        with self.assertRaises(RedeliveryError) as raised:
            self.ask(order)
        self.assertEqual((raised.exception.status_code, raised.exception.code), (409, code))


class RedeliverPermissionSeedTests(RedeliveryBase):
    def test_orders_redeliver_is_seeded_to_support_pickup_desk_and_super_admin(self):
        from accounts.models import Role

        holders = sorted(Role.objects.filter(permissions__codename="orders.redeliver").values_list("name", flat=True))
        self.assertEqual(holders, ["pickup_desk", "super_admin", "support"])


@override_settings(LEDGER_ENABLED=False)
class RedeliveryLedgerOffTests(RedeliveryBase):
    def test_nothing_runs_while_the_ledger_is_off(self):
        with override_settings(LEDGER_ENABLED=True):
            order = self.unavailable()
        with self.assertRaises(RedeliveryError) as raised:
            self.ask(order)
        self.assertEqual(raised.exception.code, "ledger_off")
        self.assertFalse(Redelivery.objects.exists())


WEBHOOK_SECRET = "test-webhook-secret"


@override_settings(LEDGER_ENABLED=True)
class RedeliveryEndpointTests(RedeliveryBase):
    """The endpoints, the customer's payment (payments.services: WALLET_KINDS, FINALIZERS) and the gate in services.assign."""

    URL = "/api/delivery/redeliveries/"

    def staff_client(self, staff):
        from rest_framework.test import APIClient

        from accounts.testing import staff_token

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        return client

    def customer_client(self, customer=None):
        from rest_framework.test import APIClient

        from accounts.authentication import issue_token

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer or self.customer, 'customer')}")
        return client

    def pay_url(self, order):
        return f"/api/orders/{order.pk}/redelivery/pay/"

    def assign_refused(self, order, rider_row, code):
        from delivery.services import DeliveryError

        with self.assertRaises(DeliveryError) as raised:
            self.give(order, rider_row)
        self.assertEqual((raised.exception.status_code, raised.exception.code), (409, code))

    def test_request_needs_orders_redeliver(self):
        from accounts.testing import make_staff

        order = self.unavailable()
        response = self.staff_client(self.support).post(self.URL, {"order": order.pk, "reason": "Customer asked"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual((response.json()["status"], response.json()["fee"]), ("awaiting_payment", "15.00"))
        listed = self.staff_client(self.support).get(self.URL, {"order": order.pk})
        self.assertEqual([r["id"] for r in listed.json()["results"]], [response.json()["id"]])
        desk = make_staff("pickup_desk", "desk@example.com", phone="+233244000011")
        other = self.unavailable(self.door_order())
        response = self.staff_client(desk).post(self.URL, {"order": other.pk, "reason": "Customer asked at the desk"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        response = self.staff_client(self.swift.staff).post(self.URL, {"order": other.pk, "reason": "x"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.staff_client(self.swift.staff).get(self.URL, {"order": order.pk}).status_code, 403)
        from activity.models import ActivityEvent

        event = ActivityEvent.objects.filter(verb="delivery.redelivery_requested").first()
        self.assertEqual(event.after["fee_pesewas"], 1500)
        self.assertNotIn(self.customer.phone, str(event.after) + event.summary)

    def test_request_refusal_answers_409_with_its_code(self):
        order = self.failed_other("wrong_address")
        response = self.staff_client(self.support).post(self.URL, {"order": order.pk, "reason": "Customer asked"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_redeliverable"))
        response = self.staff_client(self.support).post(self.URL, {"order": self.unavailable().pk, "reason": ""}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_assign_refused_until_fee_paid(self):
        order = self.unavailable()
        self.assign_refused(order, self.own, "redelivery_fee_unpaid")              # nothing asked for yet
        row = self.ask(order)
        self.assign_refused(order, self.own, "redelivery_fee_unpaid")              # asked for, not paid
        # The Delivery Manager's screen answers the same, and nothing changed.
        client = self.staff_client(self.manager)
        response = client.post(f"/api/orders/{order.pk}/assign-dispatch/", {"dispatch": self.own.staff_id}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "redelivery_fee_unpaid"))
        self.assertEqual(DA.objects.get(order=order).dispatch_id, self.swift.staff_id)
        self.pay(row)
        assignment = self.give(order, self.own)
        row.refresh_from_db()
        self.assertEqual((assignment.dispatch_id, row.status, row.rider_id), (self.own.staff_id, Redelivery.ASSIGNED, self.own.staff_id))

    def test_a_plain_failure_is_reassigned_without_a_fee(self):
        order = self.failed_other("wrong_address")
        self.assertEqual(self.give(order, self.own).dispatch_id, self.own.staff_id)    # case (a): Task 6 rules only

    def test_assign_refused_for_third_party_rider(self):
        from ledger.tests import rider_helpers

        self.on_shift(self.own)            # an AshantiHub rider is available, so no third-party fallback (Director ruling 2)
        order = self.unavailable()
        self.pay(self.ask(order))
        other = rider_helpers.rider("swift2@example.com", name="Kwesi Owusu", phone="+233244000005")
        self.assign_refused(order, other, "redelivery_in_house_only")
        self.assign_refused(order, self.swift, "redelivery_in_house_only")           # the same third-party rider too
        self.give(order, self.own)
        # A swap of the second trip before it is accepted stays in-house as well.
        self.assign_refused(order, other, "redelivery_in_house_only")
        self.give(order, self.own2)
        self.assertEqual(Redelivery.objects.get(order=order).rider_id, self.own2.staff_id)

    def test_a_paid_redelivery_goes_to_a_third_party_rider_only_when_no_in_house_rider_is_available(self):
        """Director ruling 2 (2026-10-20) covers the paid second trip too: in-house first; a third-party rider takes it only
        while no AshantiHub rider is available, and the fallback is logged. The fee is then paid to that rider's wallet
        (ledger.tests.test_redelivery_ledger)."""
        from activity.models import ActivityEvent
        from delivery import dispatching

        order = self.unavailable()
        row = self.ask(order)
        self.pay(row)
        other = self.third()
        self.on_shift(other)
        self.on_shift(self.own)
        self.assertTrue(dispatching.in_house_available(order))
        self.assign_refused(order, other, "redelivery_in_house_only")             # Ama is on shift
        self.assertFalse(dispatching.rank(order)["third_party_fallback"])
        from delivery.models import ShiftSession

        ShiftSession.objects.filter(rider=self.own).update(ended_at=timezone.now())   # Ama goes off shift
        self.assertFalse(dispatching.in_house_available(order))
        self.assertTrue(dispatching.rank(order)["third_party_fallback"])
        with self.captureOnCommitCallbacks(execute=True):
            assignment = self.give(order, other)
        row.refresh_from_db()
        self.assertEqual((assignment.dispatch_id, row.status, row.rider_id), (other.staff_id, Redelivery.ASSIGNED, other.staff_id))
        self.assertTrue(ActivityEvent.objects.filter(verb="delivery.reassigned_third_party", target_id=str(order.pk)).exists())

    def test_a_swap_of_the_second_trip_to_a_third_party_rider_is_a_logged_fallback_too(self):
        from activity.models import ActivityEvent

        order = self.unavailable()
        self.pay(self.ask(order))
        self.give(order, self.own)                                                # the second trip, not yet accepted
        other = self.third()
        with self.captureOnCommitCallbacks(execute=True):
            self.give(order, other)                                               # nobody of AshantiHub's own is on shift
        self.assertEqual(Redelivery.objects.get(order=order).rider_id, other.staff_id)
        self.assertEqual(ActivityEvent.objects.filter(verb="delivery.reassigned_third_party").count(), 1)

    def test_dispatch_engine_and_offers_wait_for_the_fee(self):
        from delivery import dispatching
        from delivery.services import DeliveryError

        order = self.unavailable()
        with self.assertRaises(DeliveryError) as raised:
            dispatching.make_offer(order, self.own, source="manual", by=self.manager)
        self.assertEqual(raised.exception.code, "redelivery_fee_unpaid")
        ranked = dispatching.rank(order)
        self.assertEqual(ranked["eligible"], [])
        self.assertTrue(all(r["reason"] == dispatching.REDELIVERY_UNPAID for r in ranked["left_out"]))

    def test_customer_pays_from_wallet_then_job_can_be_assigned(self):
        order = self.unavailable()
        row = self.ask(order)
        self.top_up(1500)
        response = self.customer_client().post(self.pay_url(order), {"method": "wallet"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["mode"], response.json()["redelivery"]["status"]), ("immediate", "paid"))
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.PAID)
        self.assertEqual(self.wallet(), 0)
        self.assertEqual(row.checkout_session.kind, "redelivery_fee")
        again = self.customer_client().post(self.pay_url(order), {"method": "wallet"}, format="json")
        self.assertEqual((again.status_code, again.json()["code"]), (409, "nothing_to_pay"))
        self.give(order, self.own)
        row.refresh_from_db()
        self.assertEqual((row.status, row.rider_id), (Redelivery.ASSIGNED, self.own.staff_id))

    def test_a_wallet_too_low_is_refused_and_nothing_is_written(self):
        order = self.unavailable()
        row = self.ask(order)
        response = self.customer_client().post(self.pay_url(order), {"method": "wallet"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "insufficient_funds"))
        row.refresh_from_db()
        self.assertEqual((row.status, row.checkout_session), (Redelivery.AWAITING_PAYMENT, None))

    @override_settings(PAYMENTS_PROVIDER="hubtel", HUBTEL_WEBHOOK_SECRET=WEBHOOK_SECRET, HUBTEL_COLLECTION_CHARGE_BP=200)
    def test_customer_pays_by_momo_redirect_then_webhook_finalizes_once(self):
        import hashlib
        import hmac
        import json
        from unittest.mock import patch

        from ledger.models import Journal, JournalLine
        from payments.models import CheckoutSession

        order = self.unavailable()
        row = self.ask(order)
        fake = {"checkout_url": "https://checkout.hubtel.com/fake", "checkout_id": "hb-9"}
        with patch("payments.services.hubtel_client.create_checkout", return_value=fake):
            response = self.customer_client().post(self.pay_url(order), {"method": "momo"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["mode"], body["checkout_url"], body["payment_processing"]), ("redirect", fake["checkout_url"], "0.30"))
        row.refresh_from_db()
        self.assertEqual(row.status, Redelivery.AWAITING_PAYMENT)
        session = CheckoutSession.objects.get(reference=body["reference"])
        self.assertEqual((str(session.amount), session.metadata["redelivery_id"]), ("15.30", row.pk))

        def webhook():
            raw = json.dumps({"ClientReference": session.reference, "Status": "Success", "Amount": 15.30}).encode()
            signature = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
            return self.client.generic("POST", "/api/payments/webhook/hubtel/", data=raw, content_type="application/json",
                                       HTTP_X_HUBTEL_SIGNATURE=signature)

        self.assertEqual(webhook().status_code, 200)
        self.assertEqual(webhook().status_code, 200)                 # told twice: finalised once
        row.refresh_from_db()
        self.assertEqual((row.status, row.checkout_session_id), (Redelivery.PAID, session.pk))
        self.assertEqual(Journal.objects.filter(key__startswith="redelivery-").count(), 1)
        clearing = JournalLine.objects.get(journal=row.pay_journal, account__kind="provider_clearing")
        self.assertEqual(clearing.amount, 1500)                      # the processing charge stays with the provider

    def test_customer_cannot_pay_another_customers_request(self):
        from accounts.models import Customer
        from payments.models import CheckoutSession

        order = self.unavailable()
        self.ask(order)
        stranger = Customer.objects.create(full_name="Kwabena", phone="+233200990077", password_hash="x")
        response = self.customer_client(stranger).post(self.pay_url(order), {"method": "momo"}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertFalse(CheckoutSession.objects.filter(kind="redelivery_fee").exists())
        staff = self.staff_client(self.support).post(self.pay_url(order), {"method": "momo"}, format="json")
        self.assertEqual(staff.status_code, 403)

    def test_cancel_endpoint_before_payment(self):
        row = self.ask(self.unavailable())
        response = self.staff_client(self.support).post(f"{self.URL}{row.pk}/cancel/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "cancelled")
        self.assertEqual(self.staff_client(self.swift.staff).post(f"{self.URL}{row.pk}/cancel/").status_code, 403)

    def test_order_screens_show_the_request(self):
        order = self.unavailable()
        detail = self.staff_client(self.support).get(f"/api/orders/support/{order.pk}/").json()
        self.assertEqual((detail["redeliverable"], detail["redelivery_fee"]), (True, "15.00"))
        self.ask(order)
        detail = self.staff_client(self.support).get(f"/api/orders/support/{order.pk}/").json()
        self.assertEqual(detail["redeliverable"], False)                 # one open request per order
        mine = self.customer_client().get(f"/api/orders/{order.pk}/").json()
        self.assertEqual((mine["redelivery"]["status"], mine["redelivery"]["fee"]), ("awaiting_payment", "15.00"))
        self.assertNotIn("reason", mine["redelivery"])

    def test_list_says_whether_the_order_can_be_redelivered_and_the_fee(self):
        order = self.unavailable()
        body = self.staff_client(self.support).get(self.URL, {"order": order.pk}).json()
        self.assertEqual(body, {"results": [], "redeliverable": True, "redelivery_fee": "15.00", "not_redeliverable_reason": None})
        row = self.ask(order)
        body = self.staff_client(self.support).get(self.URL, {"order": order.pk}).json()
        self.assertEqual([r["id"] for r in body["results"]], [row.pk])
        self.assertEqual((body["redeliverable"], body["redelivery_fee"]), (False, None))

    def test_list_names_why_not_for_a_delivered_order_and_an_open_request(self):
        delivered = self.door_order()
        self.give(delivered, self.own)
        self.collect_all(delivered, self.own)
        self.deliver(delivered, self.own)
        body = self.staff_client(self.support).get(self.URL, {"order": delivered.pk}).json()
        self.assertEqual((body["results"], body["redeliverable"], body["redelivery_fee"]), ([], False, None))
        self.assertEqual(body["not_redeliverable_reason"], redelivery.NOT_REDELIVERABLE)
        open_order = self.unavailable()
        self.ask(open_order)
        body = self.staff_client(self.support).get(self.URL, {"order": open_order.pk}).json()
        self.assertEqual(body["not_redeliverable_reason"], "A re-delivery is already open for this order.")

    def test_list_for_an_unknown_order_is_404(self):
        response = self.staff_client(self.support).get(self.URL, {"order": 999999})
        self.assertEqual((response.status_code, response.json()), (404, {"detail": "No order with that number."}))

    def test_pickup_desk_reads_the_list(self):
        from accounts.testing import make_staff

        desk = make_staff("pickup_desk", "desk2@example.com", phone="+233244000012")
        order = self.unavailable()
        response = self.staff_client(desk).get(self.URL, {"order": order.pk})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["redeliverable"])
        self.assertNotIn(self.customer.phone, response.content.decode())

    def test_redeliverable_unchanged_for_the_support_detail(self):
        order = self.unavailable()
        self.assertTrue(redelivery.redeliverable(order))
        self.assertIsNone(redelivery.why_not(order))
        self.ask(order)
        self.assertFalse(redelivery.redeliverable(order))
        self.assertEqual(redelivery.why_not(order), redelivery.OPEN_REASON)
        detail = self.staff_client(self.support).get(f"/api/orders/support/{order.pk}/").json()
        self.assertEqual(detail["redeliverable"], False)
        self.assertNotIn("redelivery_fee", detail)

    def test_a_refusal_at_the_door_after_arrival_can_be_redelivered(self):
        order = self.failed_at_the_door("refused")
        self.assertIsNotNone(DA.objects.get(order=order).arrived_drop_at)
        body = self.staff_client(self.support).get(self.URL, {"order": order.pk}).json()
        self.assertEqual((body["redeliverable"], body["not_redeliverable_reason"]), (True, None))


@override_settings(LEDGER_ENABLED=False)
class RedeliveryEndpointsLedgerOffTests(RedeliveryBase):
    def test_endpoints_answer_ledger_off_and_assign_is_unchanged(self):
        from rest_framework.test import APIClient

        from accounts.authentication import issue_token
        from accounts.testing import staff_token

        with override_settings(LEDGER_ENABLED=True):
            order = self.unavailable()
        staff = APIClient()
        staff.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.support)}")
        response = staff.post("/api/delivery/redeliveries/", {"order": order.pk, "reason": "x"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertEqual(staff.get("/api/delivery/redeliveries/", {"order": order.pk}).json(), {
            "results": [], "redeliverable": False, "redelivery_fee": None,
            "not_redeliverable_reason": "Re-delivery fees aren't switched on yet.",
        })
        customer = APIClient()
        customer.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.assertEqual(customer.post(f"/api/orders/{order.pk}/redelivery/pay/", {"method": "momo"}, format="json").status_code, 409)
        detail = staff.get(f"/api/orders/support/{order.pk}/").json()
        self.assertFalse(detail["redeliverable"])
        # The failed delivery is re-assigned exactly as before the re-delivery fee existed.
        self.assertEqual(self.give(order, self.own).dispatch_id, self.own.staff_id)


@override_settings(LEDGER_ENABLED=True)
class RedeliveryFixRoundTests(RedeliveryBase):
    """Review fix round 1 (Plan 7F-E Task 7)."""

    def test_an_order_paid_before_the_ledger_was_on_is_reassigned_without_a_redelivery(self):
        from orders.models import Order

        order = self.order([(self.listing(self.kofi, "100.00"), 1)], delivery="15.00")     # no order-pay journal
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        self.unavailable(order)
        with self.assertRaises(RedeliveryError):
            self.ask(order)                                                     # it cannot carry a re-delivery fee
        from delivery import dispatching

        self.assertIsNone(dispatching.redelivery_hold(order))
        self.assertEqual(self.give(order, self.own).dispatch_id, self.own.staff_id)
        self.assertFalse(Redelivery.objects.filter(order=order).exists())

    def test_a_free_assigned_request_whose_rider_collected_completes_on_a_whole_refund(self):
        from ledger import refunds

        MoneySetting.objects.create(key="redelivery_fee_pesewas", value=0, effective_from=timezone.now() - timedelta(minutes=1))
        order = self.unavailable()
        row = self.ask(order)
        self.second_trip(order, self.own)
        self.collect_all(order, self.own)
        refunds.refund_order(order, source="cancel")
        row.refresh_from_db()
        self.assertEqual((row.status, row.rider_id, row.settle_journal), (Redelivery.COMPLETED, self.own.staff_id, None))

    def test_the_paid_event_is_written_after_commit_without_the_reason_in_its_summary(self):
        from activity.models import ActivityEvent

        order = self.unavailable()
        row = self.ask(order, reason="Customer home after 5pm")
        with self.captureOnCommitCallbacks(execute=True):
            self.pay(row)
        event = ActivityEvent.objects.get(verb="delivery.redelivery_paid")
        self.assertEqual((event.target_type, event.target_id, event.after["fee_pesewas"]), ("delivery.redelivery", str(row.pk), 1500))
        self.assertNotIn("5pm", event.summary)
        self.assertNotIn(self.customer.phone, event.summary + str(event.after))

    def test_fee_rider_names_the_first_rider_after_the_second_trip_is_assigned(self):
        from ledger import riders

        order = self.unavailable()
        self.pay(self.ask(order))
        self.second_trip(order, self.own)
        self.assertEqual(riders.fee_rider(order).pk, self.swift.staff_id)
        self.assertEqual(riders.fee_rider(order, at_settle=True).pk, self.swift.staff_id)


@override_settings(LEDGER_ENABLED=True)
class QueueRowAssignLimitTests(RedeliveryBase):
    """Plan 5F Task 10: the queue row says when AshantiHub's riders come first or a re-delivery waits for its fee."""

    def row(self, order):
        from delivery import config
        from delivery.views_queue import _queue_row

        return _queue_row(order, timezone.now(), config.effective_rules(), config.effective_limits())

    def test_queue_row_waits_for_the_redelivery_fee(self):
        from delivery import dispatching

        order = self.unavailable()
        limit = self.row(order)["assign_limit"]
        self.assertEqual(limit, {"code": "redelivery_fee_unpaid", "label": dispatching.REDELIVERY_UNPAID})
        self.ask(order)
        self.assertEqual(self.row(order)["assign_limit"]["code"], "redelivery_fee_unpaid")

    def test_queue_row_after_payment_is_in_house_first(self):
        from delivery import dispatching

        order = self.unavailable()
        self.pay(self.ask(order))
        limit = self.row(order)["assign_limit"]
        self.assertEqual(limit, {"code": "redelivery_in_house_first", "label": "Re-delivery: AshantiHub's own riders first"})
        self.assertEqual(limit["label"], dispatching.REDELIVERY_IN_HOUSE_FIRST)

    def test_returned_job_is_in_house_first(self):
        order = self.failed_other("wrong_address")
        limit = self.row(order)["assign_limit"]
        self.assertEqual(limit, {"code": "in_house_first", "label": "Re-assigned: AshantiHub's own riders first"})

    def test_fresh_order_has_no_limit(self):
        order = self.door_order()
        self.assertIsNone(self.row(order)["assign_limit"])
