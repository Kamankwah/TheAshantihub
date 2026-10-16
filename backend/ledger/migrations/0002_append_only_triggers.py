from django.db import migrations

FORWARD = """
CREATE FUNCTION ledger_refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ledger journal rows are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_journal_append_only BEFORE UPDATE OR DELETE ON ledger_journal
    FOR EACH ROW EXECUTE FUNCTION ledger_refuse_change();
CREATE TRIGGER ledger_journalline_append_only BEFORE UPDATE OR DELETE ON ledger_journalline
    FOR EACH ROW EXECUTE FUNCTION ledger_refuse_change();
"""
REVERSE = """
DROP TRIGGER ledger_journalline_append_only ON ledger_journalline;
DROP TRIGGER ledger_journal_append_only ON ledger_journal;
DROP FUNCTION ledger_refuse_change();
"""


class Migration(migrations.Migration):
    dependencies = [("ledger", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
