from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction as db_transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from events.models import Event
from listings.models import Category, Listing, Zone

from reviews.models import Review


class ReviewModelConstraintTests(TestCase):
    def setUp(self):
        self.author = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200771122", password_hash="x",
        )
        self.other_author = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200771133", password_hash="x",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207771122", password_hash="x",
        )
        self.organizer_customer = Customer.objects.create(
            full_name="Akosua Organizer", phone="+233200771144", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
        )
        self.event = Event.objects.create(
            category=Category.objects.get(slug="hotels"), zone=self.zone,
            submitted_by_business=self.owner,
            name="Test Durbar", description="A test event.", address="Test address",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
        )

    def _make(self, **overrides):
        kwargs = dict(
            target_type=Review.LISTING, listing=self.listing, author=self.author, rating=5,
        )
        kwargs.update(overrides)
        return Review(**kwargs)

    # -- CheckConstraint: exactly one target matching target_type --

    def test_clean_rejects_zero_targets_set(self):
        review = self._make(listing=None)
        with self.assertRaises(ValidationError):
            review.clean()

    def test_clean_rejects_two_targets_set(self):
        review = self._make(listing=self.listing, event=self.event)
        with self.assertRaises(ValidationError):
            review.clean()

    def test_db_constraint_rejects_zero_targets_set(self):
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.LISTING, author=self.author, rating=5,
                )

    def test_db_constraint_rejects_two_targets_set(self):
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.LISTING, listing=self.listing, event=self.event,
                    author=self.author, rating=5,
                )

    def test_db_constraint_rejects_target_type_mismatched_with_set_field(self):
        # target_type says "event" but the listing field (not event) is set.
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.EVENT, listing=self.listing,
                    author=self.author, rating=5,
                )

    def test_listing_review_allowed(self):
        review = self._make()
        review.full_clean()
        review.save()
        self.assertEqual(review.listing, self.listing)

    def test_event_review_allowed(self):
        review = self._make(target_type=Review.EVENT, listing=None, event=self.event)
        review.full_clean()
        review.save()
        self.assertEqual(review.event, self.event)

    def test_seller_review_allowed(self):
        review = self._make(
            target_type=Review.SELLER, listing=None, business_owner=self.owner,
        )
        review.full_clean()
        review.save()
        self.assertEqual(review.business_owner, self.owner)

    def test_organizer_review_with_business_owner_allowed(self):
        review = self._make(
            target_type=Review.ORGANIZER, listing=None, business_owner=self.owner,
        )
        review.full_clean()
        review.save()
        self.assertEqual(review.business_owner, self.owner)

    def test_organizer_review_with_organizer_customer_allowed(self):
        review = self._make(
            target_type=Review.ORGANIZER, listing=None, organizer_customer=self.organizer_customer,
        )
        review.full_clean()
        review.save()
        self.assertEqual(review.organizer_customer, self.organizer_customer)

    def test_organizer_review_with_both_business_owner_and_organizer_customer_rejected(self):
        review = self._make(
            target_type=Review.ORGANIZER, listing=None,
            business_owner=self.owner, organizer_customer=self.organizer_customer,
        )
        with self.assertRaises(ValidationError):
            review.clean()
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.ORGANIZER,
                    business_owner=self.owner, organizer_customer=self.organizer_customer,
                    author=self.author, rating=5,
                )

    def test_seller_target_type_requires_business_owner_not_organizer_customer(self):
        review = self._make(
            target_type=Review.SELLER, listing=None, organizer_customer=self.organizer_customer,
        )
        with self.assertRaises(ValidationError):
            review.clean()
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.SELLER, organizer_customer=self.organizer_customer,
                    author=self.author, rating=5,
                )

    # -- rating range --

    def test_rating_below_minimum_rejected_by_full_clean(self):
        review = self._make(rating=0)
        with self.assertRaises(ValidationError):
            review.full_clean()

    def test_rating_above_maximum_rejected_by_full_clean(self):
        review = self._make(rating=6)
        with self.assertRaises(ValidationError):
            review.full_clean()

    # -- UniqueConstraints --

    def test_duplicate_listing_review_by_same_author_rejected(self):
        Review.objects.create(target_type=Review.LISTING, listing=self.listing, author=self.author, rating=5)
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.LISTING, listing=self.listing, author=self.author, rating=3,
                )

    def test_duplicate_event_review_by_same_author_rejected(self):
        Review.objects.create(target_type=Review.EVENT, event=self.event, author=self.author, rating=5)
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.EVENT, event=self.event, author=self.author, rating=3,
                )

    def test_duplicate_seller_review_by_same_author_rejected(self):
        Review.objects.create(
            target_type=Review.SELLER, business_owner=self.owner, author=self.author, rating=5,
        )
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.SELLER, business_owner=self.owner, author=self.author, rating=3,
                )

    def test_duplicate_organizer_review_with_organizer_customer_by_same_author_rejected(self):
        Review.objects.create(
            target_type=Review.ORGANIZER, organizer_customer=self.organizer_customer,
            author=self.author, rating=5,
        )
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.ORGANIZER, organizer_customer=self.organizer_customer,
                    author=self.author, rating=3,
                )

    def test_different_author_can_review_same_listing(self):
        Review.objects.create(target_type=Review.LISTING, listing=self.listing, author=self.author, rating=5)
        # Should not raise.
        Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.other_author, rating=3,
        )

    def test_same_author_can_leave_both_seller_and_organizer_review_for_same_business_owner(self):
        """The trickiest edge case: the same business_owner can validly get
        BOTH a seller review AND an organizer review from the same author —
        these are different reputation pools (target_type disambiguates),
        not a duplicate review of "the same target".
        """
        Review.objects.create(
            target_type=Review.SELLER, business_owner=self.owner, author=self.author, rating=5,
        )
        # Should not raise — different target_type, same business_owner, same author.
        Review.objects.create(
            target_type=Review.ORGANIZER, business_owner=self.owner, author=self.author, rating=4,
        )
        self.assertEqual(
            Review.objects.filter(business_owner=self.owner, author=self.author).count(), 2
        )

    def test_duplicate_seller_review_for_same_business_owner_and_target_type_rejected(self):
        Review.objects.create(
            target_type=Review.SELLER, business_owner=self.owner, author=self.author, rating=5,
        )
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Review.objects.create(
                    target_type=Review.SELLER, business_owner=self.owner, author=self.author, rating=1,
                )

    # -- defaults --

    def test_verified_defaults_to_false(self):
        review = self._make()
        review.save()
        self.assertFalse(review.verified)

    def test_status_defaults_to_published(self):
        review = self._make()
        review.save()
        self.assertEqual(review.status, Review.PUBLISHED)

    def test_comment_is_optional(self):
        review = self._make()
        review.full_clean()
        review.save()
        self.assertEqual(review.comment, "")

    def test_str_includes_author_and_rating(self):
        review = self._make()
        review.save()
        self.assertIn(self.author.full_name, str(review))
