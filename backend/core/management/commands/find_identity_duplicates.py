from django.db.models.functions import Lower
from django.core.management.base import BaseCommand
from django.db.models import Count

from accounts.models import BusinessOwner, Customer, StaffUser
from accounts.phones import phone_key_expression


class Command(BaseCommand):
    help = (
        "List accounts whose e-mail differs only by case, or whose phone is the same number written two ways (review DB-13). Read-only. "
        "The unique indexes that stop new ones are skipped by the migration while these exist; merge or fix them, then re-run migrate."
    )

    def handle(self, *args, **options):
        checks = (
            (Customer, "email", Lower("email")), (Customer, "phone", phone_key_expression("phone")),
            (BusinessOwner, "email", Lower("email")), (BusinessOwner, "login_phone", phone_key_expression("login_phone")),
            (StaffUser, "email", Lower("email")),
        )
        found = 0
        for model, field, key in checks:
            groups = (
                model.objects.exclude(**{f"{field}__isnull": True}).annotate(_key=key).values("_key")
                .annotate(n=Count("pk")).filter(n__gt=1).order_by("-n")
            )
            for group in groups:
                ids = list(model.objects.annotate(_key=key).filter(_key=group["_key"]).values_list("pk", flat=True))
                self.stdout.write(f"{model.__name__}.{field}: ids {ids} are the same {field.split('_')[-1]}")
                found += 1
        self.stdout.write(self.style.WARNING(f"{found} group(s) of duplicates.") if found else self.style.SUCCESS("No duplicates."))
