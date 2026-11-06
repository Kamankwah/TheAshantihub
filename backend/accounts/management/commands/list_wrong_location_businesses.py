from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import BusinessOwner
from listings.visibility import wrong_location_q


class Command(BaseCommand):
    help = (
        "Dry run: list the businesses whose location was marked wrong long enough ago to be hidden from public browse "
        "when WRONG_LOCATION_HIDE_ENABLED is on. Read-only; changes nothing."
    )

    def handle(self, *args, **options):
        now = timezone.now()
        owners = (
            BusinessOwner.objects.filter(wrong_location_q("", now=now))
            .select_related("profile").order_by("id")
        )
        for owner in owners:
            days = (now - owner.profile.address_verified_at).days
            self.stdout.write(f"{owner.id}\t{owner.display_name}\t{days} day(s) since the decision")
        state = "ON" if settings.WRONG_LOCATION_HIDE_ENABLED else "OFF"
        self.stdout.write(
            f"{len(owners)} business(es) would be hidden after {settings.WRONG_LOCATION_HIDE_DAYS} days "
            f"(the switch is {state}; nothing was changed)."
        )
