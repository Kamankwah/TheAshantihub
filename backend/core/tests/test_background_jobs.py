from django.conf import settings
from django.test import SimpleTestCase

from ashantihub.celery import app


class BackgroundJobSettingsTests(SimpleTestCase):
    def test_the_test_suite_needs_no_redis(self):
        self.assertFalse(settings.USE_REDIS)
        self.assertEqual(settings.CHANNEL_LAYERS["default"]["BACKEND"], "channels.layers.InMemoryChannelLayer")
        self.assertEqual(settings.CACHES["realtime"]["BACKEND"], "django.core.cache.backends.locmem.LocMemCache")
        self.assertTrue(settings.CELERY_TASK_ALWAYS_EAGER)

    def test_sign_in_throttles_never_depend_on_redis(self):
        # Review Focus 1: the default cache backs the login throttles and must
        # stay local-memory even in production, so a Redis outage can't take
        # sign-in down.
        self.assertEqual(settings.CACHES["default"]["BACKEND"], "django.core.cache.backends.locmem.LocMemCache")

    def test_every_scheduled_job_names_a_registered_task(self):
        app.loader.import_default_modules()
        for name, entry in settings.CELERY_BEAT_SCHEDULE.items():
            self.assertIn(entry["task"], app.tasks, name)

    def test_the_asgi_application_serves_http(self):
        from ashantihub.asgi import application

        self.assertIn("http", application.application_mapping)
