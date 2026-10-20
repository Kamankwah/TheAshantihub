"""Re-assignment ends the previous leg (Plan 7F-E Task 6, owner Ruling R3): when a delivery the first rider picked up but
never delivered is given to another rider, the first rider is paid nothing and the whole delivery fee goes to the rider who
completes it. A re-assigned delivery is done by an AshantiHub (in-house) rider only.

7F-D's rule ("the fee belongs to the rider once any pickup is done") is read on the CURRENT leg: a pickup counts only when the
rider on the assignment now made it (PickupStop.collected_by / DeliveryAssignment.picked_up_by is assignment.dispatch_id, or
is null on a row written before the stamp existed). The first rider's pickup stays in the append-only DeliveryEvent rows as
history and counts for no one."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from delivery import dispatching, services
from delivery.models import DeliveryEvent, PickupStop, Rider, RiderDocument, RiderEarning, ShiftSession
from delivery.services import REQUIRED_DOCUMENTS, DeliveryError
from disputes.models import Dispute
from ledger import posting, refunds, riders
from ledger.models import Account, Journal, JournalLine
from orders import locks
from orders.models import DeliveryAssignment, Order

from . import rider_helpers
from .test_refunds import RefundBase

DA = DeliveryAssignment
HERE = (6.70, -1.62)


@override_settings(LEDGER_ENABLED=True)
class RiderReassignmentTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.swift = rider_helpers.rider()                                    # third-party: Swift Riders Ltd
        self.own = rider_helpers.rider("own@example.com", name="Ama Boateng", phone="+233244000003", third_party=False)
        from accounts.testing import make_staff

        self.manager = make_staff("delivery_manager", "dm@example.com", phone="+233244000009")

    # --- fixtures ---------------------------------------------------------------------------------------------------------
    def door_order(self, *owners, delivery="15.00"):
        owners = owners or (self.kofi,)
        price = "100.00" if len(owners) == 1 else "50.00"
        order = self.paid([(self.listing(o, price), 1) for o in owners], delivery=delivery)
        order.delivery_method = Order.DOOR_TO_DOOR
        order.save(update_fields=["delivery_method"])
        return order

    def give(self, order, rider_row):
        """What every assigning path does: lock the order row, then services.assign (orders/locks.py)."""
        locked = locks.lock_order(order.pk)
        return services.assign(locked, rider_row.staff, self.manager, mode=DA.MANUAL)

    def job(self, order):
        return locks.lock_job(DA.objects.get(order=order).pk)

    def collect_all(self, order, rider_row):
        """The rider accepts and collects every stop with its own code (the rider app's steps)."""
        assignment = self.job(order)
        services.accept(assignment, rider_row.staff)
        while True:
            assignment = self.job(order)
            stop = next((s for s in assignment.stops.order_by("sequence") if s.status in PickupStop.OPEN), None)
            if stop is None:
                return assignment
            services.arrive_pickup(assignment, rider_row.staff, *HERE, 10)
            services.pickup(self.job(order), rider_row.staff, stop.code, *HERE, 10)

    def fail_delivery(self, order, rider_row):
        services.cant_deliver(self.job(order), rider_row.staff, "wrong_address", "Gate locked, no such house", *HERE, 10)

    def deliver(self, order, rider_row):
        assignment = self.job(order)
        services.arrive_drop(assignment, rider_row.staff, *HERE, 10)
        assignment = self.job(order)
        services.deliver(assignment, rider_row.staff, assignment.drop_code, *HERE, 10)

    def picked_then_failed(self, order=None):
        """Swift (third-party) picked the order up and could not deliver it."""
        order = order or self.door_order()
        self.give(order, self.swift)
        self.collect_all(order, self.swift)
        self.fail_delivery(order, self.swift)
        return order

    def rider_balances(self, row):
        return posting.balance_of(Account.RIDER_BALANCE, row.staff), posting.balance_of(Account.RIDER_RESERVE, row.staff)

    def assert_balanced(self):
        for journal in Journal.objects.all():
            lines = JournalLine.objects.filter(journal=journal)
            debit = sum(l.amount for l in lines if l.side == JournalLine.DEBIT)
            credit = sum(l.amount for l in lines if l.side == JournalLine.CREDIT)
            self.assertEqual(debit, credit, journal.key)

    # --- the reset ----------------------------------------------------------------------------------------------------
    def test_reassign_failed_delivery_resets_first_riders_pickup(self):
        order = self.picked_then_failed()
        before = DA.objects.get(order=order)
        self.assertEqual((before.picked_up_by_id, before.stops.get().collected_by_id), (self.swift.staff_id, self.swift.staff_id))
        self.assertIsNotNone(riders.pickup_made(order))
        again = self.give(order, self.own)
        again.refresh_from_db()
        self.assertEqual((again.status, again.dispatch_id, again.picked_up_at, again.picked_up_by_id),
                         (DA.ASSIGNED, self.own.staff_id, None, None))
        stop = again.stops.get()
        self.assertEqual((stop.status, stop.collected_at, stop.collected_by_id), (PickupStop.PENDING, None, None))
        self.assertIsNone(riders.pickup_made(order))
        # The first rider's pickup is history, never deleted.
        self.assertTrue(DeliveryEvent.objects.filter(assignment=again, step=DeliveryEvent.PICKED_UP, by=self.swift.staff).exists())

    # --- the money ----------------------------------------------------------------------------------------------------
    def test_first_rider_gets_nothing_when_reassigned_before_completion(self):
        order = self.picked_then_failed()
        self.give(order, self.own)
        self.collect_all(order, self.own)
        self.deliver(order, self.own)
        Dispute.objects.filter(order=order).update(status=Dispute.RESOLVED)    # the failed attempt's case is closed
        self.release(order)
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.rider_balances(self.swift), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1500)   # in-house: the fee stays platform delivery income
        self.assert_balanced()

    def test_refund_after_reassignment_before_new_pickup_returns_fee(self):
        order = self.picked_then_failed()
        self.give(order, self.own)
        refund = refunds.refund_order(Order.objects.get(pk=order.pk), source="dispute-1")
        self.assertEqual(self.wallet(), 11500)
        self.assertEqual((refund.delivery_pesewas, refund.delivery_kept_pesewas), (1500, 0))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.rider_balances(self.swift), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assert_balanced()

    def test_refund_after_new_riders_pickup_keeps_fee_for_new_rider(self):
        order = self.picked_then_failed()
        self.give(order, self.own)
        self.collect_all(order, self.own)
        self.assertIsNotNone(riders.pickup_made(order))
        refund = refunds.refund_order(Order.objects.get(pk=order.pk), source="dispute-1")
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual((refund.delivery_pesewas, refund.delivery_kept_pesewas), (0, 1500))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.rider_balances(self.swift), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1500)   # the new rider is in-house
        self.assert_balanced()

    def test_new_rider_not_tested_against_first_riders_pickup_time(self):
        """Built with fixtures (assign refuses a third-party second rider): the first rider collected Kofi's stop three days
        ago, the second rider, third-party only since yesterday, collected Esi's stop now. The settle test reads the second
        rider's own pickup, so the second rider is paid and the first nothing."""
        esi = self.owner("Esi")
        order = self.door_order(self.kofi, esi)
        late = rider_helpers.rider("late@example.com", name="Yaw Asare", phone="+233244000004",
                                   since=timezone.now() - timedelta(days=1))
        assignment = DA.objects.create(order=order, dispatch=late.staff, status=DA.ACCEPTED)
        PickupStop.objects.create(assignment=assignment, sequence=1, business_owner=self.kofi, status=PickupStop.COLLECTED,
                                  collected_at=timezone.now() - timedelta(days=3), collected_by=self.swift.staff)
        PickupStop.objects.create(assignment=assignment, sequence=2, business_owner=esi, status=PickupStop.COLLECTED,
                                  collected_at=timezone.now(), collected_by=late.staff)
        self.assertGreater(riders.pickup_made(order), timezone.now() - timedelta(minutes=1))
        refunds.refund_order(Order.objects.get(pk=order.pk), source="dispute-1")
        self.assertEqual(self.wallet(), 10000)
        self.assertEqual(self.rider_balances(late), (1350, 150))
        self.assertEqual(self.rider_balances(self.swift), (0, 0))
        self.assert_balanced()

    def test_first_riders_assignment_pickup_stamp_does_not_count_for_the_next_rider(self):
        order = self.door_order()
        DA.objects.create(order=order, dispatch=self.own.staff, status=DA.ACCEPTED,
                          picked_up_at=timezone.now(), picked_up_by=self.swift.staff)
        self.assertIsNone(riders.pickup_made(order))
        DA.objects.filter(order=order).update(picked_up_by=None)                 # a row from before the stamp counts
        self.assertIsNotNone(riders.pickup_made(order))

    # --- who may take a re-assigned delivery --------------------------------------------------------------------------
    def test_reassignment_to_third_party_rider_refused(self):
        order = self.door_order()
        self.give(order, self.own)
        services.accept(self.job(order), self.own.staff)
        with self.assertRaises(DeliveryError) as caught:
            self.give(order, self.swift)
        self.assertEqual((caught.exception.status_code, caught.exception.code), (409, "redelivery_in_house_only"))
        self.assertEqual(caught.exception.message, "A re-assigned delivery is done by AshantiHub's own riders.")
        row = DA.objects.get(order=order)
        self.assertEqual((row.dispatch_id, row.status), (self.own.staff_id, DA.ACCEPTED))
        failed = self.picked_then_failed(self.door_order())                      # a failed one too
        with self.assertRaises(DeliveryError) as caught:
            self.give(failed, rider_helpers.rider("other3p@example.com", name="Kwesi Owusu", phone="+233244000005"))
        self.assertEqual(caught.exception.code, "redelivery_in_house_only")

    def test_reassignment_through_the_manager_screen_answers_409(self):
        from accounts.testing import staff_token
        from rest_framework.test import APIClient

        order = self.door_order()
        self.give(order, self.own)
        services.accept(self.job(order), self.own.staff)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.manager)}")
        response = client.post(f"/api/orders/{order.pk}/assign-dispatch/", {"dispatch": self.swift.staff_id}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "redelivery_in_house_only"))
        self.assertEqual(DA.objects.get(order=order).dispatch_id, self.own.staff_id)

    def test_swap_of_unaccepted_job_to_third_party_rider_still_allowed(self):
        order = self.door_order()
        self.give(order, self.own)
        again = self.give(order, self.swift)
        self.assertEqual((again.dispatch_id, again.status), (self.swift.staff_id, DA.ASSIGNED))

    def test_multi_stop_collected_by_cleared_on_reopen(self):
        esi = self.owner("Esi")
        order = self.picked_then_failed(self.door_order(self.kofi, esi))
        self.assertEqual({s.collected_by_id for s in PickupStop.objects.filter(assignment__order=order)}, {self.swift.staff_id})
        again = self.give(order, self.own)
        rows = list(again.stops.order_by("sequence"))
        self.assertEqual([(s.status, s.collected_at, s.collected_by_id) for s in rows],
                         [(PickupStop.PENDING, None, None), (PickupStop.PENDING, None, None)])

    def test_swap_mid_route_keeps_first_riders_stop_but_it_counts_for_no_one(self):
        esi = self.owner("Esi")
        order = self.door_order(self.kofi, esi)
        self.give(order, self.own)
        assignment = self.job(order)
        services.accept(assignment, self.own.staff)
        first = assignment.stops.order_by("sequence").first()
        services.arrive_pickup(self.job(order), self.own.staff, *HERE, 10)
        services.pickup(self.job(order), self.own.staff, first.code, *HERE, 10)
        self.assertIsNotNone(riders.pickup_made(order))
        other = rider_helpers.rider("own2@example.com", name="Efua Mensah", phone="+233244000006", third_party=False)
        self.give(order, other)
        first.refresh_from_db()
        self.assertEqual((first.status, first.collected_by_id), (PickupStop.COLLECTED, self.own.staff_id))
        self.assertIsNone(riders.pickup_made(order))

    # --- dispatching --------------------------------------------------------------------------------------------------
    def on_shift(self, row):
        for kind in REQUIRED_DOCUMENTS:
            RiderDocument.objects.create(rider=row, kind=kind, file=f"documents/{kind}.png", status=RiderDocument.APPROVED,
                                         expires_on=timezone.localdate() + timedelta(days=200))
        ShiftSession.objects.create(rider=row, last_lat=HERE[0], last_lng=HERE[1], last_fix_at=timezone.now())

    def test_dispatch_offers_only_in_house_riders_for_a_reassignment(self):
        self.on_shift(self.own)
        self.on_shift(self.swift)
        fresh = self.door_order()
        fresh_rank = dispatching.rank(Order.objects.get(pk=fresh.pk))
        # A never-assigned order has no saved stop with a pin, so nobody is eligible on location; build the failed one with a pin.
        order = self.door_order()
        first = rider_helpers.rider("first@example.com", name="Kojo Badu", phone="+233244000007", third_party=False)
        assignment = DA.objects.create(order=order, dispatch=first.staff, status=DA.FAILED, failed_at=timezone.now(),
                                       failed_reason="wrong_address", pickup_code="1234", drop_code="5678")
        PickupStop.objects.create(assignment=assignment, sequence=1, business_owner=self.kofi, lat=HERE[0], lng=HERE[1], code="1234")
        ranked = dispatching.rank(Order.objects.select_related("delivery_assignment").get(pk=order.pk))
        self.assertEqual([r["rider_id"] for r in ranked["eligible"]], [self.own.pk])
        left = {r["rider_id"]: r["reason"] for r in ranked["left_out"]}
        self.assertEqual(left[self.swift.pk], "Re-assigned: AshantiHub's own riders only")
        self.assertNotIn("Re-assigned: AshantiHub's own riders only", {r["reason"] for r in fresh_rank["left_out"]})
