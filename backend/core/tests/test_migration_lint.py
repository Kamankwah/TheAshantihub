from django.test import SimpleTestCase

from core.migration_lint import lint_source

HEAD = "from django.db import migrations, models\nclass Migration(migrations.Migration):\n    operations = [\n"


def ops(body):
    return lint_source(HEAD + body + "\n    ]\n")


class MigrationLintTests(SimpleTestCase):
    def kinds(self, body):
        return [p[1] for p in ops(body)]

    def test_adding_a_nullable_or_defaulted_column_is_fine(self):
        self.assertEqual(self.kinds("migrations.AddField(model_name='a', name='b', field=models.CharField(max_length=5, default=''))"), [])
        self.assertEqual(self.kinds("migrations.AddField(model_name='a', name='b', field=models.IntegerField(null=True))"), [])

    def test_a_not_null_column_without_a_default_is_flagged(self):
        self.assertEqual(self.kinds("migrations.AddField(model_name='a', name='b', field=models.IntegerField())"), ["AddField"])

    def test_removals_renames_and_alters_are_flagged(self):
        for op in ("RemoveField(model_name='a', name='b')", "DeleteModel(name='a')", "RenameField(model_name='a', old_name='b', new_name='c')",
                   "AlterField(model_name='a', name='b', field=models.TextField())", "RunSQL('select 1')"):
            self.assertEqual(len(ops("migrations." + op)), 1, op)

    def test_indexes_and_constraints_are_flagged_for_review(self):
        self.assertEqual(self.kinds("migrations.AddIndex(model_name='a', index=models.Index(fields=['b'], name='i'))"), ["AddIndex"])

    def test_a_reviewed_exception_passes(self):
        self.assertEqual(ops("        # lint-migrations: ok table has 40 rows\n        migrations.RemoveField(model_name='a', name='b')"), [])

    def test_the_existing_order_request_id_migration_is_clean(self):
        from pathlib import Path

        import orders

        path = Path(orders.__file__).parent / "migrations" / "0013_order_request_id.py"
        # AddConstraint is flagged for review; nothing else may be.
        self.assertEqual({p[1] for p in lint_source(path.read_text())}, {"AddConstraint"})
