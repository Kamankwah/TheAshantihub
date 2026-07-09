from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError

from accounts.models import Role, StaffUser


class Command(BaseCommand):
    help = "Bootstraps the first super_admin StaffUser (invited_by is null for this one account only)."

    def add_arguments(self, parser):
        parser.add_argument("--full-name", required=True)
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=True)

    def handle(self, *args, **options):
        if StaffUser.objects.filter(role__name="super_admin").exists():
            raise CommandError("A super_admin already exists; use the invite endpoint instead.")

        role = Role.objects.get(name="super_admin")
        StaffUser.objects.create(
            full_name=options["full_name"],
            email=options["email"],
            password_hash=make_password(options["password"]),
            role=role,
            invited_by=None,
        )
        self.stdout.write(self.style.SUCCESS(f"Created super_admin {options['email']}"))
