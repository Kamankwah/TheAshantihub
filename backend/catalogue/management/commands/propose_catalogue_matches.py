"""manage.py propose_catalogue_matches [--apply] [--batch-size N] — the catalogue backfill (catalogue plan 6): file a
grouping request for every ungrouped, published product or food listing whose barcode equals a catalogue entry's. Staff
decide each request in the catalogue queue; this never groups anything. A DRY RUN unless --apply is given. Safe to run
again."""
from django.core.management.base import BaseCommand

from catalogue import attach


class Command(BaseCommand):
    help = "File grouping requests for listings whose barcode matches a catalogue product (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="File the requests (without it, only count them).")
        parser.add_argument("--batch-size", type=int, default=attach.BATCH_SIZE, help="Listings per chunk (default 500).")

    def handle(self, *args, **options):
        apply = options["apply"]
        stats = {}
        attach.propose_barcode_matches(dry_run=not apply, batch_size=max(1, options["batch_size"]), stats=stats)
        filed = stats["filed"]
        self.stdout.write(
            f"{filed} grouping request{'' if filed == 1 else 's'} {'filed' if apply else 'would be filed (dry run; use --apply)'}."
        )
        self.stdout.write(f"skipped {stats['skipped']}, raced {stats['raced']}, failed {stats['failed']}.")
