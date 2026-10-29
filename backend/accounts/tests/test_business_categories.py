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
