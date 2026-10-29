"""Print a fresh owner-confirmation link, for end-to-end testing where texts are simulated (staging).

Refuses unless OTP_SMS_PROVIDER is `simulated`: on a live provider the owner gets the text and no staff member ever sees
the link. The link goes to stdout only (never logged, never stored raw); the row keeps its hash like any other.
    manage.py owner_confirmation_link <business_owner_id> --staff <email>
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from accounts.claims import ClaimError
from accounts.models import BusinessOwner, StaffUser
from portfolio import confirmations


class Command(BaseCommand):
    help = "Issue a fresh registration + waiting-drafts confirmation link and print it (simulated texts only)."

    def add_arguments(self, parser):
        parser.add_argument("business_owner_id", type=int)
        parser.add_argument("--staff", required=True, help="Email of the staff member the link is issued as.")

    def handle(self, *args, **options):
        if getattr(settings, "OTP_SMS_PROVIDER", "simulated") != "simulated":
            raise CommandError(confirmations.NOT_SIMULATED)
        staff = StaffUser.objects.filter(email__iexact=options["staff"], is_active=True).first()
        if staff is None:
            raise CommandError(f"No active staff member has the email {options['staff']}.")
        owner = BusinessOwner.objects.filter(pk=options["business_owner_id"]).first()
        if owner is None:
            raise CommandError(f"No business owner has the id {options['business_owner_id']}.")
        try:
            link = confirmations.link_for_simulated_environment(owner, staff)
        except ClaimError as exc:
            raise CommandError(exc.message) from exc
        self.stdout.write(link)
