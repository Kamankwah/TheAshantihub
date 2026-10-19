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

    def pickup_order(self):
        self.kofi = self.owner("Kofi")
        order = self.order([(self.listing(self.kofi, "120.00"), 1)])
        order.delivery_method = Order.STORE_PICKUP
        order.save(update_fields=["delivery_method"])
        escrow.record_order_payment(order)
        return order


class RoleTests(PickupBase):
    def test_the_role_exists_with_its_permission_and_super_admin_holds_it_too(self):
        role = Role.objects.get(name="pickup_desk")
        self.assertEqual(list(role.permissions.values_list("codename", flat=True)), ["pickup.confirm"])
        self.assertTrue(Role.objects.get(name="super_admin").permissions.filter(codename="pickup.confirm").exists())


@override_settings(LEDGER_ENABLED=True)
class CollectionTests(PickupBase):
    def collect(self, order):
        return self.client.post(f"/api/ledger/pickup/{order.pk}/collected/")

    def test_the_desk_marks_a_store_pickup_order_collected_and_it_is_idempotent(self):
        order = self.pickup_order()
        self.as_staff(self.desk)
        first = self.collect(order)
        self.assertEqual(first.status_code, 200, first.content)
        check = FulfilmentCheck.objects.get(order=order)
        self.assertEqual(check.collected_by_id, self.desk.pk)
        stamped = check.collected_at
        self.assertEqual(self.collect(order).status_code, 200)
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
        verification.mark_collected(order, self.desk)
        Order.objects.filter(pk=order.pk).update(delivery_status=Order.PROCESSING)  # would be restored only by a re-save
        verification.mark_collected(order, self.desk)
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
        self.client.post(f"/api/ledger/pickup/{collected.pk}/collected/")
        delivery = self.pickup_order()
        Order.objects.filter(pk=delivery.pk).update(delivery_method=Order.DOOR_TO_DOOR)
        ids = [r["order_id"] for r in self.client.get("/api/ledger/pickup/").json()["results"]]
        self.assertNotIn(collected.pk, ids)
        self.assertNotIn(delivery.pk, ids)

    def test_the_desk_does_not_see_the_customers_phone_number(self):
        self.pickup_order()
        self.as_staff(self.desk)
        self.assertNotIn("customer_phone", self.client.get("/api/ledger/pickup/").json()["results"][0])
