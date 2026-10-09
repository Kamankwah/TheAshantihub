"""Seed phase-2 demo data on staging: put the staging scout under the staging
Operations lead and give the scout four fictional businesses in four states
(KYC waiting with an approval request, healthy on a trial, overdue, paused).
With settings.SUBSCRIPTION_PAUSE_ENABLED off (the default) the fourth is
seeded overdue (20 days, no paused_at) instead of paused.

Everything is fictional and uses example.com emails and +2335500002xx phones,
like the staging demo store. Idempotent: rows are looked up by login phone.
Runs only with DEBUG on or when SENTRY_ENVIRONMENT is "staging" - never on
production data. The demo owners' password is passed with --password and is
never stored in the repository.
"""
import os
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, StaffUser
from accounts.permissions import can_lead_team
from approvals import services as approvals
from billing.models import Subscription, SubscriptionPlan
from portfolio.services import assign_account_manager

MIN_PASSWORD_LENGTH = 8

DEMO = [
    # phone, owner, business, kind, gps, state
    ("+233550000201", "Demo Gifty Asantewaa", "Demo · Asafo Hair & Beauty", "service", "AK-112-0384", "kyc_waiting"),
    ("+233550000202", "Demo Adwoa Frimpong", "Demo · Bantama Fabrics", "product", "AK-087-2210", "trial"),
    ("+233550000203", "Demo Kwaku Mensah", "Demo · Kejetia Phone Hub", "product", "AK-039-5128", "overdue"),
    ("+233550000204", "Demo Yaa Boatemaa", "Demo · Suame Spares", "product", "AK-412-0937", "paused"),
]


def _png():
    # A 1x1 PNG so the image fields hold a real image.
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82"
    )


class Command(BaseCommand):
    help = "Seed phase-2 demo businesses for the staging scout (staging/dev only)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Password for the demo owner accounts (at least 8 characters).")
        parser.add_argument("--scout-email", default="staging-scout@example.com")
        parser.add_argument("--operations-email", default="staging-admin@example.com")

    def handle(self, *args, **options):
        if not settings.DEBUG and os.environ.get("SENTRY_ENVIRONMENT") != "staging":
            raise CommandError("Refusing to run: only for DEBUG or SENTRY_ENVIRONMENT=staging.")
        password = options.get("password") or ""
        if len(password) < MIN_PASSWORD_LENGTH:
            raise CommandError(f"--password is required (at least {MIN_PASSWORD_LENGTH} characters).")
        try:
            scout = StaffUser.objects.get(email=options["scout_email"], role__name="scout")
            lead = StaffUser.objects.get(email=options["operations_email"], role__name="operations")
        except StaffUser.DoesNotExist as exc:
            raise CommandError("The staging scout and Operations accounts must exist first.") from exc
        if not can_lead_team(lead):
            raise CommandError(f"{lead.email} can't lead a team.")
        plan = SubscriptionPlan.objects.filter(status=SubscriptionPlan.ACTIVE_STATUS).order_by("monthly_price").first()

        with transaction.atomic():
            if scout.manager_id != lead.pk:
                scout.manager = lead
                scout.save(update_fields=["manager"])
            for phone, owner_name, business, kind, gps, state in DEMO:
                self._business(scout, plan, password, phone, owner_name, business, kind, gps, state)
        self.stdout.write(self.style.SUCCESS(f"Phase-2 demo data ready for {scout.email} under {lead.email}."))

    def _business(self, scout, plan, password, phone, owner_name, business, kind, gps, state):
        now = timezone.now()
        owner, created = BusinessOwner.objects.get_or_create(
            login_phone=phone,
            defaults={
                "full_name": owner_name,
                "email": f"{phone[-4:]}.demo@example.com",
                "password_hash": make_password(None) if state == "kyc_waiting" else make_password(password),
                "kyc_status": BusinessOwner.PENDING if state == "kyc_waiting" else BusinessOwner.VERIFIED,
                "registration_channel": BusinessOwner.SCOUT,
                "registered_by": scout,
                "claimed_at": None if state == "kyc_waiting" else now,
                "reviewed_at": None if state == "kyc_waiting" else now - timedelta(days=45),
            },
        )
        if not created:
            return
        profile = BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name=business, business_kind=kind, gps_address=gps,
            business_contact_phone=phone, lat="6.700000", lng="-1.620000", location_accuracy_m=12,
            location_set_by="scout", location_set_at=now, terms_accepted_at=None if state == "kyc_waiting" else now,
        )
        profile.signboard_photo.save(f"demo-{phone[-4:]}-signboard.png", ContentFile(_png()), save=False)
        profile.ghana_card_front_image.save(f"demo-{phone[-4:]}-card.png", ContentFile(_png()), save=False)
        profile.save()
        assign_account_manager(owner, scout, by=scout, reason="Demo data")
        if state == "kyc_waiting":
            approvals.submit(scout, "business.kyc", target=owner, title=f"New business · {business}",
                             payload={"business_owner_id": owner.pk, "business_name": business})
            return
        if plan is None:
            return
        end = {"trial": now + timedelta(days=20), "overdue": now - timedelta(days=5), "paused": now - timedelta(days=20)}[state]
        Subscription.objects.create(
            business_owner=owner, plan=plan, cycle_months=1, is_trial=(state == "trial"),
            current_period_start=end - timedelta(days=30), current_period_end=end,
            overdue_since=end if state in ("overdue", "paused") else None,
            overdue_notice_at=end if state in ("overdue", "paused") else None,
            paused_at=(end + timedelta(days=14)) if state == "paused" and settings.SUBSCRIPTION_PAUSE_ENABLED else None,
        )
