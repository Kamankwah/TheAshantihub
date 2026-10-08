import os
import subprocess
import sys
from pathlib import Path

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


class RedisRequiredInProductionTests(SimpleTestCase):
    """Production (DJANGO_DEBUG=False) without a redis:// REDIS_URL would
    silently run eager Celery and an in-process channel layer per worker, so
    the settings refuse to load. Imported in a child process: not `manage.py
    test`, so the TESTING escape hatch is off, exactly as on the server."""

    MESSAGE = "REDIS_URL must be set when DJANGO_DEBUG=False"

    def load_settings(self, **overrides):
        env = {
            **os.environ,
            "DJANGO_DEBUG": "False",
            "DJANGO_SECRET_KEY": "x" * 50,
            "STAFF_SECRETS_KEY": "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTI=",
            "REDIS_URL": "",
            **overrides,
        }
        return subprocess.run(
            [sys.executable, "-c", "import ashantihub.settings"],
            cwd=Path(settings.BASE_DIR), env=env, capture_output=True, text=True, timeout=60,
        )

    def test_a_missing_redis_url_refuses_to_start(self):
        result = self.load_settings()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        self.assertIn(self.MESSAGE, result.stderr)

    def test_a_non_redis_url_refuses_to_start(self):
        result = self.load_settings(REDIS_URL="memory://")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(self.MESSAGE, result.stderr)

    def test_a_redis_url_starts(self):
        for url in ("redis://redis:6379/0", "rediss://:secret@redis:6380/0"):
            result = self.load_settings(REDIS_URL=url)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_debug_still_runs_everything_in_process(self):
        # The production-image smoke runs with DJANGO_DEBUG=True and no Redis.
        result = self.load_settings(DJANGO_DEBUG="True")
        self.assertEqual(result.returncode, 0, result.stderr)
