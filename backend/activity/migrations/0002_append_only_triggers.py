from django.db import migrations

FORWARD = """
CREATE OR REPLACE FUNCTION activity_event_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'activity_activityevent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_event_no_update
    BEFORE UPDATE OR DELETE ON activity_activityevent
    FOR EACH ROW EXECUTE FUNCTION activity_event_immutable();
"""

REVERSE = """
DROP TRIGGER IF EXISTS activity_event_no_update ON activity_activityevent;
DROP FUNCTION IF EXISTS activity_event_immutable();
"""


class Migration(migrations.Migration):
    # No TRUNCATE trigger on purpose: Django's TransactionTestCase flushes
    # with TRUNCATE. Truncation is caught instead by the nightly seal
    # (verify_activity_chain --email-seal) going off-server.
    dependencies = [("activity", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
