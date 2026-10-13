from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from orders.models import Order, OrderItem
from reviews.models import Review
from reviews.reasons import HIDE_REASONS


class SupportReviewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Kofi Trader", login_phone="+233207883310", password_hash="x")
        self.author = Customer.objects.create(
            full_name="Nii Armah", phone="+233200883310", email="nii@example.com", password_hash="x",
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"),
            name="Test Lodge", description="A lodge.", contact_phone="+233207112233",
            price_amount="100.00", status=Listing.PUBLISHED,
        )
        self.review = Review.objects.create(
            target_type=Review.LISTING, listing=self.listing, author=self.author, rating=5,
            comment="Great, call 024 555 0199", verified=True, status=Review.PENDING,
        )
        self.support = StaffUser.objects.create(
            full_name="Esi Nyarko", email="support-sr@example.com", password_hash="x", role=Role.objects.get(name="support"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Mark Eting", email="mkt-sr@example.com", password_hash="x", role=Role.objects.get(name="marketing"),
        )

    def auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def hide(self, **body):
        return self.client.post(f"/api/reviews/moderation/{self.review.pk}/hide/", body, format="json")

    def test_hide_with_a_reason_code_stores_it_and_tells_the_reviewer_in_app_and_by_email(self):
        self.auth(self.support)
        response = self.hide(reason_code="contact_details")
        self.assertEqual(response.status_code, 200, response.content)
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, Review.HIDDEN)
        self.assertEqual(self.review.hidden_reason_code, "contact_details")
        self.assertEqual(self.review.hidden_reason, HIDE_REASONS["contact_details"][0])
        self.assertIn("Kofi Trader", self.review.hidden_message)
        note = Notification.objects.get(customer=self.author, kind="review_hidden")
        self.assertEqual(note.body, self.review.hidden_message)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["nii@example.com"])
        self.assertNotIn("Esi", mail.outbox[0].body)  # the reviewer is not told who hid it

    def test_an_edited_message_is_what_is_stored_and_sent(self):
        self.auth(self.support)
        self.hide(reason_code="spam", message="Please post it again without the advert.")
        self.review.refresh_from_db()
        self.assertEqual(self.review.hidden_message, "Please post it again without the advert.")
        self.assertEqual(mail.outbox[0].body, "Please post it again without the advert.")

    def test_all_seven_reasons_are_accepted_and_an_unknown_one_is_not(self):
        self.assertEqual(len(HIDE_REASONS), 7)
        self.auth(self.support)
        self.assertEqual(self.hide(reason_code="made_up").status_code, 400)
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, Review.PENDING)
        for code in HIDE_REASONS:
            Review.objects.filter(pk=self.review.pk).update(status=Review.PENDING)
            self.assertEqual(self.hide(reason_code=code).status_code, 200, code)

    def test_the_legacy_free_text_reason_still_works_and_sends_nothing(self):
        self.auth(self.support)
        self.assertEqual(self.hide(reason="spam").status_code, 200)
        self.assertEqual(Notification.objects.filter(customer=self.author).count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_hide_needs_a_reason_and_the_permission(self):
        self.auth(self.support)
        self.assertEqual(self.hide().status_code, 400)
        self.auth(self.marketing)
        self.assertEqual(self.hide(reason_code="spam").status_code, 403)

    def test_the_hidden_message_never_reaches_the_public_review_list(self):
        self.auth(self.support)
        self.hide(reason_code="spam")
        Review.objects.filter(pk=self.review.pk).update(status=Review.PUBLISHED)
        public = self.client.get(f"/api/reviews/listing/{self.listing.pk}/")
        self.assertNotIn("hidden_message", str(public.json()))

    def test_order_id_is_shown_only_when_one_paid_order_matches(self):
        self.auth(self.support)

        def row():
            return self.client.get("/api/reviews/moderation/?status=pending").json()["results"][0]

        self.assertIsNone(row()["order_id"])
        orders = []
        for _ in range(2):
            order = Order.objects.create(customer=self.author, status=Order.PAID, total_amount="100.00")
            OrderItem.objects.create(order=order, listing=self.listing, quantity=1, unit_price="100.00", line_total="100.00")
            orders.append(order)
        self.assertIsNone(row()["order_id"])  # two candidates: not guessed
        orders[1].delete()
        self.assertEqual(row()["order_id"], orders[0].pk)
        self.assertEqual(row()["about_name"], "Kofi Trader")
