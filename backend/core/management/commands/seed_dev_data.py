"""Seed a local/dev database with sample accounts, listings and events.

Idempotent: every row is looked up by its natural key (email/phone/name)
before being created, so re-running is safe. It never touches production
seed data (roles, categories, zones, plans, pricing tiers all come from
migrations). The super_admin is NOT created here — use
`manage.py create_super_admin` for that (it enforces the single-bootstrap
rule).

Every seeded account shares the password below so a developer can log in
as any of them from the frontend.

Safety: refuses to run unless settings.DEBUG is True (same guard as
seed_staff_queues, no override flag). It creates staff with real money
permissions (e.g. an accountant holding escrow.release/escrow.refund) under
a password published in this file, so it must never run against staging or
production.
"""
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from accounts.models import (
    BusinessOwner,
    BusinessOwnerProfile,
    Customer,
    Role,
    StaffUser,
)
from billing.models import Subscription, SubscriptionPlan
from events.models import Event
from listings.models import Category, Listing, Zone

DEV_PASSWORD = "Password123!"

CUSTOMERS = [
    ("Ama Serwaa", "ama@example.com", "+233240000001"),
    ("Kofi Mensah", "kofi@example.com", "+233240000002"),
    ("Yaa Asantewaa", "yaa@example.com", "+233240000003"),
]

# One active, loggable staffer per office role, each holding exactly its role's
# migration-seeded permission set (no extra/revoked overrides) so the staff
# dashboard can be checked as every role. The field roles (scout, dispatch,
# delivery_manager) are seeded by `seed_staff_queues`, which also gives them
# queue rows; super_admin stays `create_super_admin`-only.
STAFF = [
    ("Akosua Support", "support@theashantihub.com", "support"),
    ("Kwame Admin", "admin.staff@theashantihub.com", "operations"),
    ("Yaw Accountant", "accountant.staff@theashantihub.com", "accountant"),
    ("Esi Marketing", "marketing.staff@theashantihub.com", "marketing"),
]

# (full_name, login_phone, email, business_kind, ghana_card, gps_address)
OWNERS = [
    ("Nana Osei", "+233200000001", "nana@example.com", "service", "GHA-000000001-1", "AK-039-5028"),
    ("Abena Boateng", "+233200000002", "abena@example.com", "product", "GHA-000000002-2", "AK-012-9911"),
    ("Kwabena Agyemang", "+233200000003", "kwabena@example.com", "service", "GHA-000000003-3", "AK-101-2234"),
    ("Efua Darko", "+233200000004", "efua@example.com", "product", "GHA-000000004-4", "AK-077-4410"),
]

