from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from accounts.testing import make_staff, staff_token
from ledger import escrow
from ledger.models import Account, FulfilmentCheck
from orders.models import DeliveryAssignment, Order

from .test_order_payment import OrderPaymentBase


class PickupBase(OrderPaymentBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()
        self.desk = make_staff("pickup_desk", "yaa@example.com")
        self.support = make_staff("support", "esi@example.com")
        self.accountant = make_staff("accountant", "kofi@example.com")

    def as_staff(self, staff, sudo=True):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def code(self, order):
        return FulfilmentCheck.objects.get(order=order).collection_code

    def pickup_order(self, *, in_ledger=True):
        self.kofi = self.owner("Kofi")
        order = self.order([(self.listing(self.kofi, "120.00"), 1)])
        order.delivery_method = Order.STORE_PICKUP
        order.save(update_fields=["delivery_method"])
        if in_ledger:
            escrow.record_order_payment(order)
        return order


class RoleTests(PickupBase):
    def test_the_role_exists_with_its_permission_and_super_admin_holds_it_too(self):
        role = Role.objects.get(name="pickup_desk")
        # Plan 7F-E Task 7 added orders.redeliver: the desk may ask for a re-delivery at the customer's request.
        self.assertEqual(sorted(role.permissions.values_list("codename", flat=True)), ["orders.redeliver", "pickup.confirm"])
        self.assertTrue(Role.objects.get(name="super_admin").permissions.filter(codename="pickup.confirm").exists())


@override_settings(LEDGER_ENABLED=True)
class CollectionTests(PickupBase):
    def collect(self, order, code=None):
        return self.client.post(f"/api/ledger/pickup/{order.pk}/collected/", {"code": code or self.code(order)}, format="json")

    def test_the_desk_marks_a_store_pickup_order_collected_and_a_second_try_is_refused(self):
        order = self.pickup_order()
        self.as_staff(self.desk)
        first = self.collect(order)
        self.assertEqual(first.status_code, 200, first.content)
        check = FulfilmentCheck.objects.get(order=order)
        self.assertEqual(check.collected_by_id, self.desk.pk)
        stamped = check.collected_at
        self.assertEqual(self.collect(order).status_code, 409)       # a collected order's code works no more
        self.assertEqual(FulfilmentCheck.objects.get(order=order).collected_at, stamped)

    def test_collecting_marks_the_order_delivered_so_support_can_no_longer_cancel_it(self):
        from orders.support import allowed_actions

        order = self.pickup_order()
        self.assertEqual(Order.objects.get(pk=order.pk).delivery_status, Order.PROCESSING)
        self.as_staff(self.desk)
        self.assertEqual(self.collect(order).status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.delivery_status, Order.DELIVERED)
        self.assertEqual(allowed_actions(order), [])
        self.as_staff(self.support)
        response = self.client.post(
            f"/api/orders/{order.pk}/support-status/", {"status": "cancelled_by_customer", "reason": "changed mind"}, format="json",
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(Order.objects.get(pk=order.pk).status, Order.PAID)

    def test_a_second_collect_changes_nothing(self):
        from ledger import verification

        order = self.pickup_order()
        verification.mark_collected(order, self.desk, code=self.code(order))
        Order.objects.filter(pk=order.pk).update(delivery_status=Order.PROCESSING)  # would be restored only by a re-save
        with self.assertRaises(verification.VerificationError):
            verification.mark_collected(order, self.desk, code=self.code(order))
        self.assertEqual(Order.objects.get(pk=order.pk).delivery_status, Order.PROCESSING)

    def test_a_door_to_door_order_is_left_untouched_by_a_refused_collect(self):
        order = self.pickup_order()
        Order.objects.filter(pk=order.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        self.as_staff(self.desk)
        self.assertEqual(self.collect(order).status_code, 409)
        self.assertEqual(Order.objects.get(pk=order.pk).delivery_status, Order.PROCESSING)

    def test_a_door_to_door_or_unpaid_order_cannot_be_collected(self):
        order = self.pickup_order()
        Order.objects.filter(pk=order.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        self.as_staff(self.desk)
        self.assertEqual(self.collect(order).status_code, 409)
        Order.objects.filter(pk=order.pk).update(delivery_method=Order.STORE_PICKUP, status=Order.PENDING)
        self.assertEqual(self.collect(order).status_code, 409)

    def test_a_collected_order_can_then_be_verified_and_released(self):
        order = self.pickup_order()
        self.as_staff(self.desk)
        self.collect(order)
        self.as_staff(self.support)
        response = self.client.post(f"/api/ledger/orders/{order.pk}/verification/", {"outcome": "matches"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 11500)

    def test_an_uncollected_pickup_order_cannot_be_verified(self):
        order = self.pickup_order()
        self.as_staff(self.support)
        response = self.client.post(f"/api/ledger/orders/{order.pk}/verification/", {"outcome": "matches"}, format="json")
        self.assertEqual(response.status_code, 409)

    def test_only_the_desk_and_super_admin_may_collect(self):
        order = self.pickup_order()
        for staff in (self.support, self.accountant):
            self.as_staff(staff)
            self.assertEqual(self.collect(order).status_code, 403)


@override_settings(LEDGER_ENABLED=True)
class QueueTests(PickupBase):
    def test_lists_uncollected_pickup_orders_with_the_collect_by_time_and_overdue_flag(self):
        fresh = self.pickup_order()
        late = self.pickup_order()
        Order.objects.filter(pk=late.pk).update(placed_at=timezone.now() - timedelta(hours=25))
        self.as_staff(self.desk)
        rows = {r["order_id"]: r for r in self.client.get("/api/ledger/pickup/").json()["results"]}
        self.assertFalse(rows[fresh.pk]["overdue"])
        self.assertTrue(rows[late.pk]["overdue"])
        self.assertEqual(rows[fresh.pk]["customer_name"], "Ama")

    def test_collected_and_door_to_door_orders_are_not_listed(self):
        collected = self.pickup_order()
        self.as_staff(self.desk)
        self.client.post(f"/api/ledger/pickup/{collected.pk}/collected/", {"code": self.code(collected)}, format="json")
        delivery = self.pickup_order()
        Order.objects.filter(pk=delivery.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        ids = [r["order_id"] for r in self.client.get("/api/ledger/pickup/").json()["results"]]
        self.assertNotIn(collected.pk, ids)
        self.assertNotIn(delivery.pk, ids)

    def test_the_desk_does_not_see_the_customers_phone_number(self):
        self.pickup_order()
        self.as_staff(self.desk)
        self.assertNotIn("customer_phone", self.client.get("/api/ledger/pickup/").json()["results"][0])

    def test_only_orders_paid_through_the_ledger_are_listed(self):
        recorded = self.pickup_order()
        self.pickup_order(in_ledger=False)
        self.as_staff(self.desk)
        ids = [r["order_id"] for r in self.client.get("/api/ledger/pickup/").json()["results"]]
        self.assertEqual(ids, [recorded.pk])

    def test_the_queue_is_a_page_of_twenty(self):
        for _ in range(21):
            self.pickup_order()
        self.as_staff(self.desk)
        body = self.client.get("/api/ledger/pickup/").json()
        self.assertEqual((body["count"], len(body["results"])), (21, 20))
        self.assertTrue(body["next"])

    def test_ledger_off_answers_ledger_off(self):
        self.pickup_order()
        self.as_staff(self.desk)
        with override_settings(LEDGER_ENABLED=False):
            response = self.client.get("/api/ledger/pickup/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "The ledger isn't switched on yet.", "code": "ledger_off"})

    def test_permission_is_checked_before_the_ledger_off_answer(self):
        self.as_staff(self.support)
        with override_settings(LEDGER_ENABLED=False):
            self.assertEqual(self.client.get("/api/ledger/pickup/").status_code, 403)

    def test_finds_an_order_by_number_or_customer_name(self):
        first = self.pickup_order()
        second = self.pickup_order()
        self.as_staff(self.desk)
        by_number = self.client.get("/api/ledger/pickup/", {"q": f"#{second.pk}"}).json()
        self.assertEqual([r["order_id"] for r in by_number["results"]], [second.pk])
        by_name = self.client.get("/api/ledger/pickup/", {"q": "ama"}).json()
        self.assertEqual({r["order_id"] for r in by_name["results"]}, {first.pk, second.pk})
        self.assertEqual(self.client.get("/api/ledger/pickup/", {"q": "zzz"}).json()["count"], 0)
        self.assertEqual(self.client.get("/api/ledger/pickup/", {"q": "12345678901234"}).json()["count"], 0)


@override_settings(LEDGER_ENABLED=True)
class CollectionCodeTests(PickupBase):
    def collect(self, order, code=None):
        body = {} if code is None else {"code": code}
        return self.client.post(f"/api/ledger/pickup/{order.pk}/collected/", body, format="json")

    def wrong_code(self, order):
        real = self.code(order)
        return "000000" if real != "000000" else "111111"

    def test_a_ledger_paid_store_pickup_order_gets_one_six_digit_code(self):
        from ledger import verification

        order = self.pickup_order()
        code = self.code(order)
        self.assertRegex(code, r"^\d{6}$")
        self.assertEqual(verification.collection_code(Order.objects.get(pk=order.pk)), code)
        self.assertEqual(verification.collection_code(Order.objects.get(pk=order.pk)), code)
        self.assertEqual(self.code(order), code)

    def test_no_code_for_door_to_door_or_an_order_paid_before_the_ledger(self):
        from ledger import verification

        door = self.pickup_order()
        Order.objects.filter(pk=door.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        self.assertIsNone(verification.collection_code(Order.objects.get(pk=door.pk)))
        old = self.pickup_order(in_ledger=False)
        self.assertIsNone(verification.collection_code(Order.objects.get(pk=old.pk)))
        self.assertFalse(FulfilmentCheck.objects.filter(order=old).exists())

    def test_an_order_paid_before_codes_existed_gets_one_on_first_read(self):
        from ledger import verification

        order = self.pickup_order()
        FulfilmentCheck.objects.filter(order=order).delete()
        code = verification.collection_code(Order.objects.get(pk=order.pk))
        self.assertRegex(code, r"^\d{6}$")
        self.assertEqual(verification.collection_code(Order.objects.get(pk=order.pk)), code)

    def test_hand_over_needs_the_right_code(self):
        order = self.pickup_order()
        self.as_staff(self.desk)
        missing = self.collect(order)
        self.assertEqual((missing.status_code, missing.json()), (400, {
            "detail": "Ask the customer for their collection code.", "code": "code_required"}))
        wrong = self.collect(order, self.wrong_code(order))
        self.assertEqual((wrong.status_code, wrong.json()), (400, {
            "detail": "That code is not right.", "code": "wrong_code", "attempts_left": 4}))
        self.assertEqual(FulfilmentCheck.objects.get(order=order).code_attempts, 1)
        self.assertIsNone(FulfilmentCheck.objects.get(order=order).collected_at)
        right = self.collect(order, self.code(order))
        self.assertEqual(right.status_code, 200, right.content)
        self.assertIsNotNone(right.json()["collected_at"])

    def test_five_wrong_codes_lock_the_order_and_tell_support(self):
        from notifications.models import Notification

        order = self.pickup_order()
        self.as_staff(self.desk)
        bad = self.wrong_code(order)
        for left in (4, 3, 2, 1):
            self.assertEqual(self.collect(order, bad).json()["attempts_left"], left)
        self.assertEqual(Notification.objects.filter(kind="pickup_code_locked").count(), 0)
        fifth = self.collect(order, bad)
        self.assertEqual((fifth.status_code, fifth.json()["code"]), (423, "code_locked"))
        locked = self.collect(order, self.code(order))
        self.assertEqual((locked.status_code, locked.json()), (423, {
            "detail": "Too many wrong codes for this order. Support has been told.", "code": "code_locked"}))
        self.assertIsNone(FulfilmentCheck.objects.get(order=order).collected_at)
        notices = Notification.objects.filter(kind="pickup_code_locked", staff=self.support)
        self.assertEqual(notices.count(), 1)
        self.assertEqual(self.collect(order, bad).status_code, 423)
        
        notice = notices.get()
        self.assertEqual(notice.link, "support-verification")
        self.assertIn(f"#{order.pk}", notice.body)
        self.assertNotIn(self.code(order), notice.title + notice.body)

    def test_a_used_code_works_no_more(self):
        order = self.pickup_order()
        self.as_staff(self.desk)
        code = self.code(order)
        self.assertEqual(self.collect(order, code).status_code, 200)
        again = self.collect(order, code)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["detail"], "This order has already been collected.")

    def test_only_the_customer_sees_their_code(self):
        from accounts.authentication import issue_token

        order = self.pickup_order()
        code = self.code(order)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        listed = client.get("/api/orders/").json()
        rows = listed["results"] if isinstance(listed, dict) else listed
        mine = next(r for r in rows if r["id"] == order.pk)
        self.assertEqual(mine["collection_code"], code)
        self.assertIsNotNone(mine["collect_by"])
        detail = client.get(f"/api/orders/{order.pk}/").json()
        self.assertEqual(detail["collection_code"], code)
        door = self.pickup_order()
        Order.objects.filter(pk=door.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        other = client.get(f"/api/orders/{door.pk}/").json()
        self.assertEqual((other["collection_code"], other["collect_by"]), (None, None))

        owner = APIClient()
        owner.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.kofi, 'business_owner')}")
        self.as_staff(self.desk)
        pickup = self.client.get("/api/ledger/pickup/")
        self.as_staff(self.support)
        awaiting = self.client.get("/api/ledger/orders/awaiting-verification/")
        self.as_staff(make_staff("super_admin", "sa@example.com"))
        staff_orders = self.client.get("/api/orders/staff/")
        self.assertEqual(staff_orders.status_code, 200)
        self.as_staff(self.desk)
        self.client.post(f"/api/ledger/pickup/{order.pk}/collected/", {"code": code}, format="json")
        owner_orders = owner.get("/api/orders/owner/")
        self.assertEqual(owner_orders.status_code, 200)
        for response in (pickup, awaiting, staff_orders, owner_orders):
            self.assertNotIn(code, response.content.decode())
            self.assertNotIn("collection_code", response.content.decode())

    def test_creating_the_check_at_payment_changes_no_queue(self):
        from ledger import verification

        order = self.pickup_order()
        self.assertEqual(FulfilmentCheck.objects.get(order=order).collected_at, None)
        self.assertEqual([r["order_id"] for r in verification.pickup_queue()], [order.pk])
        self.assertEqual(list(verification.awaiting_queryset()), [])
        self.as_staff(self.desk)
        self.assertEqual([r["order_id"] for r in self.client.get("/api/ledger/pickup/").json()["results"]], [order.pk])
        self.as_staff(self.support)
        self.assertEqual(self.client.get("/api/ledger/orders/awaiting-verification/").json()["results"], [])
        row = verification.pickup_queue()[0]
        self.assertNotIn("collection_code", row)


class CustomerListQueryTests(PickupBase):
    def test_the_customer_order_list_costs_the_same_queries_with_pickup_orders(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from accounts.authentication import issue_token

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")

        def count():
            with CaptureQueriesContext(connection) as ctx:
                response = client.get("/api/orders/")
            self.assertEqual(response.status_code, 200)
            return len(ctx.captured_queries), len(response.json()["results"] if isinstance(response.json(), dict) else response.json())

        for ledger_on in (True, False):
            with override_settings(LEDGER_ENABLED=ledger_on):
                self.pickup_order(in_ledger=ledger_on)
                few, rows_few = count()
                self.pickup_order(in_ledger=ledger_on)
                self.pickup_order(in_ledger=ledger_on)
                many, rows_many = count()
                self.assertEqual(rows_many - rows_few, 2)
                self.assertEqual(many, few, f"ledger_on={ledger_on}")
