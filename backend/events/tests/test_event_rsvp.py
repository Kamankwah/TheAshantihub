from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from listings.models import Category, Zone

from events.models import Event, EventRSVP


class EventRSVPTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.organizer = Customer.objects.create(
            full_name="Ama Organizer", phone="+233200552211", password_hash="x",
        )
        self.attendee = Customer.objects.create(
            full_name="Yaw Attendee", phone="+233200552222", password_hash="x",
        )
        self.other_attendee = Customer.objects.create(
            full_name="Kwame Attendee", phone="+233200552233", password_hash="x",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207552211", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        self.now = timezone.now()

    def _make_event(self, **overrides):
        kwargs = dict(
            category=self.category, zone=self.zone, submitted_by_customer=self.organizer,
            name="Akwasidae Festival", description="Royal durbar at Manhyia Palace.",
            address="Manhyia Palace, Kumasi", event_date=self.now + timezone.timedelta(days=30),
            visibility_days=14, status=Event.APPROVED, paid_at=self.now,
            expires_at=self.now + timezone.timedelta(days=14),
        )
        kwargs.update(overrides)
        return Event.objects.create(**kwargs)

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")


class EventRSVPCreateTests(EventRSVPTestsBase):
    def test_customer_can_rsvp_going(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], "going")
        self.assertEqual(response.json()["going_count"], 1)
        self.assertTrue(
            EventRSVP.objects.filter(
                event=event, customer=self.attendee, status=EventRSVP.GOING
            ).exists()
        )

    def test_rsvp_updates_event_going_count(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        event.refresh_from_db()
        self.assertEqual(event.going_count, 1)

    def test_re_rsvp_when_already_going_is_noop_success(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "going")
        self.assertEqual(EventRSVP.objects.filter(event=event, customer=self.attendee).count(), 1)
        event.refresh_from_db()
        self.assertEqual(event.going_count, 1)

    def test_cancel_then_re_rsvp_works(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self.client.delete(f"/api/events/{event.id}/rsvp/")
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "going")
        event.refresh_from_db()
        self.assertEqual(event.going_count, 1)
        self.assertEqual(EventRSVP.objects.filter(event=event, customer=self.attendee).count(), 1)

    def test_multiple_attendees_increment_going_count(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self._auth(issue_token(self.other_attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        event.refresh_from_db()
        self.assertEqual(event.going_count, 2)

    def test_unauthenticated_cannot_rsvp(self):
        event = self._make_event()
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 401)

    def test_business_owner_cannot_rsvp(self):
        event = self._make_event()
        self._auth(issue_token(self.owner, "business_owner"))
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 403)

    def test_rsvp_to_non_live_event_is_404(self):
        event = self._make_event(status=Event.PENDING, paid_at=None, expires_at=None)
        self._auth(issue_token(self.attendee, "customer"))
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 404)

    # -- capacity --

    def test_rsvp_rejected_once_capacity_full(self):
        event = self._make_event(capacity=1)
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self._auth(issue_token(self.other_attendee, "customer"))
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 400, response.content)
        event.refresh_from_db()
        self.assertEqual(event.going_count, 1)

    def test_rsvp_allowed_when_under_capacity(self):
        event = self._make_event(capacity=2)
        self._auth(issue_token(self.attendee, "customer"))
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 201, response.content)

    def test_cancelled_slot_frees_up_capacity(self):
        event = self._make_event(capacity=1)
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self.client.delete(f"/api/events/{event.id}/rsvp/")
        self._auth(issue_token(self.other_attendee, "customer"))
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 201, response.content)
        event.refresh_from_db()
        self.assertEqual(event.going_count, 1)

    def test_re_rsvp_when_already_going_is_noop_even_at_capacity(self):
        event = self._make_event(capacity=1)
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 200, response.content)

    # -- private event unlock gating --

    def test_rsvp_to_private_event_without_code_is_403(self):
        event = self._make_event(access_level=Event.PRIVATE)
        self._auth(issue_token(self.attendee, "customer"))
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(EventRSVP.objects.filter(event=event, customer=self.attendee).exists())

    def test_rsvp_to_private_event_with_wrong_code_is_403(self):
        event = self._make_event(access_level=Event.PRIVATE)
        self._auth(issue_token(self.attendee, "customer"))
        response = self.client.post(
            f"/api/events/{event.id}/rsvp/", {"code": "totally-wrong"}, format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(EventRSVP.objects.filter(event=event, customer=self.attendee).exists())

    def test_rsvp_to_private_event_with_correct_code_succeeds(self):
        event = self._make_event(access_level=Event.PRIVATE)
        self._auth(issue_token(self.attendee, "customer"))
        response = self.client.post(
            f"/api/events/{event.id}/rsvp/", {"code": event.access_code}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        event.refresh_from_db()
        self.assertEqual(event.going_count, 1)

    def test_rsvp_to_public_event_ignores_code_field(self):
        event = self._make_event(access_level=Event.PUBLIC)
        self._auth(issue_token(self.attendee, "customer"))
        response = self.client.post(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 201, response.content)


class EventRSVPCancelTests(EventRSVPTestsBase):
    def test_cancel_own_rsvp(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        response = self.client.delete(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 204, response.content)
        rsvp = EventRSVP.objects.get(event=event, customer=self.attendee)
        self.assertEqual(rsvp.status, EventRSVP.CANCELLED)

    def test_cancel_decrements_going_count(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self.client.delete(f"/api/events/{event.id}/rsvp/")
        event.refresh_from_db()
        self.assertEqual(event.going_count, 0)

    def test_cancel_does_not_delete_the_row(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self.client.delete(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(EventRSVP.objects.filter(event=event, customer=self.attendee).count(), 1)

    def test_cancel_with_no_existing_rsvp_is_noop(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        response = self.client.delete(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(EventRSVP.objects.filter(event=event, customer=self.attendee).exists())

    def test_cancel_already_cancelled_rsvp_is_noop(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self.client.delete(f"/api/events/{event.id}/rsvp/")
        response = self.client.delete(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 204, response.content)

    def test_unauthenticated_cannot_cancel(self):
        event = self._make_event()
        response = self.client.delete(f"/api/events/{event.id}/rsvp/")
        self.assertEqual(response.status_code, 401)

    def test_cancel_only_affects_own_rsvp(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self._auth(issue_token(self.other_attendee, "customer"))
        self.client.delete(f"/api/events/{event.id}/rsvp/")
        event.refresh_from_db()
        self.assertEqual(event.going_count, 1)
        rsvp = EventRSVP.objects.get(event=event, customer=self.attendee)
        self.assertEqual(rsvp.status, EventRSVP.GOING)


class EventAttendeesListTests(EventRSVPTestsBase):
    def setUp(self):
        super().setUp()
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-rsvp@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.support = StaffUser.objects.create(
            full_name="Support Person", email="support-rsvp@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )

    def test_organizer_sees_attendee_list(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")

        self._auth(issue_token(self.organizer, "customer"))
        response = self.client.get(f"/api/events/{event.id}/rsvps/")
        self.assertEqual(response.status_code, 200, response.content)
        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["customer"], self.attendee.id)
        self.assertEqual(results[0]["customer_name"], self.attendee.full_name)
        self.assertEqual(results[0]["customer_phone"], self.attendee.phone)
        self.assertEqual(results[0]["status"], "going")

    def test_attendee_list_excludes_cancelled_rsvps(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")
        self.client.delete(f"/api/events/{event.id}/rsvp/")

        self._auth(issue_token(self.organizer, "customer"))
        response = self.client.get(f"/api/events/{event.id}/rsvps/")
        self.assertEqual(response.json()["results"], [])

    def test_business_owner_organizer_sees_attendee_list(self):
        event = self._make_event(submitted_by_customer=None, submitted_by_business=self.owner)
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")

        self._auth(issue_token(self.owner, "business_owner"))
        response = self.client.get(f"/api/events/{event.id}/rsvps/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_staff_with_event_approve_permission_sees_attendee_list(self):
        event = self._make_event()
        self._auth(issue_token(self.attendee, "customer"))
        self.client.post(f"/api/events/{event.id}/rsvp/")

        self._auth(issue_token(self.marketing, "staff"))
        response = self.client.get(f"/api/events/{event.id}/rsvps/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_staff_without_event_approve_permission_is_403(self):
        event = self._make_event()
        self._auth(issue_token(self.support, "staff"))
        response = self.client.get(f"/api/events/{event.id}/rsvps/")
        self.assertEqual(response.status_code, 403)

    def test_random_customer_gets_403(self):
        event = self._make_event()
        self._auth(issue_token(self.other_attendee, "customer"))
        response = self.client.get(f"/api/events/{event.id}/rsvps/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_gets_401(self):
        event = self._make_event()
        response = self.client.get(f"/api/events/{event.id}/rsvps/")
        self.assertEqual(response.status_code, 401)
