"""manage.py propose_catalogue_matches [--dry-run] — the catalogue backfill (catalogue plan 6): file a grouping request
for every ungrouped product or food listing whose barcode equals a catalogue entry's. Staff decide each request in the
catalogue queue; this never groups anything. Safe to run again."""
from django.core.management.base import BaseCommand

from catalogue import attach


class Command(BaseCommand):
    help = "File grouping requests for listings whose barcode matches a catalogue product. Never groups anything."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count the requests without filing them.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        filed = attach.propose_barcode_matches(dry_run=dry_run)
        self.stdout.write(
            f"{filed} grouping request{'' if filed == 1 else 's'} {'would be filed' if dry_run else 'filed'}."
        )
