from django.core.management.base import BaseCommand

from accounts.models import BusinessHours, BusinessOwner


class Command(BaseCommand):
    help = "List businesses that have not entered weekly opening hours, so Support can chase them. Read-only."

    def handle(self, *args, **options):
        with_hours = BusinessHours.objects.values("business_owner_id")
        missing = BusinessOwner.objects.exclude(pk__in=with_hours).order_by("id")
        for owner in missing:
            self.stdout.write(f"{owner.id}\t{owner.full_name}\t{owner.login_phone}\t{owner.kyc_status}")
        self.stdout.write(f"{missing.count()} business(es) without opening hours.")
