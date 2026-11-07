"""The two Postgres roles (review DB-05 / BE-15).

* the **owner** (``POSTGRES_USER``) creates and owns every table and trigger. Only deploy-time tasks use it: ``migrate``,
  ``provision_db_roles`` and backups. It is never put into the application containers.
* the **runtime role** (``POSTGRES_APP_USER``) is what gunicorn, Celery and the realtime server connect as. It can read and
  write rows, and nothing else: it is not a superuser, owns nothing, cannot create objects, cannot drop or disable the
  append-only triggers, cannot truncate, and cannot run OS commands through ``COPY ... PROGRAM``. A leaked app credential or
  an SQL injection therefore cannot rewrite the ledger or the audit log.

``provision`` is idempotent and is run by ``deploy.sh`` after ``migrate`` on every deploy; default privileges make the tables
a later migration creates usable by the runtime role without another step."""
import re

from django.db import connection
from psycopg2 import sql

# Tables whose rows may only ever be added (a trigger refuses UPDATE/DELETE as well): the runtime role also loses DELETE and
# TRUNCATE on them, so the rule does not rest on the trigger alone.
APPEND_ONLY_TABLES = ("ledger_journal", "ledger_journalline", "activity_activityevent", "marketing_consentrecord")

_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def is_runtime_superuser():
    """(rolsuper, rolcreaterole, rolcreatedb) of the role this process is connected as."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user")
        return cursor.fetchone()


def provision(role, password):
    """Create or update ``role`` (login, no privileges beyond the grants below) and grant it row access to everything the
    current user owns. Must be run as the owner. Returns a one-line summary."""
    if not _NAME.match(role or ""):
        raise ValueError("The runtime role name must be lowercase letters, digits and underscores.")
    if not password or len(password) < 20:
        raise ValueError("The runtime role needs a password of at least 20 characters (POSTGRES_APP_PASSWORD).")
    ident = sql.Identifier(role)
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_user, current_database()")
        owner, database = cursor.fetchone()
        if role == owner:
            raise ValueError("The runtime role must not be the owner role.")
        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role])
        verb = "ALTER" if cursor.fetchone() else "CREATE"
        cursor.execute(sql.SQL(
            "{} ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD {}"
        ).format(sql.SQL(verb), ident, sql.Literal(password)))
        statements = [
            sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(database)),
            sql.SQL("GRANT CONNECT, TEMPORARY ON DATABASE {} TO {}").format(sql.Identifier(database), ident),
            sql.SQL("REVOKE CREATE ON SCHEMA public FROM PUBLIC"),
            sql.SQL("REVOKE ALL ON SCHEMA public FROM {}").format(ident),
            sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(ident),
            sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {}").format(ident),
            sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}").format(ident),
            sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(ident),
            sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}").format(
                sql.Identifier(owner), ident),
            sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {}").format(
                sql.Identifier(owner), ident),
        ]
        for table in APPEND_ONLY_TABLES:
            cursor.execute("SELECT to_regclass(%s)", [f"public.{table}"])
            if cursor.fetchone()[0] is not None:
                statements.append(sql.SQL("REVOKE DELETE, TRUNCATE ON {} FROM {}").format(sql.Identifier(table), ident))
        for statement in statements:
            cursor.execute(statement)
    return f"{'created' if verb == 'CREATE' else 'updated'} role {role}: row access only, owner {owner}, database {database}"
