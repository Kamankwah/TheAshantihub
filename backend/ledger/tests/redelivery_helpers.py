"""Fixtures for the re-delivery tests (Plan 7F-E Task 7) in ledger and delivery: a paid door-to-door ledger order whose
first rider reached the address and found the customer unavailable (not test cases themselves)."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.testing import make_staff
from delivery import redelivery, services
from delivery.models import DeliveryCall, PickupStop
from ledger import posting
from ledger.models import Account, Journal, JournalLine
from orders import locks
from orders.models import DeliveryAssignment, Order
from payments.models import CheckoutSession

from . import rider_helpers
from .test_refunds import RefundBase

DA = DeliveryAssignment
HERE = (6.70, -1.62)


class RedeliveryBase(RefundBase):
    """Kofi's shop sells one 100.00 item; the delivery fee is 15.00. Swift is a third-party rider, Ama and Yaw are
    AshantiHub's own riders; Esi is Support, Kwame the Delivery Manager."""

    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.swift = rider_helpers.rider()
        self.own = rider_helpers.rider("own@example.com", name="Ama Boateng", phone="+233244000003", third_party=False)
        self.own2 = rider_helpers.rider("own2@example.com", name="Yaw Darko", phone="+233244000004", third_party=False)
        self.support = make_staff("support", "esi@example.com", phone="+233244000010")
        self.manager = make_staff("delivery_manager", "dm@example.com", phone="+233244000009")

    # --- the order and its first trip ------------------------------------------------------------------------------------
    def door_order(self, delivery="15.00"):
        order = self.paid([(self.listing(self.kofi, "100.00"), 1)], delivery=delivery)
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        return order

    def give(self, order, rider_row):
        locked = locks.lock_order(order.pk)
        return services.assign(locked, rider_row.staff, self.manager, mode=DA.MANUAL)

    def job(self, order):
        return locks.lock_job(DA.objects.get(order=order).pk)

    def collect_all(self, order, rider_row):
        assignment = self.job(order)
        services.accept(assignment, rider_row.staff)
        while True:
            assignment = self.job(order)
            stop = next((s for s in assignment.stops.order_by("sequence") if s.status in PickupStop.OPEN), None)
            if stop is None:
                return assignment
            services.arrive_pickup(assignment, rider_row.staff, *HERE, 10)
            services.pickup(self.job(order), rider_row.staff, stop.code, *HERE, 10)

    def reach_customer(self, order, rider_row):
        services.arrive_drop(self.job(order), rider_row.staff, *HERE, 10)
        # The rider waited the 10 minutes and called twice (services.cant_deliver checks both).
        DA.objects.filter(order=order).update(arrived_drop_at=timezone.now() - timedelta(minutes=11))
        assignment = self.job(order)
        services.log_call(assignment, rider_row.staff, DeliveryCall.RIDER_TO_CUSTOMER)
        services.log_call(assignment, rider_row.staff, DeliveryCall.RIDER_TO_CUSTOMER)

    def unavailable(self, order=None, rider_row=None):
        """The first rider collected the order, reached the address and could not reach the customer."""
        order = order or self.door_order()
        rider_row = rider_row or self.swift
        self.give(order, rider_row)
        self.collect_all(order, rider_row)
        self.reach_customer(order, rider_row)
        services.cant_deliver(self.job(order), rider_row.staff, "no_answer", "", *HERE, 10)
        return order

    def failed_other(self, reason="wrong_address"):
        """The first rider collected the order and failed for `reason` before reaching the address (no arrived_drop_at)."""
        order = self.door_order()
        self.give(order, self.swift)
        self.collect_all(order, self.swift)
        services.cant_deliver(self.job(order), self.swift.staff, reason, "No such house", *HERE, 10)
        return order

    def failed_at_the_door(self, reason):
        """The first rider collected the order, reached the address (waited and called) and failed there for `reason`."""
        order = self.door_order()
        self.give(order, self.swift)
        self.collect_all(order, self.swift)
        self.reach_customer(order, self.swift)
        services.cant_deliver(self.job(order), self.swift.staff, reason, "At the gate", *HERE, 10)
        return order

    # --- the re-delivery -----------------------------------------------------------------------------------------------
    def ask(self, order, reason="The customer called: please bring it again tomorrow"):
        return redelivery.request(order, self.support, reason)

    def top_up(self, pesewas):
        posting.post(
            key=f"test-topup-{Journal.objects.count()}", kind="wallet_top_up",
            lines=[posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas),
                   posting.credit(posting.account_for(Account.CUSTOMER_WALLET, self.customer), pesewas)],
        )

    def pay(self, row, *, wallet=True):
        """The customer pays the fee (a confirmed session, then the payment finalizer's rules)."""
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.REDELIVERY_FEE, amount=Decimal(row.fee_pesewas) / 100,
            provider=CheckoutSession.WALLET if wallet else "simulated", status=CheckoutSession.SUCCESS,
            purpose=f"Re-delivery of order #{row.order_id}", metadata={"redelivery_id": row.pk, "ledger": True},
        )
        if wallet:
            self.top_up(row.fee_pesewas)
        redelivery.record_payment(session)
        row.refresh_from_db()
        return session

    def second_trip(self, order, rider_row=None):
        """The Delivery Manager gives the paid re-delivery to an AshantiHub rider."""
        rider_row = rider_row or self.own
        assignment = self.give(order, rider_row)
        redelivery.link_rider(redelivery.open_row(order), rider_row.staff, self.manager)
        return assignment

    def deliver(self, order, rider_row):
        assignment = self.job(order)
        services.arrive_drop(assignment, rider_row.staff, *HERE, 10)
        assignment = self.job(order)
        services.deliver(assignment, rider_row.staff, assignment.drop_code, *HERE, 10)

    def assert_balanced(self):
        for journal in Journal.objects.all():
            lines = JournalLine.objects.filter(journal=journal)
            debit = sum(l.amount for l in lines if l.side == JournalLine.DEBIT)
            credit = sum(l.amount for l in lines if l.side == JournalLine.CREDIT)
            self.assertEqual(debit, credit, journal.key)