# (owner_phone, category_slug, zone, name, description, price, unit, tag, lat, lng, extra)
LISTINGS = [
    ("+233200000001", "hotels", "Nhyiaeso", "Golden Tulip Kumasi City",
     "Four-star hotel with pool, restaurant and conference facilities in the heart of Kumasi.",
     "650.00", "per night", "Popular", "6.6803", "-1.6157",
     {"service_duration": "1 night", "whats_included": "Breakfast, Wi-Fi, pool access"}),
    ("+233200000001", "tours", "Manhyia", "Manhyia Palace Heritage Tour",
     "Guided walk through the seat of the Asantehene, the museum and the royal mausoleum.",
     "120.00", "per person", "Cultural", "6.7051", "-1.6146",
     {"service_duration": "3 hours", "whats_included": "Guide, museum entry, bottled water"}),
    ("+233200000001", "transport", "Kejetia", "Kumasi Airport Shuttle",
     "Air-conditioned shuttle between Kumasi Airport and any hotel in the city.",
     "80.00", "per trip", None, "6.7145", "-1.5904",
     {"service_duration": "45 minutes"}),
    ("+233200000002", "crafts", "Bonwire", "Bonwire Kente Weavers",
     "Hand-woven authentic Kente cloth straight from the looms of Bonwire.",
     "450.00", "per strip", "Handmade", "6.7794", "-1.4835",
     {"brand": "Bonwire Kente", "condition": "new", "stock_quantity": 25}),
    ("+233200000002", "shops", "Adum", "Adum Electronics Hub",
     "Phones, laptops and accessories with a 12-month warranty on every item.",
     "2500.00", "each", "Warranty", "6.6926", "-1.6258",
     {"brand": "Samsung", "condition": "new", "has_warranty": True,
      "warranty_details": "12 months manufacturer warranty", "stock_quantity": 10}),
    ("+233200000002", "grocery", "Kejetia", "Kejetia Fresh Market Basket",
     "Weekly basket of fresh yams, plantain, tomatoes, garden eggs and peppers.",
     "150.00", "per basket", "Fresh", "6.6960", "-1.6210",
     {"condition": "new", "has_expiry": True, "stock_quantity": 40}),
    ("+233200000003", "food", "Asokwa", "Auntie Muni Waakye",
     "Kumasi's favourite waakye with shito, fried fish, spaghetti and boiled egg.",
     "35.00", "per plate", "Local Favourite", "6.6720", "-1.6040",
     {"service_duration": "Ready in 10 minutes"}),
    ("+233200000003", "wedding", "Bantama", "Royal Asante Wedding Planners",
     "Full traditional and white wedding planning, from kente to catering.",
     "8000.00", "per event", "Premium", "6.7010", "-1.6380",
     {"service_duration": "Full day", "whats_included": "Planning, decor, MC, photography"}),
    ("+233200000003", "suame", "Suame", "Suame Magazine Auto Works",
     "Engine rebuilds, panel beating and spraying by Suame's master mechanics.",
     "300.00", "starting from", None, "6.7230", "-1.6250",
     {"service_duration": "1-3 days"}),
    ("+233200000003", "health", "Nhyiaeso", "Kumasi Wellness Physiotherapy",
     "Licensed physiotherapists offering sports injury and back-pain rehabilitation.",
     "200.00", "per session", None, "6.6790", "-1.6200",
     {"service_duration": "1 hour"}),
    ("+233200000004", "pharmacy", "Adum", "Adum Central Pharmacy",
     "Licensed pharmacy stocking prescription and over-the-counter medicines 24/7.",
     "25.00", "starting from", "24/7", "6.6935", "-1.6240",
     {"condition": "new", "has_expiry": True, "stock_quantity": 500}),
    ("+233200000004", "petrol", "Citywide", "GOIL Ahodwo Filling Station",
     "Petrol, diesel and LPG with a 24-hour mini-mart on the Ahodwo roundabout.",
     "14.50", "per litre", None, "6.6650", "-1.6300",
     {"stock_quantity": 10000}),
]

# (owner_phone, category_slug, zone, name, description, address, days_ahead, visibility_days, lat, lng)
EVENTS = [
    ("+233200000001", "festivals", "Manhyia", "Akwasidae Festival",
     "The Asantehene sits in state at Manhyia Palace to receive homage. Drumming, dancing and the display of royal regalia.",
     "Manhyia Palace, Kumasi", 12, 30, "6.7051", "-1.6146"),
    ("+233200000003", "concerts", "Bantama", "Kumasi Highlife Night",
     "An evening of live highlife with Kumasi's best bands and guest artists.",
     "Baba Yara Sports Stadium Grounds, Kumasi", 20, 30, "6.6965", "-1.6360"),
    ("+233200000003", "wedding-events", "Nhyiaeso", "Asante Bridal Expo",
     "Vendors, designers and planners under one roof for couples planning a traditional wedding.",
     "Golden Tulip Kumasi City, Nhyiaeso", 30, 60, "6.6803", "-1.6157"),
    ("+233200000002", "durbar", "Bonwire", "Bonwire Kente Durbar",
     "Annual durbar of chiefs celebrating the heritage of kente weaving with a market of master weavers.",
     "Bonwire Town Square", 45, 60, "6.7794", "-1.4835"),
]


