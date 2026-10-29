"""A business keeps an ordered list of categories; `business_category` is its first (main) one, kept in sync by
`accounts.categories.set_categories`, the only writer."""
import importlib

from django.apps import apps as django_apps
from django.test import TestCase

from accounts.categories import (
    MAX_CATEGORIES,
    InvalidCategories,
    categories_of,
    set_categories,
)
from accounts.models import BusinessOwner, BusinessOwnerCategory, BusinessOwnerProfile
from listings.models import Category


def make_category(slug, kind="product", **extra):
    return Category.objects.create(slug=slug if slug.startswith("bc-") else f"bc-{slug}", icon="🧵", label=slug.title(), color="#7c3aed", kind=kind, **extra)


def make_profile(phone="+233201112233", kind="product", main=None):
    owner = BusinessOwner.objects.create(
        full_name="Kwame Business", login_phone=phone, email=f"{phone[-4:]}@example.com", password_hash="x",
    )
    return BusinessOwnerProfile.objects.create(business_owner=owner, business_kind=kind, business_category=main)


class SetCategoriesTests(TestCase):
    def setUp(self):
        self.profile = make_profile()
        self.a = make_category("fabrics")
        self.b = make_category("shoes")
        self.c = make_category("bags")

    def ids(self):
        return [c.pk for c in categories_of(BusinessOwnerProfile.objects.get(pk=self.profile.pk))]

    def test_set_categories_saves_ordered_list_and_main(self):
        result = set_categories(self.profile, [self.b.pk, self.a.pk])
        self.assertEqual([c.pk for c in result], [self.b.pk, self.a.pk])
        fresh = BusinessOwnerProfile.objects.get(pk=self.profile.pk)
        self.assertEqual(fresh.business_category_id, self.b.pk)
        self.assertEqual(self.ids(), [self.b.pk, self.a.pk])
        self.assertEqual(
            list(fresh.category_links.values_list("position", flat=True)), [0, 1],
        )

    def test_main_is_the_first_pick_after_reordering(self):
        set_categories(self.profile, [self.a.pk, self.b.pk, self.c.pk])
        set_categories(self.profile, [self.c.pk, self.a.pk, self.b.pk])
        self.assertEqual(self.ids(), [self.c.pk, self.a.pk, self.b.pk])
        self.assertEqual(BusinessOwnerProfile.objects.get(pk=self.profile.pk).business_category_id, self.c.pk)

    def test_removing_the_main_promotes_the_next(self):
        set_categories(self.profile, [self.a.pk, self.b.pk])
        set_categories(self.profile, [self.b.pk])
        self.assertEqual(self.ids(), [self.b.pk])
        self.assertEqual(BusinessOwnerProfile.objects.get(pk=self.profile.pk).business_category_id, self.b.pk)

    def assertRejected(self, ids, message):
        with self.assertRaises(InvalidCategories) as ctx:
            set_categories(self.profile, ids)
        self.assertEqual(ctx.exception.message, message)

    def test_rejects_empty_list_and_eleven(self):
        self.assertRejected([], "Choose at least one category.")
        many = [make_category(f"extra-{i}").pk for i in range(MAX_CATEGORIES + 1)]
        self.assertEqual(len(many), 11)
        self.assertRejected(many, "Choose at most 10 categories.")
        ten = many[:MAX_CATEGORIES]
        self.assertEqual(len(set_categories(self.profile, ten)), 10)

    def test_rejects_duplicates(self):
        self.assertRejected([self.a.pk, self.a.pk], "Pick each category once.")

    def test_rejects_wrong_kind_and_event_categories(self):
        service = make_category("bc-repairs", kind="service")
        event = make_category("bc-concerts", kind="event")
        self.assertRejected([self.a.pk, service.pk], "Choose categories for a product business.")
        self.assertRejected([event.pk], "Choose categories for a product business.")
        self.profile.business_kind = "service"
        self.profile.save(update_fields=["business_kind"])
        self.assertRejected([self.a.pk], "Choose categories for a service business.")
        self.assertRejected([event.pk], "Choose categories for a service business.")
        self.assertEqual(len(set_categories(self.profile, [service.pk])), 1)

    def test_a_department_is_a_valid_category(self):
        department = make_category("clothing-dept")
        self.assertTrue(department.is_department)
        self.assertEqual([c.pk for c in set_categories(self.profile, [department.pk])], [department.pk])

    def test_rejects_unknown_id(self):
        self.assertRejected([self.a.pk, 999999], "That category doesn't exist.")

    def test_requires_a_business_kind(self):
        self.profile.business_kind = None
        self.profile.save(update_fields=["business_kind"])
        self.assertRejected([self.a.pk], "Choose products or services first.")

    def test_failed_call_changes_nothing(self):
        set_categories(self.profile, [self.a.pk, self.b.pk])
        service = make_category("bc-repairs", kind="service")
        for bad in ([], [self.c.pk, service.pk], [self.c.pk, self.c.pk], [self.c.pk, 999999]):
            with self.assertRaises(InvalidCategories):
                set_categories(self.profile, bad)
        self.assertEqual(self.ids(), [self.a.pk, self.b.pk])
        self.assertEqual(BusinessOwnerProfile.objects.get(pk=self.profile.pk).business_category_id, self.a.pk)

    def test_deleting_a_linked_category_leaves_a_consistent_list(self):
        set_categories(self.profile, [self.a.pk, self.b.pk, self.c.pk])
        self.a.delete()
        fresh = BusinessOwnerProfile.objects.get(pk=self.profile.pk)
        self.assertEqual(self.ids(), [self.b.pk, self.c.pk])
        self.assertEqual(list(fresh.category_links.values_list("position", flat=True)), [0, 1])
        self.assertEqual(fresh.business_category_id, self.b.pk)
        self.b.delete()
        self.c.delete()
        fresh = BusinessOwnerProfile.objects.get(pk=self.profile.pk)
        self.assertEqual(self.ids(), [])
        self.assertIsNone(fresh.business_category_id)

    def test_deleting_a_non_main_category_keeps_the_main(self):
        set_categories(self.profile, [self.a.pk, self.b.pk])
        self.b.delete()
        self.assertEqual(self.ids(), [self.a.pk])
        self.assertEqual(BusinessOwnerProfile.objects.get(pk=self.profile.pk).business_category_id, self.a.pk)

    def test_categories_of_falls_back_to_the_main_when_there_are_no_links(self):
        profile = make_profile(phone="+233209998877", main=self.a)
        self.assertFalse(BusinessOwnerCategory.objects.filter(profile=profile).exists())
        self.assertEqual([c.pk for c in categories_of(profile)], [self.a.pk])
        self.assertEqual(categories_of(make_profile(phone="+233208887766")), [])


