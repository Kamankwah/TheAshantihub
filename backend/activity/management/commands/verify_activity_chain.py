import logging

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError

from accounts.models import StaffUser
from activity.models import ActivityEvent
from activity.services import GENESIS, verify_chain

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Re-verify the activity-log hash chain; with --email-seal, email the result to every active Super Admin."

    def add_arguments(self, parser):
        parser.add_argument("--email-seal", action="store_true")

    def handle(self, *args, **options):
        ok, broken_id = verify_chain()
        last = ActivityEvent.objects.order_by("-id").first()
        count = ActivityEvent.objects.count()
        if ok:
            seal = f"OK · {count} events · last #{last.pk if last else 0} · {last.hash if last else GENESIS}"
        else:
            seal = f"BROKEN at event #{broken_id} · {count} events"
            logger.error("Activity chain broken at event %s", broken_id)
        if options["email_seal"]:
            recipients = list(
                StaffUser.objects.filter(role__name="super_admin", is_active=True, is_suspended=False).values_list("email", flat=True)
            )
            if not recipients:
                logger.warning("No active Super Admin to receive the activity seal")
            else:
                send_mail(
                    "AshantiHub activity seal",
                    f"{seal}\n\nKeep this email: it lets you prove later that the activity log was not rewritten.",
                    settings.DEFAULT_FROM_EMAIL,
                    recipients,
                )
        if not ok:
            raise CommandError(seal)
        self.stdout.write(seal)
