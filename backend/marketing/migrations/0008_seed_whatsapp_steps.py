from django.db import migrations

# The WhatsApp setup checklist (Meta Cloud API). Steps start "to do"; only a person who did one ticks it.
STEPS = [
    ("Meta business account", "AshantiHub's own account with Meta"),
    ("Business verification", "documents sent to Meta, which reviews them"),
    ("Phone number", "a dedicated AshantiHub number: not the support line, never a business's"),
    ("Display name", "\"AshantiHub\" approved by Meta"),
    ("Payment method", "a card on the Meta account, added by Accounting"),
    ("Templates", "each marketing template reviewed and approved by Meta (see Templates)"),
    ("Opt-in wording", "names AshantiHub and offers WhatsApp opt-in"),
]


def seed(apps, schema_editor):
    Step = apps.get_model("marketing", "ProviderStep")
    for i, (title, detail) in enumerate(STEPS, start=1):
        Step.objects.get_or_create(provider="whatsapp", position=i, defaults={"title": title, "detail": detail})


class Migration(migrations.Migration):
    dependencies = [("marketing", "0007_campaigns_templates_sender_ids")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
