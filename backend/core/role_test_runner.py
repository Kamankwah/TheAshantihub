"""Run the test suite connected as the restricted runtime role (review DB-05). Opt-in:

    python manage.py test --testrunner core.role_test_runner.RuntimeRoleRunner

The test database is created and migrated as the normal (owner) user; then the restricted role is provisioned in it and the
default connection switches to that role for every test. A test that needs a privilege the real application does not have
fails here exactly as it would in production. ``TransactionTestCase`` classes flush with TRUNCATE, which the role is denied by
design, so expect those (and only those) to error."""
from django.db import connection
from django.test.runner import DiscoverRunner

from core import db_roles

ROLE = "ah_runtime_suite"
PASSWORD = "runtime-suite-password-0001"


class RuntimeRoleRunner(DiscoverRunner):
    def setup_databases(self, **kwargs):
        config = super().setup_databases(**kwargs)
        self._owner = (connection.settings_dict["USER"], connection.settings_dict["PASSWORD"])
        db_roles.provision(ROLE, PASSWORD)
        connection.close()
        connection.settings_dict["USER"] = ROLE
        connection.settings_dict["PASSWORD"] = PASSWORD
        return config

    def teardown_databases(self, old_config, **kwargs):
        connection.close()
        connection.settings_dict["USER"], connection.settings_dict["PASSWORD"] = self._owner
        super().teardown_databases(old_config, **kwargs)
