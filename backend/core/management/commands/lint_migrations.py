"""``manage.py lint_migrations [--base origin/main]``: check the migration files added since ``base`` (review ARC-04).
Exits non-zero on a problem, so CI and the deploy gate can stop a migration that is not safe to run while the previous
release is still serving. See ``core.migration_lint`` for the rules and the ``# lint-migrations: ok`` escape."""
import subprocess
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.migration_lint import lint_source


class Command(BaseCommand):
    help = "Flag newly added migrations that are unsafe for a rolling deploy or a rollback."

    def add_arguments(self, parser):
        parser.add_argument("--base", default="origin/main", help="git ref to compare against")
        parser.add_argument("files", nargs="*", help="check these migration files instead of the git diff")

    def handle(self, *args, **options):
        files = options["files"] or self.added_since(options["base"])
        failed = 0
        for path in files:
            for lineno, op, message in lint_source(Path(path).read_text()):
                failed += 1
                self.stderr.write(f"{path}:{lineno}: {op} {message}")
        self.stdout.write(f"{len(files)} migration file(s) checked, {failed} problem(s).")
        if failed:
            raise CommandError("Unsafe migration(s). Fix them or mark a reviewed one with '# lint-migrations: ok <reason>'.")

    @staticmethod
    def added_since(base):
        root = Path(settings.BASE_DIR).parent
        try:
            out = subprocess.run(
                ["git", "-C", str(root), "diff", "--name-only", "--diff-filter=A", f"{base}...HEAD", "--", "backend/*/migrations/*.py"],
                capture_output=True, text=True, check=True,
            ).stdout
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            raise CommandError(f"cannot list new migrations against {base}: {exc}") from exc
        return [str(root / line) for line in out.splitlines() if line and not line.endswith("__init__.py")]
