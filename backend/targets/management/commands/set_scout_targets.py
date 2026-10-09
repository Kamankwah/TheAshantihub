"""Set scouts' daily targets from the command line (staging, until the
Operations targets editor lands). Nothing is defaulted: the operator types
every value. The limits Super Admin has set still apply."""
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import StaffUser
from activity.services import record
from targets import plans
from targets.models import METRICS


class Command(BaseCommand):
    help = "Set the daily targets of one or more staff members, e.g. --staff kwame@x.com --registrations 1 --visits 6 --calls 10 --renewals 1 --set-by ama@x.com"

    def add_arguments(self, parser):
        parser.add_argument("--staff", action="append", default=[], help="Staff email (repeatable)")
        parser.add_argument("--all-scouts", action="store_true", help="Every active scout")
        parser.add_argument("--set-by", required=True, help="Email of the Operations lead or Super Admin on record")
        parser.add_argument("--effective-from", help="YYYY-MM-DD (default: today)")
        parser.add_argument("--dry-run", action="store_true")
        for metric in METRICS:
            parser.add_argument(f"--{metric}", type=int, help=f"Daily {metric} target")

    def handle(self, *args, **opts):
        values = {m: opts[m] for m in METRICS if opts[m] is not None}
        if not values:
            raise CommandError("Give at least one of --" + ", --".join(METRICS) + ".")
        if not opts["staff"] and not opts["all_scouts"]:
            raise CommandError("Name the people with --staff EMAIL, or use --all-scouts.")
        try:
            set_by = StaffUser.objects.get(email__iexact=opts["set_by"], is_active=True)
            values = plans.clean_values(values)
            plans.check_limits(values)
            effective_from = date.fromisoformat(opts["effective_from"]) if opts["effective_from"] else timezone.localdate()
        except StaffUser.DoesNotExist:
            raise CommandError(f"No active staff member {opts['set_by']}.") from None
        except (plans.PlanError, ValueError) as exc:
            raise CommandError(getattr(exc, "message", str(exc))) from None

        staff = list(StaffUser.objects.filter(is_active=True, role__name="scout")) if opts["all_scouts"] else []
        for email in opts["staff"]:
            try:
                staff.append(StaffUser.objects.get(email__iexact=email, is_active=True))
            except StaffUser.DoesNotExist:
                raise CommandError(f"No active staff member {email}.") from None
        staff = list({s.pk: s for s in staff}.values())
        if not staff:
            raise CommandError("No staff to set targets for.")

        for member in staff:
            self.stdout.write(f"{member.full_name} <{member.email}>: " + ", ".join(f"{m} {v}/day" for m, v in sorted(values.items())) + f" from {effective_from}")
        if opts["dry_run"]:
            self.stdout.write("Dry run: nothing written.")
            return
        with transaction.atomic():
            for member in staff:
                plans.write_plans(member, values, effective_from, set_by)
                record(set_by, "targets.plan_set", target=member, after={"values": values, "effective_from": effective_from.isoformat(), "via": "set_scout_targets"})
        self.stdout.write(self.style.SUCCESS(f"Set targets for {len(staff)} staff."))
