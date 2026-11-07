"""Migration operations that are safe on a live table (review ARC-04 / DB-07)."""
from django.db import migrations


class AddCheckNotValid(migrations.AddConstraint):
    """Add a CHECK constraint without a long lock: ``ADD ... NOT VALID`` (enforced for every new write at once, no table scan), then
    ``VALIDATE`` (scans without blocking writes). If existing rows already break it, the constraint is left NOT VALID with a warning
    rather than stopping the deploy: it still refuses new bad rows, and ``select conname from pg_constraint where not convalidated``
    lists the ones to clean up. Use it in a migration with ``atomic = False`` so the two statements do not share one lock."""

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name_lower)
        if not self.allow_migrate_model(schema_editor.connection.alias, model):
            return
        qn = schema_editor.quote_name
        table, name = qn(model._meta.db_table), qn(self.constraint.name)
        schema_editor.execute(f"ALTER TABLE {table} ADD {self.constraint.constraint_sql(model, schema_editor)} NOT VALID")
        schema_editor.execute(
            "DO $$ BEGIN "
            f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}; "
            "EXCEPTION WHEN check_violation THEN "
            f"RAISE WARNING 'constraint %% left NOT VALID: existing rows break it', '{self.constraint.name}'; "
            "END $$"
        )
