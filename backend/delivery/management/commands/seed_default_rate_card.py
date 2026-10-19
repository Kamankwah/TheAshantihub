from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from delivery.models import RateCard

# Suggested figures (GH₵), owner decision 2026-10-18; a Super Admin changes them through the rate card's approval.
SUGGESTED = {
    "customer_base": Decimal("5.00"), "customer_per_km": Decimal("1.50"), "customer_min_fee": Decimal("8.00"),
    "rider_per_job": Decimal("4.00"), "rider_per_km": Decimal("1.00"),
}


class Command(BaseCommand):
    help = "Create the suggested live delivery rate card when none is in force. Safe to run twice. Charges nothing until DELIVERY_FEE_ENABLED is on."

    @transaction.atomic
    def handle(self, *args, **options):
        if RateCard.objects.filter(status=RateCard.LIVE).exists():
            self.stdout.write("A live rate card already exists; nothing changed.")
            return
        version = (RateCard.objects.aggregate(top=Max("version"))["top"] or 0) + 1
        card = RateCard.objects.create(
            version=version, status=RateCard.LIVE, effective_at=timezone.now(), note="Suggested defaults (owner, 2026-10-18)", **SUGGESTED,
        )
        self.stdout.write(f"Created live rate card v{card.version}.")