class Command(BaseCommand):
    help = "DEV ONLY (requires DEBUG=True): seed the local database with sample customers, staff, business owners, listings and events."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                "seed_dev_data is a development-only command and refuses to run with "
                "DEBUG=False. It must never touch staging or production data."
            )
        now = timezone.now()
        password_hash = make_password(DEV_PASSWORD)
        created = {"customers": 0, "staff": 0, "owners": 0, "listings": 0, "events": 0}

        super_admin = StaffUser.objects.filter(role__name=Role.SUPER_ADMIN).first()

        for full_name, email, phone in CUSTOMERS:
            _, was_created = Customer.objects.get_or_create(
                email=email,
                defaults={"full_name": full_name, "phone": phone, "password_hash": password_hash},
            )
            created["customers"] += was_created

        for full_name, email, role_name in STAFF:
            _, was_created = StaffUser.objects.get_or_create(
                email=email,
                defaults={
                    "full_name": full_name,
                    "password_hash": password_hash,
                    "role": Role.objects.get(name=role_name),
                    "invited_by": super_admin,
                },
            )
            created["staff"] += was_created

        owners_by_phone = {}
        for full_name, phone, email, kind, ghana_card, gps in OWNERS:
            owner, was_created = BusinessOwner.objects.get_or_create(
                login_phone=phone,
                defaults={
                    "full_name": full_name,
                    "email": email,
                    "password_hash": password_hash,
                    "kyc_status": BusinessOwner.VERIFIED,
                    "reviewed_by": super_admin,
                    "reviewed_at": now,
                },
            )
            created["owners"] += was_created
            BusinessOwnerProfile.objects.get_or_create(
                business_owner=owner,
                defaults={
                    "ghana_card_number": ghana_card,
                    "gps_address": gps,
                    "business_contact_phone": phone,
                    "business_kind": kind,
                    "default_payout_method": BusinessOwnerProfile.MOMO,
                    "payout_momo_network": "MTN",
                    "payout_momo_number": phone,
                    "payout_momo_name": full_name,
                    "terms_accepted_at": now,
                },
            )
            plan = SubscriptionPlan.objects.filter(
                kind=kind, status=SubscriptionPlan.ACTIVE_STATUS
            ).order_by("-max_active_listings").first()
            Subscription.objects.get_or_create(
                business_owner=owner,
                defaults={
                    "plan": plan,
                    "status": Subscription.ACTIVE,
                    "current_period_start": now,
                    "current_period_end": now + timedelta(days=30),
                },
            )
            owners_by_phone[phone] = owner

        for (owner_phone, cat_slug, zone_name, name, description, price, unit,
             tag, lat, lng, extra) in LISTINGS:
            _, was_created = Listing.objects.get_or_create(
                business_owner=owners_by_phone[owner_phone],
                name=name,
                defaults={
                    "category": Category.objects.get(slug=cat_slug),
                    "zone": Zone.objects.get(name=zone_name),
                    "description": description,
                    "price_amount": Decimal(price),
                    "price_unit": unit,
                    "tag": tag,
                    "contact_phone": owner_phone,
                    "lat": Decimal(lat),
                    "lng": Decimal(lng),
                    "status": Listing.PUBLISHED,
                    "reviewed_by": super_admin,
                    "reviewed_at": now,
                    **extra,
                },
            )
            created["listings"] += was_created

        for (owner_phone, cat_slug, zone_name, name, description, address,
             days_ahead, visibility_days, lat, lng) in EVENTS:
            _, was_created = Event.objects.get_or_create(
                submitted_by_business=owners_by_phone[owner_phone],
                name=name,
                defaults={
                    "category": Category.objects.get(slug=cat_slug),
                    "zone": Zone.objects.get(name=zone_name),
                    "description": description,
                    "address": address,
                    "lat": Decimal(lat),
                    "lng": Decimal(lng),
                    "event_date": now + timedelta(days=days_ahead),
                    "visibility_days": visibility_days,
                    "status": Event.APPROVED,
                    "paid_at": now,
                    "expires_at": now + timedelta(days=visibility_days),
                    "approved_by": super_admin,
                    "reviewed_by": super_admin,
                    "reviewed_at": now,
                },
            )
            created["events"] += was_created

        summary = ", ".join(f"{n} {k}" for k, n in created.items())
        self.stdout.write(self.style.SUCCESS(f"Seeded: {summary} (password for all: {DEV_PASSWORD})"))