class FixRoundTests(TestCase):
    def setUp(self):
        self.profile = make_profile()
        self.cats = [make_category(f"fr-{i}") for i in range(6)]

    def ids(self, profile=None):
        profile = BusinessOwnerProfile.objects.get(pk=(profile or self.profile).pk)
        return [c.pk for c in categories_of(profile)]

    def test_categories_of_honours_a_prefetch(self):
        profiles = [self.profile] + [make_profile(phone=f"+23320222000{i}") for i in range(1, 4)]
        for profile in profiles:
            set_categories(profile, [c.pk for c in self.cats[:3]])
        queryset = BusinessOwnerProfile.objects.filter(pk__in=[p.pk for p in profiles]).prefetch_related(
            "category_links__category"
        )
        # Two prefetch queries plus the profiles themselves, then nothing per profile.
        with self.assertNumQueries(3):
            lists = [categories_of(p) for p in queryset]
        self.assertEqual([len(x) for x in lists], [3, 3, 3, 3])
        self.assertEqual([c.pk for c in lists[0]], [c.pk for c in self.cats[:3]])
        # A fresh single-profile call is one query.
        fresh = BusinessOwnerProfile.objects.get(pk=self.profile.pk)
        with self.assertNumQueries(1):
            self.assertEqual(len(categories_of(fresh)), 3)

    def test_the_writer_costs_a_constant_number_of_queries(self):
        def run(n_existing):
            profile = make_profile(phone=f"+2332033300{n_existing}")
            if n_existing:
                set_categories(profile, [c.pk for c in self.cats[:n_existing]])
            from django.db import connection
            from django.test.utils import CaptureQueriesContext

            with CaptureQueriesContext(connection) as ctx:
                set_categories(profile, [c.pk for c in reversed(self.cats[:2])])
            return len(ctx)

        self.assertEqual(run(1), run(5))

    def test_a_bulk_category_delete_leaves_every_list_consistent(self):
        other = make_profile(phone="+233205550001")
        set_categories(self.profile, [c.pk for c in self.cats[:4]])
        set_categories(other, [self.cats[1].pk, self.cats[4].pk, self.cats[2].pk])
        Category.objects.filter(pk__in=[self.cats[0].pk, self.cats[2].pk]).delete()
        self.assertEqual(self.ids(), [self.cats[1].pk, self.cats[3].pk])
        self.assertEqual(self.ids(other), [self.cats[1].pk, self.cats[4].pk])
        for profile in (self.profile, other):
            fresh = BusinessOwnerProfile.objects.get(pk=profile.pk)
            self.assertEqual(
                list(fresh.category_links.values_list("position", flat=True)), list(range(fresh.category_links.count()))
            )
            self.assertEqual(fresh.business_category_id, fresh.category_links.first().category_id)

    def test_deleting_a_profile_or_its_owner_does_not_error(self):
        set_categories(self.profile, [self.cats[0].pk, self.cats[1].pk])
        owner = self.profile.business_owner
        owner.delete()
        self.assertFalse(BusinessOwnerCategory.objects.exists())
        profile = make_profile(phone="+233205550002")
        set_categories(profile, [self.cats[0].pk])
        profile.delete()
        self.assertFalse(BusinessOwnerCategory.objects.exists())

    def test_string_ids_are_accepted_and_garbage_is_not_found(self):
        result = set_categories(self.profile, [str(self.cats[1].pk), self.cats[0].pk])
        self.assertEqual([c.pk for c in result], [self.cats[1].pk, self.cats[0].pk])
        for bad in ("abc", "", None, True, 1.5, "1.5", -3, 0, 2**70, [1], {"id": 1}):
            with self.assertRaises(InvalidCategories) as ctx:
                set_categories(self.profile, [self.cats[2].pk, bad])
            self.assertEqual(ctx.exception.message, "That category doesn't exist.", bad)
        with self.assertRaises(InvalidCategories) as ctx:
            set_categories(self.profile, [str(self.cats[2].pk), self.cats[2].pk])
        self.assertEqual(ctx.exception.message, "Pick each category once.")
        with self.assertRaises(InvalidCategories):
            set_categories(self.profile, None)
        self.assertEqual(self.ids(), [self.cats[1].pk, self.cats[0].pk])

    def test_length_and_duplicates_are_checked_before_any_query(self):
        with self.assertNumQueries(0):
            for bad in ([], [1, 1], list(range(1, 12))):
                with self.assertRaises(InvalidCategories):
                    set_categories(self.profile, bad)


class BackfillTests(TestCase):
    def test_backfill_gives_a_list_of_one_and_leaves_empty_for_none(self):
        migration = importlib.import_module("accounts.migrations.0077_business_categories")
        category = make_category("fabrics")
        with_main = make_profile(phone="+233201110001", main=category)
        without = make_profile(phone="+233201110002")
        migration.backfill_categories(django_apps, None)
        links = list(BusinessOwnerCategory.objects.filter(profile=with_main))
        self.assertEqual([(l.category_id, l.position) for l in links], [(category.pk, 0)])
        self.assertFalse(BusinessOwnerCategory.objects.filter(profile=without).exists())
        # running it again adds nothing
        migration.backfill_categories(django_apps, None)
        self.assertEqual(BusinessOwnerCategory.objects.filter(profile=with_main).count(), 1)
