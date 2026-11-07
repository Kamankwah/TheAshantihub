from django.db import migrations

# A journal must balance, enforced where the application cannot get round it (review DB-06): a constraint trigger, checked at
# COMMIT, refuses a transaction that leaves any journal with credits != debits. Deferred, because a journal's lines are inserted
# one by one and only the finished set has to balance. Only new rows are checked, so existing data cannot make this fail.
FORWARD = """
CREATE FUNCTION ledger_journal_must_balance() RETURNS trigger AS $$
DECLARE
    net bigint;
BEGIN
    SELECT COALESCE(SUM(CASE side WHEN 'credit' THEN amount ELSE -amount END), 0) INTO net
        FROM ledger_journalline WHERE journal_id = NEW.journal_id;
    IF net <> 0 THEN
        RAISE EXCEPTION 'ledger journal % does not balance (net % pesewas)', NEW.journal_id, net
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_journal_balanced
    AFTER INSERT ON ledger_journalline
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION ledger_journal_must_balance();
"""
REVERSE = """
DROP TRIGGER ledger_journal_balanced ON ledger_journalline;
DROP FUNCTION ledger_journal_must_balance();
"""


class Migration(migrations.Migration):
    dependencies = [("ledger", "0014_fulfilmentcheck_code_attempts_and_more")]
    # lint-migrations: ok trigger on a table only the posting code writes; a brief SHARE ROW EXCLUSIVE lock, no rewrite
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
