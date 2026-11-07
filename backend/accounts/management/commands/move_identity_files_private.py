"""Move identity documents out of the publicly served media folder into private storage (review BE-01).

Everything under MEDIA_ROOT/ghana_cards/ and MEDIA_ROOT/business_reg_certificates/ moves to the same relative path under
PRIVATE_MEDIA_ROOT/kyc/, which is where the model fields now look, so no database row changes. Orphans (files an old
replacement left behind) are moved too: they are identity documents just the same. Safe to run again; it never overwrites
a file already in private storage and never deletes anything it has not first written. Run it once per environment right
after the deploy that ships the new storage, then confirm `--check` reports nothing left.
"""
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from accounts.models import BusinessOwnerProfile
from core.private_files import kyc_storage

FOLDERS = ("ghana_cards", "business_reg_certificates")
FIELDS = ("ghana_card_front_image", "ghana_card_back_image", "business_reg_certificate")


class Command(BaseCommand):
    help = "Move identity documents from public media to private storage."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would move; change nothing.")
        parser.add_argument("--check", action="store_true", help="Exit non-zero if any identity file is still public.")

    def handle(self, *args, dry_run=False, check=False, **options):
        media = Path(settings.MEDIA_ROOT)
        storage = kyc_storage()
        moved = skipped_existing = 0
        left = []
        for folder in FOLDERS:
            source_dir = media / folder
            if not source_dir.is_dir():
                continue
            for source in sorted(p for p in source_dir.rglob("*") if p.is_file()):
                name = source.relative_to(media).as_posix()
                target = Path(storage.path(name))
                if target.exists():
                    skipped_existing += 1
                    left.append(name)
                    self.stderr.write(f"Already in private storage, public copy left for review: {name}")
                    continue
                if dry_run or check:
                    left.append(name)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                if not target.exists() or target.stat().st_size != source.stat().st_size:
                    raise SystemExit(f"Copy of {name} did not verify; the public file was kept.")
                source.unlink()
                moved += 1
        missing = 0
        for profile in BusinessOwnerProfile.objects.all().only("id", *FIELDS):
            for field in FIELDS:
                value = getattr(profile, field)
                if value and not storage.exists(value.name) and not (dry_run or check) and not (media / value.name).exists():
                    missing += 1
        self.stdout.write(
            f"moved={moved} public_left={len(left)} duplicates={skipped_existing} rows_pointing_at_missing_files={missing}"
            + (" (dry run)" if dry_run else "")
        )
        if check and left:
            raise SystemExit(f"{len(left)} identity file(s) are still publicly served.")
