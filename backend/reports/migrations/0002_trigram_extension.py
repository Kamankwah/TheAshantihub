from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations


class Migration(migrations.Migration):
    # The copy check (reports.services.narrative_similarity) uses pg_trgm's
    # similarity(); pg_trgm is a trusted extension on Postgres 13+.
    dependencies = [("reports", "0001_initial")]
    operations = [TrigramExtension()]
