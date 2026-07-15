from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from events.models import Event
from listings.models import Category, Listing, Zone

from qa.models import Question


class QAFlowTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207884400", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Abena Trader", login_phone="+233207884401", password_hash="x",
        )
        self.asker = Customer.objects.create(
            full_name="Ama Asker", phone="+233200884400", password_hash="x",
        )
        self.organizer_customer = Customer.objects.create(
            full_name="Akosua Organizer", phone="+233200884401", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Other", phone="+233200884402", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
            price_amount="100.00", status=Listing.PUBLISHED,
        )
        self.business_event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone,
            submitted_by_business=self.owner,
            name="Business Durbar", description="A test event.", address="Test address",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
        )
        self.customer_event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=self.zone,
            submitted_by_customer=self.organizer_customer,
            name="Customer Durbar", description="A test event.", address="Test address",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
        )

    def _auth(self, user, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(user, kind)}")


class QuestionAskTests(QAFlowTestsBase):
    def test_customer_can_ask_listing_question(self):
        self._auth(self.asker, "customer")
        response = self.client.post(
            "/api/qa/questions/",
            {"target_type": "listing", "target_id": self.listing.id, "question_text": "Does this come in blue?"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        question = Question.objects.get(listing=self.listing)
        self.assertEqual(question.asked_by, self.asker)
        self.assertIsNone(question.answer_text)

    def test_customer_can_ask_event_question(self):
        self._auth(self.asker, "customer")
        response = self.client.post(
            "/api/qa/questions/",
            {"target_type": "event", "target_id": self.business_event.id, "question_text": "Is parking available?"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_business_owner_cannot_ask(self):
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            "/api/qa/questions/",
            {"target_type": "listing", "target_id": self.listing.id, "question_text": "?"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_ask(self):
        response = self.client.post(
            "/api/qa/questions/",
            {"target_type": "listing", "target_id": self.listing.id, "question_text": "?"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_ask_for_nonexistent_listing_is_404(self):
        self._auth(self.asker, "customer")
        response = self.client.post(
            "/api/qa/questions/",
            {"target_type": "listing", "target_id": 999999, "question_text": "?"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)


class QuestionAnswerTests(QAFlowTestsBase):
    def test_listing_owner_can_answer(self):
        question = Question.objects.create(
            target_type=Question.LISTING, listing=self.listing, asked_by=self.asker,
            question_text="Does this come in blue?",
        )
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            f"/api/qa/questions/{question.id}/answer/", {"answer_text": "Yes, in blue and red."}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        question.refresh_from_db()
        self.assertEqual(question.answer_text, "Yes, in blue and red.")
        self.assertIsNotNone(question.answered_at)

    def test_non_owner_business_cannot_answer(self):
        question = Question.objects.create(
            target_type=Question.LISTING, listing=self.listing, asked_by=self.asker,
            question_text="Does this come in blue?",
        )
        self._auth(self.other_owner, "business_owner")
        response = self.client.post(
            f"/api/qa/questions/{question.id}/answer/", {"answer_text": "Yes."}, format="json",
        )
        self.assertEqual(response.status_code, 403)
        question.refresh_from_db()
        self.assertIsNone(question.answer_text)

    def test_random_customer_cannot_answer(self):
        question = Question.objects.create(
            target_type=Question.LISTING, listing=self.listing, asked_by=self.asker,
            question_text="Does this come in blue?",
        )
        self._auth(self.other_customer, "customer")
        response = self.client.post(
            f"/api/qa/questions/{question.id}/answer/", {"answer_text": "Yes."}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_business_organizer_can_answer_event_question(self):
        question = Question.objects.create(
            target_type=Question.EVENT, event=self.business_event, asked_by=self.asker,
            question_text="Is parking available?",
        )
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            f"/api/qa/questions/{question.id}/answer/", {"answer_text": "Yes, free parking."}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_customer_organizer_can_answer_own_event_question(self):
        question = Question.objects.create(
            target_type=Question.EVENT, event=self.customer_event, asked_by=self.asker,
            question_text="Is parking available?",
        )
        self._auth(self.organizer_customer, "customer")
        response = self.client.post(
            f"/api/qa/questions/{question.id}/answer/", {"answer_text": "Yes, free parking."}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_asker_cannot_answer_own_question(self):
        question = Question.objects.create(
            target_type=Question.EVENT, event=self.customer_event, asked_by=self.asker,
            question_text="Is parking available?",
        )
        self._auth(self.asker, "customer")
        response = self.client.post(
            f"/api/qa/questions/{question.id}/answer/", {"answer_text": "Yes."}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_answer_requires_non_empty_text(self):
        question = Question.objects.create(
            target_type=Question.LISTING, listing=self.listing, asked_by=self.asker,
            question_text="Does this come in blue?",
        )
        self._auth(self.owner, "business_owner")
        response = self.client.post(
            f"/api/qa/questions/{question.id}/answer/", {"answer_text": "   "}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_unauthenticated_cannot_answer(self):
        question = Question.objects.create(
            target_type=Question.LISTING, listing=self.listing, asked_by=self.asker,
            question_text="Does this come in blue?",
        )
        response = self.client.post(
            f"/api/qa/questions/{question.id}/answer/", {"answer_text": "Yes."}, format="json",
        )
        self.assertEqual(response.status_code, 401)


class QuestionListTests(QAFlowTestsBase):
    def test_listing_question_list_is_public(self):
        Question.objects.create(
            target_type=Question.LISTING, listing=self.listing, asked_by=self.asker,
            question_text="Does this come in blue?",
        )
        response = self.client.get(f"/api/qa/questions/listing/{self.listing.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_event_question_list_is_public(self):
        Question.objects.create(
            target_type=Question.EVENT, event=self.business_event, asked_by=self.asker,
            question_text="Is parking available?",
        )
        response = self.client.get(f"/api/qa/questions/event/{self.business_event.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["results"]), 1)
