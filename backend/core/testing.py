"""Helpers for tests only."""
from django.db import connection


def drop_check(table, name):
    """Remove one CHECK constraint for the rest of this test (a TestCase rolls the DDL back), so a test can build the impossible row
    that defensive code is written for - e.g. a negative price that the database would otherwise refuse (review DB-07)."""
    with connection.cursor() as cursor:
        cursor.execute("set constraints all immediate")  # ALTER TABLE refuses while deferred FK checks are pending
        cursor.execute(f'alter table "{table}" drop constraint "{name}"')
