from django.db import migrations


class Migration(migrations.Migration):
    # Query visibility (review DB-09). The extension is only a catalogue entry here: it collects nothing until the server
    # preloads the library (`shared_preload_libraries=pg_stat_statements`, set in infra/compose/docker-compose.yml), so this is
    # harmless on a database that has not been restarted with it. Not a trusted extension: migrate runs as the owner.
    dependencies = [("core", "0007_sitesettings_pickup_office_address")]
    # lint-migrations: ok creates an extension only; touches no table
    operations = [migrations.RunSQL("CREATE EXTENSION IF NOT EXISTS pg_stat_statements", migrations.RunSQL.noop)]
