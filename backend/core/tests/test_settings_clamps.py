import os
import subprocess
import sys
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class WrongLocationHideDaysTests(SimpleTestCase):
    """A zero or negative window would hide a business the moment its location is marked wrong, so the setting never
    drops below one day. Read in a child process because the value is fixed when the settings load."""

    def hide_days(self, value):
        env = {
            **os.environ, "DJANGO_DEBUG": "True", "DJANGO_SECRET_KEY": "x" * 50,
            "STAFF_SECRETS_KEY": "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTI=", "REDIS_URL": "",
            "WRONG_LOCATION_HIDE_DAYS": value,
        }
        result = subprocess.run(
            [sys.executable, "-c", "import ashantihub.settings as s; print(s.WRONG_LOCATION_HIDE_DAYS)"],
            cwd=Path(settings.BASE_DIR), env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return int(result.stdout.strip().splitlines()[-1])

    def test_zero_and_negative_values_become_one_day(self):
        self.assertEqual(self.hide_days("0"), 1)
        self.assertEqual(self.hide_days("-5"), 1)

    def test_a_normal_value_is_kept(self):
        self.assertEqual(self.hide_days("7"), 7)
        self.assertEqual(self.hide_days("1"), 1)
