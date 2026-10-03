"""Fill every staff queue with realistic, deliberately long dev data.

Dev-only companion to `seed_dev_data` (run that first — this command reuses
its customers, business owners, staff, listings and events). It exists so the
staff dashboard's busy-row layouts (long names, long unbroken emails, long
payment references, multi-sentence reasons) can be checked at phone widths
instead of only ever being seen as empty states.

Safety: refuses to run unless settings.DEBUG is True. There is deliberately no
override flag — it must never be runnable against staging/production data.

Idempotent: every row is looked up by a natural key before being created
(email/phone for accounts, owner+name for listings/events, the review unique
constraints, a fixed CheckoutSession/Transaction reference for anything
money-shaped, subject+starter for support conversations), so re-running only
fills in what is missing. Every seeded account uses seed_dev_data's password.

Only states the backend itself can produce are seeded. Nothing here invents a
rating: the one published review is a real Review row the aggregates count
legitimately. Not seeded (see the command's output for the reasons):
categories/zones and site settings (migration/singleton data), real Hubtel
checkout states (payments are simulated), and rows on the super admin's own
Field Verification / My Deliveries queues (the API only ever assigns a scout-
or dispatch-role staffer, so those rows go to the seeded scout/dispatch).
"""
import io
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from accounts.models import (
    BusinessOwner,
    BusinessOwnerProfile,
    Customer,
    Role,
    ScoutAssignment,
    StaffUser,
)
from billing.models import Subscription, SubscriptionPlan, Transaction
from contact.models import ContactMessage
from credit.models import CreditScore, LendingPartner, LoanApplication
from credit.scoring import compute_naive_credit_score
from disputes.models import Dispute
from events.models import Event, EventPricingTier, EventTicketType, Ticket
from listings.models import Category, HeroMediaSubmission, Listing, Promotion, Zone
from messaging.models import Conversation, Message
from orders.models import DeliveryAssignment, Order, OrderItem
from payments.models import CheckoutSession
from reviews.models import Review

from .seed_dev_data import DEV_PASSWORD

LONG_EMAIL = "verylongcustomeremailaddressfortesting@example-domain.com"
# Exactly 70 characters — the "long business/listing name" the audit is for.
LONG_LISTING_NAME = "Asantewaa Royal Kente and Adinkra Heritage Weaving Cooperative Bonwire"
LONG_OWNER_NAME = "Nana Kwadwo Ofori-Atta Boateng-Mensah Agyekum-Owusu Trading Enterprise"
LONG_EVENT_NAME = "Kumasi Cultural Centre Grand Asante Kente, Highlife and Adowa Weekend"

LONG_REASON = (
    "The Ghana Card images are blurred and the card number on the front does not match "
    "the number typed into the registration form. The Ghana Post address AK-485-9921 "
    "resolves to a residential plot in Atonsu, not the Adum shop the listing describes. "
    "Please upload sharp photos of both sides of the card and confirm the trading address."
)

# seed_dev_data's natural keys this command depends on.
REQUIRED_CUSTOMER_EMAILS = ["ama@example.com", "kofi@example.com", "yaa@example.com"]
REQUIRED_OWNER_PHONES = ["+233200000001", "+233200000002", "+233200000003", "+233200000004"]
REQUIRED_STAFF_EMAILS = ["support@theashantihub.com", "admin.staff@theashantihub.com"]


