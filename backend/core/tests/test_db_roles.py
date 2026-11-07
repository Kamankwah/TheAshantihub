import os
from unittest import mock

import psycopg2
from django.core import checks
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TransactionTestCase, override_settings

from core import db_roles
from core.checks import check_runtime_database_role

ROLE = "ah_test_runtime_role"
PASSWORD = "a-long-enough-test-password-1"
DENIED = "42501"  # insufficient_privilege


class RuntimeRoleTests(TransactionTestCase):
    """The restricted runtime role (review DB-05): it works the application, and nothing more."""

    serialized_rollback = True  # flushes recreate content types; later serialized-rollback classes would then collide

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not connection.is_usable():
            connection.connect()
        with connection.cursor() as cursor:
            cursor.execute("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
            if not cursor.fetchone()[0]:
                raise AssertionError("these tests provision a role, so they need the superuser the test database is created with")

    def setUp(self):
        db_roles.provision(ROLE, PASSWORD)
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS zz_probe")
            cursor.execute("CREATE TABLE zz_probe (id serial PRIMARY KEY, v text)")  # created AFTER provisioning, by the owner

    def tearDown(self):
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS zz_probe")
            cursor.execute(f"DROP OWNED BY {ROLE}")
            cursor.execute(f"DROP ROLE IF EXISTS {ROLE}")

    def _as_runtime_role(self):
        s = connection.settings_dict
        conn = psycopg2.connect(dbname=s["NAME"], user=ROLE, password=PASSWORD, host=s["HOST"], port=s["PORT"])
        conn.autocommit = True
        return conn

    def _refused(self, conn, statement):
        with conn.cursor() as cursor:
            with self.assertRaises(psycopg2.Error, msg=statement) as ctx:
                cursor.execute(statement)
        self.assertEqual(ctx.exception.pgcode, DENIED, f"{statement!r} should be a privilege error, got {ctx.exception}")

    def test_the_role_is_not_privileged(self):
        conn = self._as_runtime_role()
        with conn.cursor() as cursor:
            cursor.execute("SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user")
            self.assertEqual(cursor.fetchone(), (False, False, False, False, False))

    def test_it_can_read_and_write_rows_including_in_tables_created_later(self):
        conn = self._as_runtime_role()
        with conn.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM accounts_customer")
            cursor.execute("INSERT INTO zz_probe (v) VALUES ('a') RETURNING id")  # the sequence is usable too
            cursor.execute("UPDATE zz_probe SET v = 'b'")
            cursor.execute("SELECT v FROM zz_probe")
            self.assertEqual(cursor.fetchall(), [("b",)])
            cursor.execute("DELETE FROM zz_probe")

    def test_it_cannot_change_the_schema_triggers_or_roles_or_run_programs(self):
        conn = self._as_runtime_role()
        for statement in (
            "CREATE TABLE zz_evil (id int)",
            "DROP TABLE zz_probe",
            "ALTER TABLE ledger_journal DISABLE TRIGGER ALL",
            "DROP TRIGGER ledger_journal_append_only ON ledger_journal",
            "TRUNCATE zz_probe",
            "CREATE ROLE zz_evil LOGIN",
            "SET session_replication_role = replica",
            "COPY (SELECT 1) TO PROGRAM 'true'",
            "CREATE EXTENSION IF NOT EXISTS hstore",
        ):
            with self.subTest(statement):
                self._refused(conn, statement)

    def test_append_only_tables_cannot_be_deleted_from_or_truncated_even_before_the_trigger(self):
        conn = self._as_runtime_role()
        for table in db_roles.APPEND_ONLY_TABLES:
            for statement in (f"DELETE FROM {table}", f"TRUNCATE {table}"):
                with self.subTest(statement):
                    self._refused(conn, statement)
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT count(*) FROM {table}")  # reading and inserting stay open

    def test_provisioning_twice_is_safe_and_updates_the_password(self):
        db_roles.provision(ROLE, PASSWORD)
        db_roles.provision(ROLE, PASSWORD + "-rotated")
        s = connection.settings_dict
        with self.assertRaises(psycopg2.OperationalError):
            psycopg2.connect(dbname=s["NAME"], user=ROLE, password=PASSWORD, host=s["HOST"], port=s["PORT"])
        psycopg2.connect(dbname=s["NAME"], user=ROLE, password=PASSWORD + "-rotated", host=s["HOST"], port=s["PORT"]).close()

    def test_a_weak_password_or_the_owner_name_is_refused(self):
        with self.assertRaises(ValueError):
            db_roles.provision(ROLE, "short")
        with self.assertRaises(ValueError):
            db_roles.provision("Bad-Name;", PASSWORD)
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user")
            owner = cursor.fetchone()[0]
        with self.assertRaises(ValueError):
            db_roles.provision(owner, PASSWORD)

    def test_the_command_reads_the_role_from_the_environment(self):
        with mock.patch.dict(os.environ, {"POSTGRES_APP_USER": ROLE, "POSTGRES_APP_PASSWORD": PASSWORD}):
            call_command("provision_db_roles")
        with mock.patch.dict(os.environ, {"POSTGRES_APP_USER": "", "POSTGRES_APP_PASSWORD": ""}):
            with self.assertRaises(CommandError):
                call_command("provision_db_roles")


class RuntimeRoleCheckTests(TransactionTestCase):
    """core.E004: a production process connected as a superuser stops the deploy."""

    serialized_rollback = True

    def test_a_superuser_connection_is_an_error_outside_debug(self):
        with override_settings(DEBUG=False, TESTING=False):
            errors = check_runtime_database_role(None, databases=["default"])
        self.assertEqual([e.id for e in errors], ["core.E004"])
        self.assertIsInstance(errors[0], checks.Error)

    def test_owner_tasks_debug_tests_and_non_database_runs_are_exempt(self):
        with override_settings(DEBUG=False, TESTING=False):
            with mock.patch.dict(os.environ, {"DJANGO_DB_ROLE": "owner"}):
                self.assertEqual(check_runtime_database_role(None, databases=["default"]), [])
            self.assertEqual(check_runtime_database_role(None, databases=None), [])
        with override_settings(DEBUG=True, TESTING=False):
            self.assertEqual(check_runtime_database_role(None, databases=["default"]), [])
        with override_settings(DEBUG=False, TESTING=True):
            self.assertEqual(check_runtime_database_role(None, databases=["default"]), [])
