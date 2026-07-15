from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction as db_transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from events.models import Event
from listings.models import Category, Listing, Zone

from qa.models import Question


class QuestionModelConstraintTests(TestCase):
    def setUp(self):
        self.asker = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200771122", password_hash="x",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207771122", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
        )
        self.event = Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_business=self.owner,
            name="Test Durbar", description="A test event.", address="Test address",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
        )

    def _make(self, **overrides):
        kwargs = dict(
            target_type=Question.LISTING, listing=self.listing, asked_by=self.asker,
            question_text="Does this come in blue?",
        )
        kwargs.update(overrides)
        return Question(**kwargs)

    # -- CheckConstraint: exactly one of listing or event --

    def test_clean_rejects_neither_target_set(self):
        question = self._make(listing=None)
        with self.assertRaises(ValidationError):
            question.clean()

    def test_clean_rejects_both_targets_set(self):
        question = self._make(listing=self.listing, event=self.event)
        with self.assertRaises(ValidationError):
            question.clean()

    def test_clean_allows_only_listing_set(self):
        question = self._make()
        question.clean()  # should not raise

    def test_clean_allows_only_event_set(self):
        question = self._make(target_type=Question.EVENT, listing=None, event=self.event)
        question.clean()  # should not raise

    def test_db_constraint_rejects_neither_target_set(self):
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Question.objects.create(
                    target_type=Question.LISTING, asked_by=self.asker,
                    question_text="Does this come in blue?",
                )

    def test_db_constraint_rejects_both_targets_set(self):
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Question.objects.create(
                    target_type=Question.LISTING, listing=self.listing, event=self.event,
                    asked_by=self.asker, question_text="Does this come in blue?",
                )

    def test_listing_question_allowed(self):
        question = self._make()
        question.full_clean()
        question.save()
        self.assertEqual(question.listing, self.listing)

    def test_event_question_allowed(self):
        question = self._make(target_type=Question.EVENT, listing=None, event=self.event)
        question.full_clean()
        question.save()
        self.assertEqual(question.event, self.event)

    # -- defaults / no separate Answer model --

    def test_answer_fields_default_unset(self):
        question = self._make()
        question.save()
        self.assertIsNone(question.answer_text)
        self.assertIsNone(question.answered_at)

    def test_str_includes_asker_name(self):
        question = self._make()
        question.save()
        self.assertIn(self.asker.full_name, str(question))