def _png(color=(201, 162, 39)):
    """A small real PNG, so ImageFields hold a file the browser can render."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (480, 300), color).save(buffer, format="PNG")
    return buffer.getvalue()


class Command(BaseCommand):
    help = (
        "DEV ONLY (requires DEBUG=True): fill every staff queue with realistic, "
        "deliberately long sample rows. Run seed_dev_data first."
    )

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                "seed_staff_queues is a development-only command and refuses to run with "
                "DEBUG=False. It must never touch staging or production data."
            )
        self.now = timezone.now()
        self.password_hash = make_password(DEV_PASSWORD)
        self.created = {}
        self._load_prerequisites()

        self._seed_staff()
        self._seed_customers()
        self._seed_kyc_owners()
        self._seed_listings()
        self._seed_hero()
        self._seed_events()
        self._seed_reviews()
        self._seed_event_pricing()
        self._seed_plans()
        self._seed_orders_and_deliveries()
        self._seed_escrow_tickets()
        self._seed_disputes()
        self._seed_owner_transactions()
        self._seed_promotions()
        self._seed_credit()
        self._seed_scout_assignments()
        self._seed_contact_messages()
        self._seed_conversations()

        summary = ", ".join(f"{n} {k}" for k, n in self.created.items() if n) or "nothing new"
        self.stdout.write(self.style.SUCCESS(f"Seeded staff queues: {summary}."))
        self.stdout.write(
            "Skipped by design: Categories & Zones and Site Settings (migration/singleton data); "
            "pending/failed Hubtel checkout states (payments are simulated); the super admin's own "
            "Field Verification / My Deliveries rows (only scout/dispatch-role staff can be assigned "
            f"— sign in as scout.seed@theashantihub.com or dispatch.seed@theashantihub.com, password "
            f"{DEV_PASSWORD}, to see those queues)."
        )

    # ── helpers ─────────────────────────────────────────────────────────────

    def _count(self, key, was_created):
        self.created[key] = self.created.get(key, 0) + int(bool(was_created))

    def _load_prerequisites(self):
        customers = {c.email: c for c in Customer.objects.filter(email__in=REQUIRED_CUSTOMER_EMAILS)}
        owners = {o.login_phone: o for o in BusinessOwner.objects.filter(login_phone__in=REQUIRED_OWNER_PHONES)}
        staff = {s.email: s for s in StaffUser.objects.filter(email__in=REQUIRED_STAFF_EMAILS)}
        missing = (
            [e for e in REQUIRED_CUSTOMER_EMAILS if e not in customers]
            + [p for p in REQUIRED_OWNER_PHONES if p not in owners]
            + [e for e in REQUIRED_STAFF_EMAILS if e not in staff]
        )
        if missing:
            raise CommandError(
                "seed_dev_data's accounts are missing (" + ", ".join(missing) + "). "
                "Run `python manage.py seed_dev_data` first, then re-run seed_staff_queues."
            )
        self.ama = customers["ama@example.com"]
        self.kofi = customers["kofi@example.com"]
        self.yaa = customers["yaa@example.com"]
        self.nana = owners["+233200000001"]
        self.abena = owners["+233200000002"]
        self.kwabena = owners["+233200000003"]
        self.efua = owners["+233200000004"]
        self.support = staff["support@theashantihub.com"]
        self.admin = staff["admin.staff@theashantihub.com"]
        self.super_admin = StaffUser.objects.filter(role__name=Role.SUPER_ADMIN).first()
        # Whoever actioned the Approved/Rejected history rows.
        self.reviewer = self.super_admin or self.admin

    def _listing(self, owner, name):
        return Listing.objects.filter(business_owner=owner, name=name).first()

    def _txn(self, reference, amount, purpose, *, customer=None, business_owner=None,
             status=Transaction.SUCCESS):
        txn, was_created = Transaction.objects.get_or_create(
            reference=reference,
            defaults={
                "customer": customer, "business_owner": business_owner,
                "amount": Decimal(amount), "purpose": purpose, "status": status,
            },
        )
        self._count("transactions", was_created)
        return txn

    # ── staff ───────────────────────────────────────────────────────────────

    def _staff(self, email, full_name, role, **extra):
        staff, was_created = StaffUser.objects.get_or_create(
            email=email,
            defaults={
                "full_name": full_name,
                "password_hash": self.password_hash,
                "role": Role.objects.get(name=role),
                "invited_by": self.super_admin,
                **extra,
            },
        )
        self._count("staff", was_created)
        return staff

    def _seed_staff(self):
        self.scout = self._staff(
            "scout.seed@theashantihub.com", "Yaw Boakye-Asamoah (Field Scout, Ashanti North)",
            Role.SCOUT, phone="+233550000101",
        )
        self.dispatch = self._staff(
            "dispatch.seed@theashantihub.com", "Kojo Antwi-Danso (Dispatch Rider, Kumasi Central)",
            Role.DISPATCH, phone="+233550000102",
        )
        self._staff(
            "delivery.manager.seed@theashantihub.com", "Adwoa Frimpong", Role.DELIVERY_MANAGER,
        )
        # Invited, not yet activated (invite_token set, still valid).
        self._staff(
            "marketing.invite.seed@theashantihub.com",
            "Abenaa Akyiaa Oforiwaa-Kumi (Marketing & Partnerships Lead)", Role.MARKETING,
            invite_token="seed-invite-marketing-0001",
            invite_expires_at=self.now + timedelta(days=5),
        )
        # Invite that lapsed.
        self._staff(
            "accountant.invite.seed@theashantihub.com", "Kwaku Duah", Role.ACCOUNTANT,
            invite_token="seed-invite-accountant-0002",
            invite_expires_at=self.now - timedelta(days=2),
        )
        self._staff(
            "suspended.support.seed@theashantihub.com", "Esi Nyarko", Role.SUPPORT,
            is_suspended=True,
            suspension_reason=(
                "Suspended pending an internal review of three refunds issued without a "
                "second approver. Access will be restored once the review is closed."
            ),
        )
        self._staff(
            "deactivated.seed@theashantihub.com", "Fiifi Quansah", Role.SUPPORT, is_active=False,
        )

    # ── customers ───────────────────────────────────────────────────────────

    def _seed_customers(self):
        self.long_customer, was_created = Customer.objects.get_or_create(
            email=LONG_EMAIL,
            defaults={
                "full_name": "Akosua Serwaa Owusu-Ansah Bonsu-Agyemang",
                "phone": "+233240000101",
                "password_hash": self.password_hash,
                "address": "House No. 14, Plot 7 Block C, Off the Santasi Roundabout, Kumasi",
            },
        )
        self._count("customers", was_created)
        _, was_created = Customer.objects.get_or_create(
            email="suspended.customer.seed@example.com",
            defaults={
                "full_name": "Kwame Asante",
                "phone": "+233240000102",
                "password_hash": self.password_hash,
                "is_suspended": True,
                "suspension_reason": (
                    "Repeated chargeback attempts on delivered orders. Suspended until the "
                    "customer confirms their identity with support."
                ),
            },
        )
        self._count("customers", was_created)

    # ── KYC queue ───────────────────────────────────────────────────────────

    def _owner(self, phone, full_name, email, *, kind, ghana_card, gps, status=BusinessOwner.PENDING,
               reason=None, created_ago_days=0):
        owner, was_created = BusinessOwner.objects.get_or_create(
            login_phone=phone,
            defaults={
                "full_name": full_name,
                "email": email,
                "password_hash": self.password_hash,
                "kyc_status": status,
                "kyc_rejection_reason": reason,
                "reviewed_by": None if status == BusinessOwner.PENDING else self.reviewer,
                "reviewed_at": None if status == BusinessOwner.PENDING else self.now,
            },
        )
        self._count("business_owners", was_created)
        if was_created and created_ago_days:
            # Spread the pending queue's oldest-first order over a few days.
            BusinessOwner.objects.filter(pk=owner.pk).update(
                created_at=self.now - timedelta(days=created_ago_days)
            )
        if not BusinessOwnerProfile.objects.filter(business_owner=owner).exists():
            profile = BusinessOwnerProfile(
                business_owner=owner,
                ghana_card_number=ghana_card,
                gps_address=gps,
                business_contact_phone=phone,
                business_kind=kind,
                default_payout_method=BusinessOwnerProfile.MOMO,
                payout_momo_network="MTN",
                payout_momo_number=phone,
                payout_momo_name=full_name[:150],
                terms_accepted_at=self.now,
            )
            profile.ghana_card_front_image.save("seed-ghana-card-front.png", ContentFile(_png()), save=False)
            profile.ghana_card_back_image.save(
                "seed-ghana-card-back.png", ContentFile(_png((26, 92, 56))), save=False
            )
            profile.save()
        if not hasattr(owner, "subscription"):
            plan = SubscriptionPlan.objects.filter(
                kind=kind, status=SubscriptionPlan.ACTIVE_STATUS
            ).order_by("monthly_price").first()
            if plan:
                Subscription.objects.get_or_create(
                    business_owner=owner,
                    defaults={
                        "plan": plan, "status": Subscription.ACTIVE,
                        "current_period_start": self.now,
                        "current_period_end": self.now + timedelta(days=30),
                    },
                )
        return owner

    def _seed_kyc_owners(self):
        self.long_owner = self._owner(
            "+233209100001", LONG_OWNER_NAME,
            "nana.kwadwo.ofori-atta.boateng-mensah.trading.enterprise@example-domain.com",
            kind="product", ghana_card="GHA-910000001-1", gps="AK-485-9921", created_ago_days=4,
        )
        self.pending_owner_2 = self._owner(
            "+233209100002", "Akua Pokuaa Sarpong", "akua.sarpong@example.com",
            kind="service", ghana_card="GHA-910000002-2", gps="AK-210-3345", created_ago_days=2,
        )
        self.pending_owner_3 = self._owner(
            "+233209100003", "Kofi Ampofo Bekoe", "kofi.bekoe@example.com",
            kind="product", ghana_card="GHA-910000003-3", gps="AK-077-1290", created_ago_days=1,
        )
        self._owner(
            "+233209100004", "Afia Konadu Mensah-Bonsu", "afia.konadu@example.com",
            kind="service", ghana_card="GHA-910000004-4", gps="AK-301-5567",
            status=BusinessOwner.REJECTED, reason=LONG_REASON,
        )
        # A verified owner the Users panel shows as suspended.
        owner = self._owner(
            "+233209100005", "Yeboah Brothers Auto Spares", "yeboah.spares@example.com",
            kind="product", ghana_card="GHA-910000005-5", gps="AK-118-4410",
            status=BusinessOwner.VERIFIED,
        )
        if not owner.is_suspended:
            owner.is_suspended = True
            owner.suspension_reason = (
                "Listed counterfeit engine parts as genuine Toyota stock. Listings hidden while "
                "the business supplies proof of origin."
            )
            owner.save(update_fields=["is_suspended", "suspension_reason"])

    # ── listings moderation ────────────────────────────────────────────────

    def _seed_listing(self, owner, name, *, cat, zone, description, price, unit, status,
                      reason=None, **extra):
        listing, was_created = Listing.objects.get_or_create(
            business_owner=owner,
            name=name,
            defaults={
                "category": Category.objects.get(slug=cat),
                "zone": Zone.objects.get(name=zone),
                "description": description,
                "price_amount": Decimal(price),
                "price_unit": unit,
                "contact_phone": owner.login_phone,
                "status": status,
                "rejection_reason": reason,
                "reviewed_by": None if status == Listing.PENDING_REVIEW else self.reviewer,
                "reviewed_at": None if status == Listing.PENDING_REVIEW else self.now,
                **extra,
            },
        )
        self._count("listings", was_created)
        return listing

    def _seed_listings(self):
        self.long_listing = self._seed_listing(
            self.abena, LONG_LISTING_NAME, cat="crafts", zone="Bonwire",
            description=(
                "Hand-woven kente in Adwinasa, Oyokoman and Sika Futuro patterns, plus stamped "
                "adinkra cloth made with calabash stamps and badie dye. Every strip is woven on "
                "our own looms; custom lengths for weddings, naming ceremonies and graduations."
            ),
            price="1250.00", unit="per full cloth", status=Listing.PENDING_REVIEW,
            brand="Asantewaa Looms", condition="new", stock_quantity=12,
        )
        self._seed_listing(
            self.nana, "Lake Bosomtwe Sunrise Canoe and Village Walk", cat="tours", zone="Manhyia",
            description="Dawn padaw canoe ride on Lake Bosomtwe followed by a guided walk through Abono.",
            price="340.00", unit="per person", status=Listing.PENDING_REVIEW,
            service_duration="6 hours",
        )
        self._seed_listing(
            self.efua, "Ahodwo Family Pharmacy Delivery Bundle", cat="pharmacy", zone="Adum",
            description="Monthly chronic-medication bundle delivered to your door with pharmacist check-in.",
            price="185.50", unit="per month", status=Listing.PENDING_REVIEW,
            condition="new", has_expiry=True, stock_quantity=60,
        )
        self._seed_listing(
            self.kwabena, "Suame Express Gearbox Overhaul (All Japanese Makes)", cat="suame",
            zone="Suame",
            description="Full automatic and manual gearbox overhaul with a 90-day workmanship guarantee.",
            price="1800.00", unit="starting from", status=Listing.REJECTED,
            reason=(
                "The photos show a different workshop's signboard and the 90-day guarantee is not "
                "described anywhere in your terms. Please upload photos of your own premises and add "
                "the guarantee's conditions to the description before resubmitting."
            ),
            service_duration="3-5 days",
        )

    # ── hero approval ──────────────────────────────────────────────────────

    def _seed_hero_row(self, owner, caption, *, listing=None, status=HeroMediaSubmission.PENDING,
                       reason=None, color=(201, 162, 39)):
        if HeroMediaSubmission.objects.filter(business_owner=owner, caption=caption).exists():
            self._count("hero_submissions", False)
            return
        reviewed = status != HeroMediaSubmission.PENDING
        submission = HeroMediaSubmission(
            business_owner=owner, listing=listing, caption=caption, status=status,
            rejection_reason=reason,
            reviewed_by=self.reviewer if reviewed else None,
            reviewed_at=self.now if reviewed else None,
            approved_at=self.now if status == HeroMediaSubmission.APPROVED else None,
            expires_at=(self.now + timedelta(days=14)) if status == HeroMediaSubmission.APPROVED else None,
        )
        submission.media.save("seed-hero.png", ContentFile(_png(color)), save=False)
        submission.save()
        self._count("hero_submissions", True)

    def _seed_hero(self):
        self._seed_hero_row(
            self.abena,
            # 140 characters — the caption's max length.
            ("Bonwire kente woven on our own looms since 1952: Adwinasa, Oyokoman and Sika Futuro "
             "strips for weddings, naming ceremonies and graduations.")[:140],
            listing=self.long_listing,
        )
        self._seed_hero_row(
            self.nana, "Sunrise on Lake Bosomtwe — book the canoe and village walk",
            color=(26, 92, 56),
        )
        self._seed_hero_row(
            self.kwabena, "Royal Asante weddings planned end to end, kente to catering",
            listing=self._listing(self.kwabena, "Royal Asante Wedding Planners"), color=(139, 30, 63),
        )
        self._seed_hero_row(
            self.efua, "Adum Central Pharmacy — open 24/7, every day of the year",
            listing=self._listing(self.efua, "Adum Central Pharmacy"),
            status=HeroMediaSubmission.APPROVED, color=(30, 64, 175),
        )
        self._seed_hero_row(
            self.kwabena, "Cheapest gearbox repairs in Ghana guaranteed!!!",
            status=HeroMediaSubmission.REJECTED,
            reason=(
                "Hero captions can't make unverifiable price claims such as \"cheapest in Ghana\". "
                "The image is also a stock photo rather than your own workshop. Please resubmit "
                "with a photo of your premises and a factual caption."
            ),
            color=(90, 90, 90),
        )

    # ── events moderation ──────────────────────────────────────────────────

    def _seed_event(self, name, *, cat, zone, description, address, days_ahead, owner=None,
                    customer=None, status=Event.PENDING, reason=None):
        lookup = {"submitted_by_business": owner} if owner else {"submitted_by_customer": customer}
        reviewed = status != Event.PENDING
        _, was_created = Event.objects.get_or_create(
            name=name,
            **lookup,
            defaults={
                "category": Category.objects.get(slug=cat),
                "zone": Zone.objects.get(name=zone),
                "description": description,
                "address": address,
                "event_date": self.now + timedelta(days=days_ahead),
                "visibility_days": 30,
                "status": status,
                "rejection_reason": reason,
                "reviewed_by": self.reviewer if reviewed else None,
                "reviewed_at": self.now if reviewed else None,
            },
        )
        self._count("events", was_created)

    def _seed_events(self):
        self._seed_event(
            LONG_EVENT_NAME, owner=self.nana, cat="festivals", zone="Manhyia",
            description=(
                "Three days of kente weaving demonstrations, adowa and fontomfrom drumming, a "
                "highlife night with live bands, and a craft market of more than forty Ashanti "
                "artisans. Gates open at 10:00 each day; the Sunday durbar starts at 14:00 sharp."
            ),
            address="Centre for National Culture (Kumasi Cultural Centre), Bantama Road, Kumasi",
            days_ahead=25,
        )
        self._seed_event(
            "Adum Street Food Night Market", customer=self.kofi, cat="concerts", zone="Adum",
            description="Fufu, kelewele, khebab and sobolo stalls along Prempeh II Street, with a DJ.",
            address="Prempeh II Street, Adum, Kumasi", days_ahead=10,
        )
        self._seed_event(
            "Ejisu Yaa Asantewaa Heritage Walk", owner=self.abena, cat="durbar", zone="Bonwire",
            description="Guided walk to the Yaa Asantewaa museum site with storytellers and drummers.",
            address="Ejisu-Besease Shrine, Ejisu", days_ahead=18,
        )
        self._seed_event(
            "Mega Free Giveaway Concert", customer=self.yaa, cat="concerts", zone="Kejetia",
            description="Free phones for the first 500 people through the gate!",
            address="Kejetia Market Car Park", days_ahead=7,
            status=Event.REJECTED,
            reason=(
                "The giveaway can't be verified and the venue is an active car park the Kumasi "
                "Metropolitan Assembly hasn't approved for events. Please attach the venue permit "
                "and remove the giveaway claim before resubmitting."
            ),
        )

    # ── reviews moderation ─────────────────────────────────────────────────

    def _seed_review(self, author, *, target_type, status=Review.PENDING, rating, comment,
                     hidden_reason=None, **target):
        reviewed = status != Review.PENDING
        _, was_created = Review.objects.get_or_create(
            author=author,
            target_type=target_type,
            **target,
            defaults={
                "rating": rating,
                "comment": comment,
                "verified": True,
                "status": status,
                "hidden_reason": hidden_reason,
                "hidden_by": self.reviewer if status == Review.HIDDEN else None,
                "reviewed_by": self.reviewer if reviewed else None,
                "reviewed_at": self.now if reviewed else None,
            },
        )
        self._count("reviews", was_created)

    def _seed_reviews(self):
        golden_tulip = self._listing(self.nana, "Golden Tulip Kumasi City")
        waakye = self._listing(self.kwabena, "Auntie Muni Waakye")
        highlife = Event.objects.filter(name="Kumasi Highlife Night").first()
        self._seed_review(
            self.long_customer, target_type=Review.LISTING, listing=golden_tulip, rating=4,
            comment=(
                "Lovely pool and the breakfast buffet had proper kontomire stew, not just continental. "
                "Check-in took almost forty minutes because the card machine was down and nobody told "
                "us mobile money was an option. Room 412's air-conditioning dripped all night. Would "
                "still come back for the location and the staff, who were warm once things got going."
            ),
        )
        self._seed_review(
            self.kofi, target_type=Review.LISTING, listing=waakye, rating=5,
            comment="Best waakye in Asokwa, the shito is the real thing.",
        )
        if highlife:
            self._seed_review(
                self.yaa, target_type=Review.EVENT, event=highlife, rating=3,
                comment="Great bands, but the queue at the gate was very long.",
            )
        self._seed_review(
            self.ama, target_type=Review.SELLER, business_owner=self.abena, rating=5,
            comment="Kente arrived exactly as pictured and well packed.",
            status=Review.PUBLISHED,
        )
        self._seed_review(
            self.yaa, target_type=Review.LISTING, listing=waakye, rating=1,
            comment="Don't buy here, go to my cousin's chop bar instead — call 024 000 0000.",
            status=Review.HIDDEN,
            hidden_reason=(
                "Contains a phone number and directs buyers to another business. Reviews must describe "
                "the reviewer's own experience and may not include contact details."
            ),
        )

    # ── event pricing ──────────────────────────────────────────────────────

    def _seed_event_pricing(self):
        tier = EventPricingTier.objects.filter(duration_days=EventPricingTier.DAYS_30).first()
        if tier and tier.pending_price is None:
            tier.pending_price = (tier.live_price * Decimal("1.15")).quantize(Decimal("0.01"))
            tier.proposed_by = self.admin
            tier.proposed_at = self.now
            tier.save(update_fields=["pending_price", "proposed_by", "proposed_at"])
            self._count("pricing_proposals", True)

    # ── subscription plans ────────────────────────────────────────────────

    def _seed_plan(self, tier, name, *, kind, price, features, status, reason=None):
        reviewed = status != SubscriptionPlan.PENDING_APPROVAL
        _, was_created = SubscriptionPlan.objects.get_or_create(
            tier=tier,
            defaults={
                "name": name, "kind": kind, "monthly_price": Decimal(price), "features": features,
                "status": status, "rejection_reason": reason,
                "reviewed_by": self.reviewer if reviewed else None,
                "reviewed_at": self.now if reviewed else None,
                "max_active_listings": 40, "hero_days": 14, "hero_slots": 2,
                "boost_credits_per_month": 4,
            },
        )
        self._count("plans", was_created)

    def _seed_plans(self):
        self._seed_plan(
            "seed_enterprise_plus", "Enterprise Plus — Multi-Branch Retailers & Wholesalers",
            kind=SubscriptionPlan.KIND_PRODUCT, price="1499.00",
            features=[
                "Up to 40 active listings across every branch",
                "Two hero-slider slots for fourteen days each month",
                "Four keyword boosts per month",
                "Priority KYC and listing review within one working day",
                "Dedicated AshantiHub account manager on WhatsApp business hours",
            ],
            status=SubscriptionPlan.PENDING_APPROVAL,
        )
        self._seed_plan(
            "seed_service_pro", "Service Pro (Quarterly)", kind=SubscriptionPlan.KIND_SERVICE,
            price="420.00", features=["Unlimited service listings", "One hero slot"],
            status=SubscriptionPlan.PENDING_APPROVAL,
        )
        self._seed_plan(
            "seed_flash_promo", "Flash Promo Starter", kind=SubscriptionPlan.KIND_PRODUCT,
            price="9.99", features=["Five listings"],
            status=SubscriptionPlan.REJECTED_STATUS,
            reason=(
                "A GHS 9.99 tier undercuts Product Basic while granting more listings, which would "
                "cannibalise existing subscribers. Re-propose at or above the Basic price, or drop "
                "the listing allowance to two."
            ),
        )

    # ── orders, delivery coordination, my deliveries ──────────────────────

    def _seed_order(self, key, customer, lines, *, paid=True, method=Order.DOOR_TO_DOOR,
                    address="", lat=None, lng=None, txn_reference=None):
        """`key` is the order's CheckoutSession reference (unique), which makes
        re-runs find the same order — the real checkout flow also records the
        order id in CheckoutSession.metadata."""
        session = CheckoutSession.objects.filter(reference=key).first()
        if session and session.metadata.get("order_id"):
            order = Order.objects.filter(pk=session.metadata["order_id"]).first()
            if order:
                self._count("orders", False)
                return order
        total = sum(Decimal(str(listing.price_amount)) * qty for listing, qty in lines)
        order = Order.objects.create(
            customer=customer,
            status=Order.PAID if paid else Order.PENDING,
            delivery_method=method,
            delivery_address=address,
            delivery_phone=customer.phone or "",
            delivery_lat=lat,
            delivery_lng=lng,
            total_amount=total,
        )
        for listing, qty in lines:
            OrderItem.objects.create(
                order=order, listing=listing, quantity=qty, unit_price=listing.price_amount,
                line_total=listing.price_amount * qty,
            )
            # Stock is reserved at checkout (backend/CLAUDE.md).
            if listing.stock_quantity is not None:
                listing.stock_quantity = max(listing.stock_quantity - qty, 0)
                listing.save(update_fields=["stock_quantity"])
        txn = None
        if paid:
            txn = self._txn(
                txn_reference or f"{key}-TXN", total, f"Order #{order.id} checkout", customer=customer,
            )
        CheckoutSession.objects.update_or_create(
            reference=key,
            defaults={
                "customer": customer, "kind": CheckoutSession.ORDER_CHECKOUT, "amount": total,
                "purpose": f"Order #{order.id} checkout", "metadata": {"order_id": order.id},
                "status": CheckoutSession.SUCCESS if paid else CheckoutSession.PENDING,
                "transaction": txn,
            },
        )
        self._count("orders", True)
        return order

    def _assign(self, order, status, notes=""):
        stamps = {}
        if status in (DeliveryAssignment.PICKED_UP, DeliveryAssignment.DELIVERED):
            stamps["picked_up_at"] = self.now - timedelta(hours=3)
        if status == DeliveryAssignment.DELIVERED:
            stamps["delivered_at"] = self.now - timedelta(hours=1)
        _, was_created = DeliveryAssignment.objects.get_or_create(
            order=order,
            defaults={
                "dispatch": self.dispatch, "assigned_by": self.super_admin, "status": status,
                "notes": notes, **stamps,
            },
        )
        if was_created:
            order.delivery_status = {
                DeliveryAssignment.ASSIGNED: Order.SHIPPED,
                DeliveryAssignment.PICKED_UP: Order.OUT_FOR_DELIVERY,
                DeliveryAssignment.DELIVERED: Order.DELIVERED,
            }[status]
            order.save(update_fields=["delivery_status"])
        self._count("delivery_assignments", was_created)

    def _seed_orders_and_deliveries(self):
        kente = self._listing(self.abena, "Bonwire Kente Weavers")
        electronics = self._listing(self.abena, "Adum Electronics Hub")
        basket = self._listing(self.abena, "Kejetia Fresh Market Basket")
        pharmacy = self._listing(self.efua, "Adum Central Pharmacy")
        self.order_long = self._seed_order(
            "AH-ORDER_CHECKOUT-SEED7Q4K9X2M1P8R5T3V6W0Y-0001", self.long_customer,
            [(electronics, 1), (kente, 2)],
            address=(
                "House No. 14, Plot 7 Block C, behind the Santasi Roundabout Total filling station, "
                "opposite the blue gate with the mango tree, Santasi, Kumasi (call on arrival)"
            ),
            lat=6.6848, lng=-1.6587,
            txn_reference="AH-ORDER_CHECKOUT-SEED7Q4K9X2M1P8R5T3V6W0YKUMASIADUM0001HUBTELTX",
        )
        self.order_ama = self._seed_order(
            "AH-ORDER_CHECKOUT-SEED-0002", self.ama, [(basket, 3)],
            address="Asokwa, near the Asokwa Police Station", lat=6.6721, lng=-1.6031,
        )
        self.order_kofi = self._seed_order(
            "AH-ORDER_CHECKOUT-SEED-0003", self.kofi, [(pharmacy, 4), (basket, 1)],
            address="KNUST Campus, Unity Hall (Conti), Room B214", lat=6.6745, lng=-1.5716,
        )
        self.order_yaa = self._seed_order(
            "AH-ORDER_CHECKOUT-SEED-0004", self.yaa, [(kente, 1)],
            address="Bantama High Street, two houses after the Komfo Anokye hospital gate",
            lat=6.6990, lng=-1.6340,
        )
        self.order_pickup = self._seed_order(
            "AH-ORDER_CHECKOUT-SEED-0005", self.kofi, [(electronics, 1)],
            method=Order.STORE_PICKUP,
        )
        self._seed_order(
            "AH-ORDER_CHECKOUT-SEED-0006", self.ama, [(kente, 1)], paid=False,
            address="Adum, Prempeh II Street",
        )
        # order_long stays unassigned (the Delivery Coordination "assign" state).
        self._assign(self.order_ama, DeliveryAssignment.ASSIGNED)
        self._assign(
            self.order_kofi, DeliveryAssignment.PICKED_UP,
            notes="Customer asked for drop-off at the porters' lodge if not in the room after 6pm.",
        )
        self._assign(self.order_yaa, DeliveryAssignment.DELIVERED)

    # ── escrow ledger ──────────────────────────────────────────────────────

    def _seed_escrow_tickets(self):
        event = Event.objects.filter(name="Kumasi Highlife Night").first()
        if event is None:
            return
        ticket_type, was_created = EventTicketType.objects.get_or_create(
            event=event, name="VIP Table for Six with Bottle Service (Front of Stage)",
            defaults={
                "price": Decimal("1800.00"), "quantity_total": 20,
                "description": "Reserved table for six, front of stage, with a dedicated host.",
            },
        )
        self._count("ticket_types", was_created)
        regular, was_created = EventTicketType.objects.get_or_create(
            event=event, name="Regular",
            defaults={"price": Decimal("150.00"), "quantity_total": 500},
        )
        self._count("ticket_types", was_created)

        rows = [
            # (reference, ticket type, buyer, kind)
            ("AH-TICKET_PURCHASE-SEED-VIP-0001-HIGHLIFE-NIGHT-KUMASI", ticket_type, self.long_customer, "held"),
            ("AH-TICKET_PURCHASE-SEED-REG-0002", regular, self.ama, "held"),
            ("AH-TICKET_PURCHASE-SEED-REG-0003", regular, self.kofi, "held"),
            ("AH-TICKET_PURCHASE-SEED-REG-0004", regular, self.yaa, "checked_in"),
            ("AH-TICKET_PURCHASE-SEED-VIP-0005", ticket_type, self.kofi, "override"),
            ("AH-TICKET_PURCHASE-SEED-REG-0006", regular, self.yaa, "refunded"),
        ]
        for reference, ttype, buyer, kind in rows:
            if Transaction.objects.filter(reference=reference).exists():
                self._count("tickets", False)
                continue
            txn = self._txn(
                reference, ttype.price, f"Ticket purchase — {event.name} ({ttype.name})", customer=buyer,
            )
            ticket = Ticket(
                ticket_type=ttype, purchased_by=buyer, transaction=txn,
                delivery_method=ttype.delivery_method, price=ttype.price,
            )
            if kind == "checked_in":
                ticket.delivered_at = self.now
                ticket.delivered_by_staff = self.support
                ticket.escrow_status = Ticket.RELEASED
                ticket.escrow_released_at = self.now
            elif kind == "override":
                ticket.escrow_status = Ticket.RELEASED
                ticket.escrow_released_at = self.now
                ticket.escrow_released_by_staff = self.reviewer
                ticket.escrow_override_note = (
                    "Organiser confirmed by phone that the buyer collected the wristband at the side "
                    "gate, but the scanner was offline so no check-in was recorded. Released manually "
                    "after matching the buyer's Ghana Card to the guest list."
                )
            ticket.save()
            if kind == "refunded":
                self._txn(
                    f"AH-REFUND-SEED-{ticket.id}", -ttype.price,
                    f"Refund for ticket {ticket.code} ('{event.name}')", customer=buyer,
                    status=Transaction.REFUNDED,
                )
                ticket.refunded_at = self.now
                ticket.refunded_by_staff = self.reviewer
                ticket.refund_reason = "Buyer was hospitalised the week of the event; doctor's note on file."
                ticket.save(update_fields=["refunded_at", "refunded_by_staff", "refund_reason"])
            ttype.quantity_sold += 1
            ttype.save(update_fields=["quantity_sold"])
            self._count("tickets", True)

    # ── disputes ──────────────────────────────────────────────────────────

    def _seed_dispute(self, order, customer, reason, description, *, status=Dispute.OPEN,
                      notes=None, refund=None):
        _, was_created = Dispute.objects.get_or_create(
            order=order, raised_by=customer, reason=reason,
            defaults={
                "description": description, "status": status, "resolution_notes": notes,
                "refund_amount": Decimal(refund) if refund else None,
                "flagged_by": self.support if status != Dispute.OPEN else None,
                "resolved_by": self.reviewer if status in Dispute.FINAL_STATUSES else None,
            },
        )
        self._count("disputes", was_created)

    def _seed_disputes(self):
        self._seed_dispute(
            self.order_long, self.long_customer, Dispute.QUALITY_ISSUE,
            "The Samsung phone arrived with a cracked screen protector and a scratch across the back "
            "glass. The box seal was already broken when the courier handed it over. I paid for a new "
            "phone with a 12-month warranty and the seller now says the warranty only covers the "
            "battery. I want a replacement or a full refund, not a discount voucher.",
        )
        self._seed_dispute(
            self.order_ama, self.ama, Dispute.DELIVERY_ISSUE,
            "Courier has been 'assigned' for two days but nobody has called me.",
            status=Dispute.INVESTIGATING,
        )
        self._seed_dispute(
            self.order_pickup, self.kofi, Dispute.PAYMENT_ISSUE,
            "Mobile money was debited twice for the same order (two MTN MoMo messages, same amount, "
            "two minutes apart). Reference numbers are in the screenshots I sent to support.",
        )
        self._seed_dispute(
            self.order_yaa, self.yaa, Dispute.ORDER_ISSUE,
            "Received one strip of kente instead of the full cloth shown in the photos.",
            status=Dispute.RESOLVED, refund="225.00",
            notes=(
                "Seller confirmed the listing photo showed a full cloth while the price was per strip. "
                "Partial refund of GHS 225.00 agreed with the customer; seller has updated the photos."
            ),
        )
        self._seed_dispute(
            self.order_kofi, self.kofi, Dispute.OTHER,
            "I want a refund because I found it cheaper elsewhere.",
            status=Dispute.REJECTED,
            notes="Price differences after purchase are not grounds for a refund under the buyer terms.",
        )

    # ── transactions report (business-owner side) ─────────────────────────

    def _seed_owner_transactions(self):
        self._txn(
            "AH-SUBSCRIPTION-SEED-ABENA-2026-Q4-PRODUCT-UNLIMITED-RENEWAL", "450.00",
            "Subscription renewal — Product Unlimited (3 months, paid in advance by MTN MoMo)",
            business_owner=self.abena,
        )
        self._txn(
            "AH-HERO_EXTEND-SEED-EFUA-0001", "120.00", "Hero slider extension — 7 days",
            business_owner=self.efua,
        )

    # ── promotions ────────────────────────────────────────────────────────

    def _seed_promotion(self, key, listing, kind, *, amount, status=Promotion.PENDING, keywords="",
                        starts_in_days=0, days=14, reason=""):
        if listing is None:
            return
        if CheckoutSession.objects.filter(reference=key).exists():
            self._count("promotions", False)
            return
        owner = listing.business_owner
        txn = self._txn(f"{key}-TXN", amount, f"Listing promotion — {kind} for {listing.name}",
                        business_owner=owner)
        starts_at = self.now + timedelta(days=starts_in_days)
        promotion = Promotion.objects.create(
            listing=listing, kind=kind, keywords=keywords, amount_paid=Decimal(amount),
            starts_at=starts_at, ends_at=starts_at + timedelta(days=days), status=status,
            rejection_reason=reason,
        )
        CheckoutSession.objects.create(
            reference=key, business_owner=owner, kind=CheckoutSession.LISTING_PROMOTION,
            amount=Decimal(amount), purpose=txn.purpose, status=CheckoutSession.SUCCESS,
            metadata={"promotion_id": promotion.id}, transaction=txn,
        )
        self._count("promotions", True)

    def _seed_promotions(self):
        kente = self._listing(self.abena, "Bonwire Kente Weavers")
        hotel = self._listing(self.nana, "Golden Tulip Kumasi City")
        waakye = self._listing(self.kwabena, "Auntie Muni Waakye")
        pharmacy = self._listing(self.efua, "Adum Central Pharmacy")
        shuttle = self._listing(self.nana, "Kumasi Airport Shuttle")
        self._seed_promotion(
            "AH-LISTING_PROMOTION-SEED-0001", kente, Promotion.BOOST, amount="180.00",
            keywords=(
                "kente, wedding kente, graduation stole, adwinasa, oyokoman, sika futuro, "
                "bonwire, naming ceremony cloth, engagement gifts"
            ),
        )
        self._seed_promotion("AH-LISTING_PROMOTION-SEED-0002", hotel, Promotion.FEATURED, amount="600.00")
        self._seed_promotion(
            "AH-LISTING_PROMOTION-SEED-0003", waakye, Promotion.BOOST, amount="60.00",
            keywords="waakye, breakfast, asokwa",
        )
        self._seed_promotion(
            "AH-LISTING_PROMOTION-SEED-0004", pharmacy, Promotion.FEATURED, amount="600.00",
            status=Promotion.ACTIVE, starts_in_days=-2,
        )
        self._seed_promotion(
            "AH-LISTING_PROMOTION-SEED-0005", shuttle, Promotion.BOOST, amount="60.00",
            status=Promotion.REJECTED, keywords="cheap taxi, uber, bolt",
            reason="Keywords name competitor brands (Uber, Bolt); boosts may only use your own terms.",
        )
        self._seed_promotion(
            "AH-LISTING_PROMOTION-SEED-0006", hotel, Promotion.BOOST, amount="60.00",
            status=Promotion.ACTIVE, keywords="hotel, pool", starts_in_days=-30, days=14,
        )

    # ── credit & lending ──────────────────────────────────────────────────

    def _seed_credit(self):
        partner, was_created = LendingPartner.objects.get_or_create(
            name="Asante Akyem Rural Bank SME Growth and Women in Trade Facility",
            defaults={
                "partner_type": LendingPartner.BANK, "logo": "🏦", "color": "#1A5C38",
                "min_score": 600, "max_loan": "GHS 50,000", "interest_rate": "24% p.a. reducing",
                "turnaround": "5–7 working days",
                "focus": "Women-led traders and artisans in the Ashanti Region with 12+ months of sales",
                "contact": "sme.desk@asanteakyem.example",
            },
        )
        self._count("lending_partners", was_created)
        micro, was_created = LendingPartner.objects.get_or_create(
            name="Kumasi Susu Microfinance",
            defaults={
                "partner_type": LendingPartner.MICROFINANCE, "logo": "💰", "color": "#C9A227",
                "min_score": 450, "max_loan": "GHS 5,000", "interest_rate": "3.5% / month",
                "turnaround": "48 hours", "focus": "Market traders",
            },
        )
        self._count("lending_partners", was_created)

        def loan(owner, lender, amount, purpose, status=LoanApplication.SUBMITTED, notes=""):
            score, _ = compute_naive_credit_score(owner)
            final = status in LoanApplication.FINAL_STATUSES or status == LoanApplication.UNDER_REVIEW
            _, created = LoanApplication.objects.get_or_create(
                business_owner=owner, purpose=purpose,
                defaults={
                    "lending_partner": lender, "amount": Decimal(amount),
                    "score_at_application": score, "status": status, "decision_notes": notes,
                    "reviewed_by": self.reviewer if final else None,
                    "reviewed_at": self.now if final else None,
                },
            )
            self._count("loan_applications", created)

        loan(self.abena, partner, "45000.00",
             "Buy two additional broadloom kente looms and six months of silk and rayon yarn stock "
             "ahead of the December wedding season, and hire two apprentice weavers.")
        loan(self.kwabena, micro, "4500.00", "Diagnostic scanner for the Suame workshop")
        loan(self.efua, partner, "30000.00", "Cold-chain fridge for insulin and vaccines",
             status=LoanApplication.UNDER_REVIEW)
        loan(self.nana, micro, "3000.00", "Second shuttle bus deposit", status=LoanApplication.APPROVED,
             notes="Approved by partner at GHS 3,000 over 6 months.")
        loan(self.kwabena, partner, "50000.00", "Expand the waakye kitchen into a second branch",
             status=LoanApplication.DECLINED,
             notes=(
                 "Partner declined: fewer than 12 months of recorded sales on the platform. Eligible to "
                 "re-apply once the account has a year of transactions."
             ))

        # A staff score adjustment with a long reason (credit.manage).
        score, _ = CreditScore.objects.get_or_create(business_owner=self.abena)
        if score.manual_adjustment == 0:
            score.manual_adjustment = 45
            score.adjustment_reason = (
                "Verified twelve months of offline sales ledgers from the Bonwire weavers' association "
                "that predate the AshantiHub account, which the placeholder formula cannot see."
            )
            score.adjusted_by = self.reviewer
            score.adjusted_at = self.now
            score.save()
            self._count("credit_adjustments", True)

    # ── scout assignments / field verification ────────────────────────────

    def _seed_scout_assignments(self):
        for owner in (self.long_owner, self.pending_owner_2):
            _, created = ScoutAssignment.objects.get_or_create(
                business_owner=owner, scout=self.scout, defaults={"assigned_by": self.admin},
            )
            self._count("scout_assignments", created)
        visited, created = ScoutAssignment.objects.get_or_create(
            business_owner=self.pending_owner_3, scout=self.scout,
            defaults={
                "assigned_by": self.admin, "status": ScoutAssignment.VISITED,
                "address_confirmed": False, "corrected_address": "AK-077-1293",
                "business_legitimate": True, "details_correct": True,
                "notes": (
                    "Shop is real and trading — met the owner, Ghana Card matched. The stated Ghana "
                    "Post code points two plots down the road; corrected to the shop's own code."
                ),
                "visited_at": self.now,
            },
        )
        self._count("scout_assignments", created)
        if created:
            profile = self.pending_owner_3.profile
            profile.gps_address = visited.corrected_address
            profile.address_verified = True
            profile.address_verified_by = self.scout
            profile.address_verified_at = self.now
            profile.save(update_fields=[
                "gps_address", "address_verified", "address_verified_by", "address_verified_at",
            ])

    # ── contact messages ──────────────────────────────────────────────────

    def _seed_contact_messages(self):
        rows = [
            (ContactMessage.SUPPORT, "Akosua Serwaa Owusu-Ansah Bonsu-Agyemang", LONG_EMAIL,
             "+233 24 000 0101",
             "Refund still not received three weeks after the seller agreed to cancel my order",
             "I ordered a phone on the 2nd and the seller agreed on the 4th to cancel because it was "
             "out of stock. Your support team said the refund would take 5–7 working days. It has now "
             "been three weeks and nothing has come back to my MTN MoMo wallet.\n\nI have the "
             "cancellation message and the payment reference AH-ORDER_CHECKOUT-SEED7Q4K9X2M1P8R5T3V6W0Y. "
             "Please tell me who is handling this and when I will be paid.",
             ContactMessage.NEW),
            (ContactMessage.SALES, "Kwabena Asiedu", "k.asiedu@example.com", "",
             "Advertising on the homepage slider", "How much does a hero slot cost for a hotel?",
             ContactMessage.NEW),
            (ContactMessage.ACCOUNT, "Mavis Ofori", "mavis.ofori@example.com", "+233 20 111 2222",
             "Can't verify my phone number", "The code never arrives on my Vodafone line.",
             ContactMessage.NEW),
            (ContactMessage.GENERAL, "Daniel Kyei", "daniel.kyei@example.com", "",
             "Partnership with KNUST students' union", "We'd like to list campus events.",
             ContactMessage.READ),
            (ContactMessage.SUPPORT, "Gifty Amponsah", "gifty.a@example.com", "",
             "Wrong delivery address", "Fixed with the courier, thank you.", ContactMessage.RESOLVED),
        ]
        for category, name, email, phone, subject, message, status in rows:
            _, created = ContactMessage.objects.get_or_create(
                email=email, subject=subject,
                defaults={
                    "category": category, "name": name, "phone": phone, "message": message,
                    "status": status,
                    "resolved_by": self.support if status == ContactMessage.RESOLVED else None,
                    "resolved_at": self.now if status == ContactMessage.RESOLVED else None,
                },
            )
            self._count("contact_messages", created)

    # ── messaging / support tickets ───────────────────────────────────────

    def _seed_conversation(self, subject, messages, *, customer=None, business_owner=None,
                           status=Conversation.OPEN):
        """Always a thread with AshantiHub Support *about* a business — never
        with the business itself (root CLAUDE.md product rule)."""
        lookup = {"customer": customer} if customer else {"business_owner": business_owner}
        conversation, created = Conversation.objects.get_or_create(
            subject=subject, **lookup, defaults={"status": status},
        )
        self._count("conversations", created)
        if created:
            for sender_type, body in messages:
                Message.objects.create(conversation=conversation, sender_type=sender_type, body=body)

    def _seed_conversations(self):
        C, B, S = Message.CUSTOMER, Message.BUSINESS_OWNER, Message.STAFF
        self._seed_conversation(
            f"Re: {LONG_LISTING_NAME}",
            [
                (C, "Hello, I want to order the full Adwinasa cloth for my wedding on the 14th. Can "
                    "AshantiHub confirm the weaver can deliver to Accra in time?"),
                (S, "Hi Akosua, thanks for reaching out. We've checked with the business through our "
                    "partner desk: a full cloth takes about ten days, so ordering this week is safe."),
                (C, "Great. My reference from the last order was "
                    "AH-ORDER_CHECKOUT-SEED7Q4K9X2M1P8R5T3V6W0YKUMASIADUM0001HUBTELTX — can you link it?"),
            ],
            customer=self.long_customer,
        )
        self._seed_conversation(
            "Re: Golden Tulip Kumasi City",
            [
                (C, "Is airport pickup included with the room?"),
                (S, "It isn't included, but the Kumasi Airport Shuttle listing can be booked separately."),
            ],
            customer=self.ama,
        )
        self._seed_conversation(
            "Re: Bonwire Kente Weavers",
            [
                (B, "A buyer opened a dispute about a strip vs a full cloth. Our photos are updated — "
                    "what else do you need from us to close it?"),
                (S, "Thanks Abena. The dispute is resolved with a partial refund; nothing further needed."),
                (B, "Understood, thank you."),
            ],
            business_owner=self.abena,
        )
        self._seed_conversation(
            "Re: Auntie Muni Waakye",
            [(C, "The plate I received was cold."), (S, "Sorry about that — we've passed it on.")],
            customer=self.kofi, status=Conversation.CLOSED,
        )
