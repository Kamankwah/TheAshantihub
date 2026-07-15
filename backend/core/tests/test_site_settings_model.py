from django.test import TestCase

from core.models import SiteSettings


class SiteSettingsSingletonTests(TestCase):
    def test_load_creates_row_if_missing(self):
        # The 0002 data migration seeds one row up front; delete it to
        # simulate the "row doesn't exist yet" case this test targets.
        SiteSettings.objects.all().delete()
        self.assertEqual(SiteSettings.objects.count(), 0)
        settings = SiteSettings.load()
        self.assertEqual(settings.pk, 1)
        self.assertEqual(SiteSettings.objects.count(), 1)

    def test_load_always_returns_same_row(self):
        first = SiteSettings.load()
        first.contact_email = "hello@theashantihub.com"
        first.save()

        second = SiteSettings.load()
        self.assertEqual(second.pk, first.pk)
        self.assertEqual(second.contact_email, "hello@theashantihub.com")
        self.assertEqual(SiteSettings.objects.count(), 1)

    def test_multiple_creates_collapse_to_one_row(self):
        SiteSettings.objects.create(contact_email="one@example.com")
        SiteSettings.objects.create(contact_email="two@example.com")
        SiteSettings.objects.create(contact_email="three@example.com")

        self.assertEqual(SiteSettings.objects.count(), 1)
        self.assertEqual(SiteSettings.objects.get().contact_email, "three@example.com")

    def test_save_always_forces_pk_one(self):
        settings = SiteSettings(pk=999, contact_phone="+233123456789")
        settings.save()
        self.assertEqual(settings.pk, 1)
        self.assertEqual(SiteSettings.objects.count(), 1)
