import json

from django.core.management.base import BaseCommand, CommandError

from accounts import hours
from accounts.models import BusinessOwner


class Command(BaseCommand):
    help = (
        "Set a business's weekly opening hours when it has none (a scout-registered business that cannot be claimed "
        "without them). Pass the business id and a JSON list of seven days: "
        '[{"weekday": 0, "closed": false, "opens": "08:00", "closes": "18:00"}, ...]. '
        "Refuses a business that already has hours unless --replace."
    )

    def add_arguments(self, parser):
        parser.add_argument("business", help="BusinessOwner id")
        parser.add_argument("week", help="JSON list of seven days, or @path/to/file.json")
        parser.add_argument("--replace", action="store_true", help="overwrite hours the business already has")

    def handle(self, *args, **options):
        try:
            owner = BusinessOwner.objects.get(pk=int(options["business"]))
        except (ValueError, BusinessOwner.DoesNotExist):
            raise CommandError(f"No business with id {options['business']}.")
        raw = options["week"]
        try:
            if raw.startswith("@"):
                with open(raw[1:], encoding="utf-8") as handle:
                    raw = handle.read()
            days = json.loads(raw)
        except (OSError, ValueError) as exc:
            raise CommandError(f"Could not read the week: {exc}")
        if not isinstance(days, list) or not all(isinstance(d, dict) for d in days):
            raise CommandError("The week must be a JSON list of seven day objects.")
        try:
            hours.validate_week(days)
        except hours.HoursError as exc:
            raise CommandError(str(exc))
        if hours.has_hours(owner) and not options["replace"]:
            raise CommandError(f"{owner.full_name} already has opening hours; pass --replace to overwrite them.")
        hours.set_week(owner, days)
        self.stdout.write(f"Opening hours set for {owner.full_name} (id {owner.id}).")
