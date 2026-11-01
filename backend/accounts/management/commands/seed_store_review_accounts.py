from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from listings.models import Category, Listing, Zone

LISTINGS = [("Hand-woven kente stole", "450.00"), ("Adinkra stamped cloth", "180.00")]


class Command(BaseCommand):
    help = (
        "Create (or reset the passwords of) one customer and one verified business owner with two live listings, "
        "for Apple and Google app review. Safe to re-run. It never changes any OTP setting."
    )

    def add_arguments(self, parser):
        parser.add_argument("--customer-phone", required=True)
        parser.add_argument("--customer-password", required=True)
        parser.add_argument("--owner-phone", required=True)
        parser.add_argument("--owner-password", required=True)

    def handle(self, *args, **options):
        customer, _ = Customer.objects.update_or_create(
            phone=options["customer_phone"],
            defaults={"full_name": "Store Review Customer", "password_hash": make_password(options["customer_password"])},
        )
        owner, _ = BusinessOwner.objects.update_or_create(
            login_phone=options["owner_phone"],
            defaults={
                "full_name": "Store Review Business",
                "password_hash": make_password(options["owner_password"]),
                "kyc_status": BusinessOwner.VERIFIED,
            },
        )
        BusinessOwnerProfile.objects.update_or_create(
            business_owner=owner,
            defaults={
                "business_name": "Store Review Shop",
                "gps_address": "AK-039-5028",
                "business_contact_phone": options["owner_phone"],
                "business_kind": "product",
                "payout_momo_network": "MTN",
                "payout_momo_number": options["owner_phone"],
                "payout_momo_name": "Store Review Business",
                "terms_accepted_at": timezone.now(),
                "address_verified": True,
                "identity_status": BusinessOwnerProfile.IDENTITY_VERIFIED,
                "lat": Decimal("6.688500"),
                "lng": Decimal("-1.624400"),
            },
        )
        category = Category.objects.filter(kind="product").first()
        zone = Zone.objects.get(name="Manhyia")
        for name, price in LISTINGS:
            Listing.objects.update_or_create(
                business_owner=owner, name=name,
                defaults={
                    "category": category, "zone": zone, "description": "Demo listing for store review.",
                    "contact_phone": options["owner_phone"], "price_amount": price, "status": Listing.PUBLISHED,
                },
            )
        self.stdout.write(f"Customer: {customer.phone}  Business owner: {owner.login_phone}")
