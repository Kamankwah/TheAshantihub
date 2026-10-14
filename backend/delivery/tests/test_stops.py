from delivery import services, stops
from delivery.models import PickupStop
from listings.models import Category, Listing, Zone
from orders.models import DeliveryAssignment as DA

from .base import DeliveryCase

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)


class StopTests(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.shop_a, self.item_a = self.make_shop("Shop A", "+233207000101", A)
        self.shop_b, self.item_b = self.make_shop("Shop B", "+233207000102", B)
        self.chop, self.item_food = self.make_shop("Chop Bar", "+233207000103", C, slug="food")

    def owners(self, assignment):
        return [s.business_owner_id for s in assignment.stops.all()]

    def test_the_food_migration_marks_food_and_the_new_beverages_category(self):
        self.assertEqual(sorted(Category.objects.filter(is_food=True).values_list("slug", flat=True)), ["beverages", "food"])
        bev = Category.objects.get(slug="beverages")
        self.assertEqual((bev.label, bev.kind), ("Beverages", Category.PRODUCT))
        self.assertFalse(Category.objects.get(slug="pubs").is_food)

    def test_the_beverages_migration_is_idempotent(self):
        from importlib import import_module

        from django.apps import apps as django_apps

        migration = import_module("listings.migrations.0020_category_is_food")
        migration.seed_beverages(django_apps, None)  # a second run changes nothing
        self.assertEqual(Category.objects.filter(slug="beverages").count(), 1)
        self.assertTrue(Category.objects.get(slug="beverages").is_food)

    def test_a_beverages_shop_is_a_food_stop_collected_last(self):
        bar, item_bar = self.make_shop("Akwaaba Drinks", "+233207000104", (6.702, -1.618), slug="beverages")
        a = self.assign(self.multi_order(item_bar, self.item_a, self.item_b))
        self.assertEqual(self.owners(a), [self.shop_a.pk, self.shop_b.pk, bar.pk])

    def test_a_new_assignment_gets_one_stop_per_shop_in_the_stored_plan(self):
        plan = {"owner_ids": [self.shop_b.pk, self.shop_a.pk, self.chop.pk], "planned": True, "total_km": 4.0}
        a = self.assign(self.multi_order(self.item_a, self.item_b, self.item_food, route_plan=plan))
        rows = list(a.stops.all())
        self.assertEqual(self.owners(a), [self.shop_b.pk, self.shop_a.pk, self.chop.pk])
        self.assertEqual([s.sequence for s in rows], [1, 2, 3])
        self.assertEqual(len({s.code for s in rows} | {a.drop_code}), 4)  # every code on one delivery differs
        self.assertEqual(a.pickup_code, rows[0].code)  # the legacy field mirrors stop 1
        self.assertEqual(a.route_plan["stop_ids"], [s.pk for s in rows])
        self.assertEqual(a.route_plan["total_km"], 4.0)
        self.assertEqual((rows[0].lat, rows[0].lng), B)
        self.assertEqual({s.status for s in rows}, {PickupStop.PENDING})

    def test_without_a_stored_plan_shops_follow_the_cart_with_food_last(self):
        a = self.assign(self.multi_order(self.item_food, self.item_a, self.item_b))
        self.assertEqual(self.owners(a), [self.shop_a.pk, self.shop_b.pk, self.chop.pk])
        self.assertFalse(a.route_plan["planned"])

    def test_a_stored_plan_for_other_shops_is_ignored(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b, route_plan={"owner_ids": [999999], "planned": True}))
        self.assertEqual(self.owners(a), [self.shop_a.pk, self.shop_b.pk])

    def test_a_shop_selling_food_and_goods_is_one_food_stop(self):
        food_line = Listing.objects.create(
            business_owner=self.shop_a, category=Category.objects.get(slug="food"), zone=Zone.objects.get(name="Manhyia"),
            name="Shop A soup", description="D.", contact_phone="+233207000101", price_amount="10.00", status=Listing.PUBLISHED,
        )
        a = self.assign(self.multi_order(self.item_a, food_line, self.item_b))
        self.assertEqual(self.owners(a), [self.shop_b.pk, self.shop_a.pk])  # one stop per business; a food line makes it last

    def test_a_shop_with_no_location_still_gets_a_stop_with_no_point(self):
        nowhere, item_nowhere = self.make_shop("Nowhere", "+233207000105")
        a = self.assign(self.multi_order(item_nowhere, self.item_a))
        rows = list(a.stops.all())
        self.assertEqual([s.business_owner_id for s in rows], [nowhere.pk, self.shop_a.pk])
        self.assertEqual((rows[0].lat, rows[0].lng), (None, None))
        self.assertEqual(services.pickup_stop(a.order)[:2], (None, None))

    def test_the_dispatch_point_is_the_first_planned_shop(self):
        order = self.multi_order(self.item_a, self.item_b, route_plan={"owner_ids": [self.shop_b.pk, self.shop_a.pk], "planned": True})
        lat, lng, name = services.pickup_stop(order)
        self.assertEqual(((lat, lng), name), (B, "Shop B"))

    def test_an_assignment_from_before_stops_is_read_as_one_stop_without_writing(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        a.stops.all().delete()
        DA.objects.filter(pk=a.pk).update(pickup_code="4321", pickup_code_attempts=2, status=DA.AT_PICKUP)
        a = DA.objects.get(pk=a.pk)
        rows = stops.stops_of(a)
        self.assertEqual(PickupStop.objects.filter(assignment=a).count(), 0)
        self.assertEqual([(s.pk, s.business_owner_id, s.code, s.code_attempts, s.status) for s in rows],
                         [(None, self.shop_a.pk, "4321", 2, PickupStop.ARRIVED)])
        made = stops.ensure_stops(a)
        self.assertEqual([(s.business_owner_id, s.code, s.code_attempts, s.status) for s in made],
                         [(self.shop_a.pk, "4321", 2, PickupStop.ARRIVED)])
        self.assertEqual(stops.ensure_stops(a)[0].pk, made[0].pk)  # made once

    def test_reassigning_mid_route_keeps_done_stops_and_codes(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        first, second = a.stops.all()
        first.status = PickupStop.COLLECTED
        first.save()
        second.status, second.code_attempts = PickupStop.ARRIVED, 3
        second.save()
        DA.objects.filter(pk=a.pk).update(status=DA.AT_PICKUP)
        again = self.assign(a.order, self.other_staff)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.status, second.status, second.code_attempts), (PickupStop.COLLECTED, PickupStop.PENDING, 0))
        self.assertEqual([s.code for s in again.stops.all()], [first.code, second.code])
        self.assertEqual((again.status, again.dispatch_id), (DA.ASSIGNED, self.other_staff.pk))

    def test_re_dispatching_after_every_shop_was_skipped_reopens_the_stops_but_keeps_the_evidence(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        codes = [s.code for s in a.stops.all()]
        for stop in a.stops.all():
            stop.status, stop.skip_note, stop.skipped_by = PickupStop.SKIPPED, "Shut", self.manager
            stop.save()
        DA.objects.filter(pk=a.pk).update(status=DA.FAILED, failed_reason="all_stops_skipped")
        again = self.assign(a.order, self.other_staff)
        self.assertEqual((again.pk, again.status, again.failed_reason), (a.pk, DA.ASSIGNED, ""))
        rows = list(again.stops.all())
        self.assertEqual([(s.status, s.skip_note, s.skipped_by_id, s.code) for s in rows],
                         [(PickupStop.PENDING, "", None, codes[0]), (PickupStop.PENDING, "", None, codes[1])])

    def test_re_dispatching_after_a_failed_delivery_keeps_a_skipped_shop_skipped(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        first, second = a.stops.all()
        first.status = PickupStop.SKIPPED
        first.save()
        second.status = PickupStop.COLLECTED
        second.save()
        DA.objects.filter(pk=a.pk).update(status=DA.FAILED, failed_reason="wrong_address")
        again = self.assign(a.order, self.other_staff)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.status, second.status), (PickupStop.SKIPPED, PickupStop.PENDING))

    def test_current_stop_and_progress(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b, self.item_food))
        first, second, third = a.stops.all()
        self.assertEqual(stops.current_stop(a).pk, first.pk)
        first.status = PickupStop.COLLECTED
        first.save()
        second.status = PickupStop.SKIPPED
        second.save()
        self.assertEqual(stops.current_stop(a).pk, third.pk)
        self.assertEqual(stops.progress(a), {"total": 3, "done": 1, "skipped": 1, "current": 3})
        self.assertEqual([i.listing_id for i in stops.stop_lines(third, a.order)], [self.item_food.pk])

    def test_the_food_migration_reverse_only_unflags_and_keeps_beverages(self):
        from importlib import import_module

        from django.apps import apps as django_apps

        migration = import_module("listings.migrations.0020_category_is_food")
        migration.unmark_food(django_apps, None)
        self.assertTrue(Category.objects.filter(slug="beverages").exists())
        self.assertFalse(Category.objects.filter(is_food=True).exists())

    def test_a_failed_job_re_dispatched_to_the_same_rider_reopens_its_stops(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        first, second = a.stops.all()
        first.status = PickupStop.COLLECTED
        first.save()
        second.status, second.code_attempts = PickupStop.ARRIVED, 2
        second.save()
        DA.objects.filter(pk=a.pk).update(status=DA.FAILED, failed_reason="wrong_address")
        again = self.assign(a.order, self.rider_staff)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((again.status, again.dispatch_id), (DA.ASSIGNED, self.rider_staff.pk))
        self.assertEqual((first.status, second.status, second.code_attempts), (PickupStop.PENDING, PickupStop.PENDING, 0))

    def test_a_pre_release_job_reassigned_keeps_its_code_and_gets_one_stop(self):
        order = self.multi_order(self.item_a, self.item_b)
        old = DA.objects.create(order=order, dispatch=self.rider_staff, assigned_by=self.manager, status=DA.ASSIGNED,
                                pickup_code="4321", drop_code="8765")
        again = self.assign(order, self.other_staff)
        rows = list(again.stops.all())
        self.assertEqual(again.pk, old.pk)
        self.assertEqual([(s.business_owner_id, s.code) for s in rows], [(self.shop_a.pk, "4321")])
        self.assertEqual((again.pickup_code, again.drop_code, again.dispatch_id), ("4321", "8765", self.other_staff.pk))
