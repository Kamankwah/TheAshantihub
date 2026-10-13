from django.db import migrations

# The words a person agrees to. They name AshantiHub, say how to stop, and are kept as versions: a
# change is a new version, and every consent record keeps the words its person saw. These are
# configuration, not consent: the ledger itself starts empty.
CUSTOMER_WORDS = {
    "sms": ("sms-offers", "Send me offers from AshantiHub by SMS. I can stop any time with the link in each message."),
    "whatsapp": ("whatsapp-offers", "Send me offers from AshantiHub on WhatsApp. I can stop any time."),
    "email": ("email-offers", "Email me offers and news from AshantiHub. Every email has an unsubscribe link."),
    "inapp": ("inapp-offers", "Show me offers from AshantiHub in the app. I can turn this off in my settings."),
}
BUSINESS_WORDS = {
    "sms": ("business-sms", "Send me news and offers for my business from AshantiHub by SMS. I can stop any time with the link in each message."),
    "whatsapp": ("business-whatsapp", "Send me news and offers for my business from AshantiHub on WhatsApp. I can stop any time."),
    "email": ("business-email", "Email me news and offers for my business from AshantiHub. Every email has an unsubscribe link."),
    "inapp": ("business-inapp", "Show me news and offers for my business from AshantiHub in my dashboard. I can turn this off in my settings."),
}

# Append-only, enforced where the application cannot get round it: a database trigger refuses any
# UPDATE or DELETE of a consent record (TRUNCATE is left alone on purpose, as for the activity log:
# Django's test flush uses it).
FORWARD = """
CREATE OR REPLACE FUNCTION marketing_consent_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'marketing_consentrecord is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketing_consent_no_change
    BEFORE UPDATE OR DELETE ON marketing_consentrecord
    FOR EACH ROW EXECUTE FUNCTION marketing_consent_immutable();
"""
REVERSE = """
DROP TRIGGER IF EXISTS marketing_consent_no_change ON marketing_consentrecord;
DROP FUNCTION IF EXISTS marketing_consent_immutable();
"""


def seed(apps, schema_editor):
    Wording = apps.get_model("marketing", "ConsentWording")
    for audience, words in (("customer", CUSTOMER_WORDS), ("business_owner", BUSINESS_WORDS)):
        for channel, (code, text) in words.items():
            Wording.objects.get_or_create(code=code, version=1, defaults={"channel": channel, "audience": audience, "text": text})


def unseed(apps, schema_editor):
    apps.get_model("marketing", "ConsentWording").objects.filter(version=1, records__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("marketing", "0002_consent_and_segments")]
    operations = [migrations.RunSQL(FORWARD, REVERSE), migrations.RunPython(seed, unseed)]
