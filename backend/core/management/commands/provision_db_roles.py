import os

from django.core.management.base import BaseCommand, CommandError

from core import db_roles


class Command(BaseCommand):
    help = (
        "Create/update the non-superuser runtime database role and grant it row access (review DB-05). Run as the OWNER role "
        "(deploy.sh does, after migrate) with POSTGRES_APP_USER and POSTGRES_APP_PASSWORD set. Safe to repeat."
    )

    def handle(self, *args, **options):
        role = os.environ.get("POSTGRES_APP_USER", "")
        password = os.environ.get("POSTGRES_APP_PASSWORD", "")
        try:
            self.stdout.write(self.style.SUCCESS(db_roles.provision(role, password)))
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
