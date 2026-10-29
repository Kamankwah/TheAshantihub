"""Create Ashanti Direct, the company's own shop, once (safe to run again).

The phone and email come from the environment (ASHANTI_DIRECT_PHONE, ASHANTI_DIRECT_EMAIL); with either blank this stops
and creates nothing. The password is unusable: a Super Admin sets it afterwards with the normal password flow, and
Operations never holds it, so wallet withdrawals follow the ordinary holder flow.

The company's shop has no Ghana Card to upload, so its identity is verified by the system (identity_status verified,
identity_reviewed_at set, no reviewer): it keeps the public check mark, featured eligibility and payout-name matching.
A run against an existing Direct whose identity is not verified sets it again."""
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts import direct, phones
from accounts.models import BusinessOwner, BusinessOwnerProfile

NAME = "Ashanti Direct"


class Command(BaseCommand):
    help = "Creates Ashanti Direct, the company business run by Operations, if it does not exist."

    def handle(self, *args, **options):
        try:
            existing = direct.ashanti_direct()
        except LookupError:
            existing = None
        if existing is not None:
            if self._verify_identity(existing):
                self.stdout.write(f"Ashanti Direct already exists (id {existing.pk}); its identity is now verified by the system.")
            else:
                self.stdout.write(f"Ashanti Direct already exists (id {existing.pk}); nothing changed.")
            return
        raw_phone = (settings.ASHANTI_DIRECT_PHONE or "").strip()
        email = (settings.ASHANTI_DIRECT_EMAIL or "").strip()
        if not raw_phone or not email:
            raise CommandError(
                "Set ASHANTI_DIRECT_PHONE and ASHANTI_DIRECT_EMAIL (the company's own number and address) first."
            )
        try:
            phone = phones.normalize_gh_phone(raw_phone)
        except ValueError as exc:
            raise CommandError(f"ASHANTI_DIRECT_PHONE: {exc}") from None
        if phones.filter_by_phone(BusinessOwner.objects.all(), "login_phone", phone).exists() or BusinessOwner.objects.filter(email=email).exists():
            raise CommandError("A business already uses that phone or email; choose the company's own.")
        with transaction.atomic():
            owner = BusinessOwner.objects.create(
                full_name=NAME, login_phone=phone, email=email, password_hash=make_password(None),
                kyc_status=BusinessOwner.VERIFIED, reviewed_at=timezone.now(), is_company=True,
            )
            BusinessOwnerProfile.objects.create(
                business_owner=owner, business_name=NAME, business_contact_phone=phone,
                business_kind=BusinessOwnerProfile.PRODUCT,
                identity_status=BusinessOwnerProfile.IDENTITY_VERIFIED, identity_reviewed_at=timezone.now(),
            )
        self.stdout.write(self.style.SUCCESS(
            f"Created Ashanti Direct (id {owner.pk}), verified by the system. A Super Admin must set its password."
        ))

    @staticmethod
    def _verify_identity(owner):
        """Mark an existing Direct's identity verified by the system; False when it already was (idempotent)."""
        with transaction.atomic():
            updated = BusinessOwnerProfile.objects.filter(business_owner=owner).exclude(
                identity_status=BusinessOwnerProfile.IDENTITY_VERIFIED
            ).update(
                identity_status=BusinessOwnerProfile.IDENTITY_VERIFIED, identity_reviewed_at=timezone.now(),
                identity_reviewed_by=None, identity_rejection_reason=None,
            )
        return bool(updated)
