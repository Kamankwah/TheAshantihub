from django.core.management.base import BaseCommand
from django.db import transaction

from core import pii

# (app_label, model, field): every column that holds personal data encrypted at rest (review DB-03).
# Blind indexes are rebuilt by the models' own save(); here they are written alongside through the same helper.
TARGETS = (
    ("accounts", "BusinessOwnerProfile", "ghana_card_number"),
    ("accounts", "BusinessOwnerProfile", "tin"),
    ("accounts", "BusinessOwnerProfile", "payout_bank_account_number"),
    ("accounts", "BusinessOwnerProfile", "payout_momo_number"),
    ("accounts", "Customer", "date_of_birth"),
    ("wallets", "PayoutDestination", "account_number"),
    ("delivery", "RiderDocument", "number"),
)


class Command(BaseCommand):
    help = (
        "Encrypt personal data that is still stored in plaintext, and fill the blind indexes (review DB-03). Idempotent and safe "
        "to interrupt; deploy.sh runs it after every migrate. --reencrypt rewrites every value under the newest key "
        "(after adding a key to the front of PII_ENCRYPTION_KEYS)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--reencrypt", action="store_true", help="rewrite already-encrypted values under the newest key too")
        parser.add_argument("--dry-run", action="store_true", help="count what would change, write nothing")

    def handle(self, *args, **options):
        from django.apps import apps

        reencrypt, dry = options["reencrypt"], options["dry_run"]
        total = 0
        for app_label, model_name, field in TARGETS:
            model = apps.get_model(app_label, model_name)
            rows = model.objects.exclude(**{f"{field}__isnull": True})
            if not reencrypt:
                rows = rows.exclude(**{f"{field}__startswith": pii.PREFIX})  # startswith is not guarded: it sees the raw column
            indexes = getattr(model, "BLIND_INDEXES", {})
            count = 0
            for pk in list(rows.values_list("pk", flat=True)):
                with transaction.atomic():
                    value = model.objects.select_for_update().filter(pk=pk).values_list(field, flat=True).first()
                    if value in (None, ""):
                        continue
                    if not dry:
                        # update() writes through the field (encrypting) and touches nothing else: no save() side effects.
                        changes = {field: value}
                        if field in indexes:
                            purpose, index_field = indexes[field]
                            changes[index_field] = pii.blind_index(purpose, value)
                        model.objects.filter(pk=pk).update(**changes)
                    count += 1
            total += count
            self.stdout.write(f"{app_label}.{model_name}.{field}: {count} {'would be ' if dry else ''}encrypted")
        self.stdout.write(self.style.SUCCESS(f"{total} value(s) {'to encrypt' if dry else 'encrypted'}."))
