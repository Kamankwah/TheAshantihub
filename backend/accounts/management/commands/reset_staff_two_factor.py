from django.db import transaction
from django.core.management.base import BaseCommand, CommandError

from accounts import two_factor
from accounts.models import StaffUser
from accounts.emails import send_two_factor_changed_email
from activity.services import record


class Command(BaseCommand):
    help = (
        "Switch off a staffer's 2-step sign-in (they lost their phone and their recovery codes). "
        "A Super Admin sets it up again at the next sign-in. For the last resort only: "
        "a Super Admin can reset anyone else's from Sign-in & Security."
    )

    def add_arguments(self, parser):
        parser.add_argument("email")

    def handle(self, *args, **options):
        staff = StaffUser.objects.filter(email__iexact=options["email"].strip()).first()
        if staff is None:
            raise CommandError(f"No staff account with email {options['email']}")
        with transaction.atomic():
            two_factor.disable(staff)
            record(None, "staff.two_factor_reset", target=staff, summary="Reset from the server command line")
            transaction.on_commit(
                lambda: send_two_factor_changed_email(staff, "Your 2-step sign-in was reset from the server."),
                robust=True,
            )
        self.stdout.write(self.style.SUCCESS(f"2-step sign-in reset for {staff.email}"))
