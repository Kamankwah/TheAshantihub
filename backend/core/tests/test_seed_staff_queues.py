import shutil
import tempfile
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from accounts.models import BusinessOwner, Customer, ScoutAssignment, StaffUser
from billing.models import SubscriptionPlan, Transaction
from contact.models import ContactMessage
from credit.models import LendingPartner, LoanApplication
from disputes.models import Dispute
from events.models import Event, Ticket
from listings.models import HeroMediaSubmission, Listing, Promotion
from messaging.models import Conversation, Message
from orders.models import DeliveryAssignment, Order
from reviews.models import Review

TEMP_MEDIA = tempfile.mkdtemp(prefix="seed-staff-queues-test-")


def _seed():
    call_command("seed_dev_data", stdout=StringIO())
    call_command("seed_staff_queues", stdout=StringIO())


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class SeedStaffQueuesTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEMP_MEDIA, ignore_errors=True)

    @override_settings(DEBUG=False)
    def test_refuses_to_run_without_debug(self):
        with self.assertRaises(CommandError) as ctx:
            call_command("seed_staff_queues", stdout=StringIO())
        self.assertIn("DEBUG", str(ctx.exception))
        self.assertFalse(BusinessOwner.objects.filter(login_phone="+233209100001").exists())

    @override_settings(DEBUG=True)
    def test_requires_seed_dev_data_first(self):
        with self.assertRaises(CommandError) as ctx:
            call_command("seed_staff_queues", stdout=StringIO())
        self.assertIn("seed_dev_data", str(ctx.exception))

    @override_settings(DEBUG=True)
    def test_requires_seed_dev_data_listings_and_events(self):
        call_command("seed_dev_data", stdout=StringIO())
        Listing.objects.filter(name="Adum Electronics Hub").delete()
        with self.assertRaises(CommandError) as ctx:
            call_command("seed_staff_queues", stdout=StringIO())
        self.assertIn("Adum Electronics Hub", str(ctx.exception))
        self.assertIn("seed_dev_data", str(ctx.exception))
        # Atomic and checked up front: nothing was written.
        self.assertFalse(BusinessOwner.objects.filter(login_phone="+233209100001").exists())

    @override_settings(DEBUG=True)
    def test_only_terminal_loan_decisions_record_a_reviewer(self):
        _seed()
        under_review = LoanApplication.objects.get(status=LoanApplication.UNDER_REVIEW)
        self.assertIsNone(under_review.reviewed_by)
        self.assertIsNone(under_review.reviewed_at)
        for loan in LoanApplication.objects.filter(status__in=LoanApplication.FINAL_STATUSES):
            self.assertIsNotNone(loan.reviewed_by)
        for loan in LoanApplication.objects.filter(status=LoanApplication.SUBMITTED):
            self.assertIsNone(loan.reviewed_by)

    @override_settings(DEBUG=True)
    def test_populates_representative_pending_queues(self):
        _seed()
        self.assertGreaterEqual(BusinessOwner.objects.filter(kyc_status=BusinessOwner.PENDING).count(), 3)
        self.assertGreaterEqual(Listing.objects.filter(status=Listing.PENDING_REVIEW).count(), 3)
        self.assertGreaterEqual(
            HeroMediaSubmission.objects.filter(status=HeroMediaSubmission.PENDING).count(), 3
        )
        self.assertGreaterEqual(Review.objects.filter(status=Review.PENDING).count(), 3)
        self.assertGreaterEqual(ContactMessage.objects.filter(status=ContactMessage.NEW).count(), 3)
        self.assertGreaterEqual(
            Dispute.objects.filter(status__in=[Dispute.OPEN, Dispute.INVESTIGATING]).count(), 3
        )
        self.assertTrue(Ticket.objects.filter(escrow_status=Ticket.HELD).exists())
        self.assertTrue(Ticket.objects.filter(escrow_status=Ticket.RELEASED).exists())
        # Deliberately long values are the point of the exercise.
        self.assertTrue(
            Customer.objects.filter(email="verylongcustomeremailaddressfortesting@example-domain.com").exists()
        )
        self.assertTrue(Listing.objects.filter(name__regex=r"^.{70}$").exists())

    @override_settings(DEBUG=True)
    def test_support_conversations_are_with_ashantihub_about_a_business(self):
        _seed()
        conversations = Conversation.objects.all()
        self.assertGreaterEqual(conversations.count(), 3)
        for conversation in conversations:
            self.assertTrue(conversation.subject.startswith("Re: "), conversation.subject)
        sender_types = set(Message.objects.values_list("sender_type", flat=True))
        self.assertEqual(sender_types, {Message.CUSTOMER, Message.BUSINESS_OWNER, Message.STAFF})

    @override_settings(DEBUG=True)
    def test_second_run_does_not_duplicate(self):
        _seed()
        models = [BusinessOwner, Customer, StaffUser, Listing, HeroMediaSubmission, Event, Review,
                  SubscriptionPlan, Transaction, Order, DeliveryAssignment, Ticket, Dispute, Promotion,
                  LendingPartner, LoanApplication, ScoutAssignment, ContactMessage, Conversation,
                  Message]
        before = {m.__name__: m.objects.count() for m in models}
        call_command("seed_staff_queues", stdout=StringIO())
        after = {m.__name__: m.objects.count() for m in models}
        self.assertEqual(before, after)

    @override_settings(DEBUG=True)
    def test_every_staff_role_has_a_loggable_seeded_user_with_its_role_permissions(self):
        # super_admin is create_super_admin-only (single-bootstrap rule); the
        # dev seeds cover every other role. Together they give one account per
        # role for auditing the staff dashboard as that role.
        from django.contrib.auth.hashers import check_password

        from accounts.models import Role
        from core.management.commands.seed_dev_data import DEV_PASSWORD

        call_command(
            "create_super_admin", full_name="Seed Super", email="super.seed@example.com",
            password=DEV_PASSWORD, stdout=StringIO(),
        )
        _seed()
        for role_name, _label in Role.NAME_CHOICES:
            with self.subTest(role=role_name):
                role = Role.objects.get(name=role_name)
                loggable = StaffUser.objects.filter(
                    role=role, is_active=True, is_suspended=False, invite_token__isnull=True,
                )
                self.assertTrue(loggable.exists(), f"no loggable seeded staffer for {role_name}")
                staff = loggable.first()
                self.assertTrue(check_password(DEV_PASSWORD, staff.password_hash))
                # The role mapping, not a hand-picked set: no per-staffer overrides.
                role_codenames = set(role.permissions.values_list("codename", flat=True))
                self.assertTrue(role_codenames, f"{role_name} has no permissions seeded")
                self.assertEqual(staff.effective_permission_codenames(), role_codenames)
