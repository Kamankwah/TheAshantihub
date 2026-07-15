from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import Category, Zone

from events.models import Event


class EventVisibilityTests(TestCase):
    """Core correctness risk: teaser-vs-full-detail split
    (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6). Public event -> full detail
    always. Private event -> teaser without code, full detail with the
    correct code (both ?code= and /unlock/), teaser with wrong/missing code.
    Organizer always sees their own full detail + code regardless of
    access_level. Non-live events (pending, approved-but-unpaid, expired,
    rejected) never appear at all.
    """

    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200771166", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200771177", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")
        self.now = timezone.now()

    def _make_event(self, **overrides):
        kwargs = dict(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar at Manhyia Palace.",
            address="Manhyia Palace, Kumasi", lat="6.700000", lng="-1.620000",
            event_date=self.now + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED, paid_at=self.now, expires_at=self.now + timezone.timedelta(days=14),
        )
        kwargs.update(overrides)
        return Event.objects.create(**kwargs)

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    # -- teaser field set on the list endpoint --

    def test_list_shows_teaser_fields_only(self):
        event = self._make_event()
        response = self.client.get("/api/events/")
        self.assertEqual(response.status_code, 200, response.content)
        item = response.json()["results"][0]
        self.assertEqual(item["id"], event.id)
        expected_keys = {
            "id", "name", "category", "zone", "event_date", "hero_media", "is_private",
            "avg_rating", "review_count",
        }
        self.assertEqual(set(item.keys()), expected_keys)
        self.assertNotIn("address", item)
        self.assertNotIn("lat", item)
        self.assertNotIn("lng", item)
        self.assertNotIn("going_count", item)
        self.assertNotIn("access_code", item)

    def test_list_includes_private_events_as_teasers(self):
        self._make_event(access_level=Event.PRIVATE)
        response = self.client.get("/api/events/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["results"]), 1)
        self.assertTrue(response.json()["results"][0]["is_private"])

    def test_list_excludes_pending_events(self):
        self._make_event(status=Event.PENDING, paid_at=None, expires_at=None)
        response = self.client.get("/api/events/")
        self.assertEqual(response.json()["results"], [])

    def test_list_excludes_approved_but_unpaid_events(self):
        self._make_event(paid_at=None, expires_at=None)
        response = self.client.get("/api/events/")
        self.assertEqual(response.json()["results"], [])

    def test_list_excludes_expired_events(self):
        self._make_event(
            paid_at=self.now - timezone.timedelta(days=20),
            expires_at=self.now - timezone.timedelta(days=1),
        )
        response = self.client.get("/api/events/")
        self.assertEqual(response.json()["results"], [])

    def test_list_excludes_rejected_events(self):
        self._make_event(status=Event.REJECTED, paid_at=None, expires_at=None)
        response = self.client.get("/api/events/")
        self.assertEqual(response.json()["results"], [])

    def test_list_filters_by_category(self):
        self._make_event()
        other_category = Category.objects.get(slug="durbar")
        self._make_event(category=other_category, name="Manhyia Durbar")
        response = self.client.get("/api/events/", {"category": "durbar"})
        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "Manhyia Durbar")

    def test_list_search_matches_name(self):
        self._make_event(name="Kumasi Cultural Festival")
        self._make_event(name="Something Else Entirely")
        response = self.client.get("/api/events/", {"search": "Cultural"})
        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "Kumasi Cultural Festival")

    # -- detail endpoint: public event --

    def test_detail_public_event_returns_full_detail(self):
        event = self._make_event(access_level=Event.PUBLIC)
        response = self.client.get(f"/api/events/{event.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["address"], "Manhyia Palace, Kumasi")
        self.assertIn("lat", body)
        self.assertIn("going_count", body)
        self.assertNotIn("access_code", body)

    def test_detail_pending_event_is_404(self):
        event = self._make_event(status=Event.PENDING, paid_at=None, expires_at=None)
        response = self.client.get(f"/api/events/{event.id}/")
        self.assertEqual(response.status_code, 404)

    def test_detail_approved_unpaid_event_is_404(self):
        event = self._make_event(paid_at=None, expires_at=None)
        response = self.client.get(f"/api/events/{event.id}/")
        self.assertEqual(response.status_code, 404)

    def test_detail_expired_event_is_404(self):
        event = self._make_event(
            paid_at=self.now - timezone.timedelta(days=20),
            expires_at=self.now - timezone.timedelta(days=1),
        )
        response = self.client.get(f"/api/events/{event.id}/")
        self.assertEqual(response.status_code, 404)

    # -- detail endpoint: private event --

    def test_detail_private_event_without_code_returns_teaser(self):
        event = self._make_event(access_level=Event.PRIVATE)
        response = self.client.get(f"/api/events/{event.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertNotIn("address", body)
        self.assertTrue(body["is_private"])

    def test_detail_private_event_with_wrong_code_returns_teaser(self):
        event = self._make_event(access_level=Event.PRIVATE)
        response = self.client.get(f"/api/events/{event.id}/", {"code": "wrong-code"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("address", response.json())

    def test_detail_private_event_with_correct_code_returns_full_detail(self):
        event = self._make_event(access_level=Event.PRIVATE)
        response = self.client.get(f"/api/events/{event.id}/", {"code": event.access_code})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["address"], "Manhyia Palace, Kumasi")
        self.assertIn("going_count", body)

    # -- unlock endpoint --

    def test_unlock_private_event_with_correct_code_returns_full_detail(self):
        event = self._make_event(access_level=Event.PRIVATE)
        response = self.client.post(
            f"/api/events/{event.id}/unlock/", {"code": event.access_code}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["address"], "Manhyia Palace, Kumasi")

    def test_unlock_private_event_with_wrong_code_is_403(self):
        event = self._make_event(access_level=Event.PRIVATE)
        response = self.client.post(
            f"/api/events/{event.id}/unlock/", {"code": "totally-wrong"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_unlock_public_event_returns_full_detail(self):
        event = self._make_event(access_level=Event.PUBLIC)
        response = self.client.post(
            f"/api/events/{event.id}/unlock/", {"code": "irrelevant"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["address"], "Manhyia Palace, Kumasi")

    def test_unlock_non_live_event_is_404(self):
        event = self._make_event(status=Event.PENDING, paid_at=None, expires_at=None)
        response = self.client.post(
            f"/api/events/{event.id}/unlock/", {"code": "whatever"}, format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_unlock_requires_code_field(self):
        event = self._make_event(access_level=Event.PRIVATE)
        response = self.client.post(f"/api/events/{event.id}/unlock/", {}, format="json")
        self.assertEqual(response.status_code, 400)

    # -- organizer's own view --

    def test_mine_shows_full_detail_and_code_for_own_private_event_regardless_of_status(self):
        event = self._make_event(
            access_level=Event.PRIVATE, status=Event.PENDING, paid_at=None, expires_at=None,
        )
        self._auth(issue_token(self.customer, "customer"))
        response = self.client.get("/api/events/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        results = response.json()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], event.id)
        self.assertEqual(results[0]["access_code"], event.access_code)
        self.assertEqual(results[0]["address"], "Manhyia Palace, Kumasi")

    def test_mine_only_returns_own_events(self):
        self._make_event(submitted_by_customer=self.other_customer)
        self._auth(issue_token(self.customer, "customer"))
        response = self.client.get("/api/events/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), [])

    def test_mine_works_for_business_owner_submitter(self):
        owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207771188", password_hash="x",
        )
        event = self._make_event(submitted_by_customer=None, submitted_by_business=owner)
        self._auth(issue_token(owner, "business_owner"))
        response = self.client.get("/api/events/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()[0]["id"], event.id)

    def test_mine_requires_authentication(self):
        response = self.client.get("/api/events/mine/")
        self.assertEqual(response.status_code, 401)

    def test_mine_forbidden_for_staff(self):
        from accounts.models import Role, StaffUser

        staff = StaffUser.objects.create(
            full_name="Staffer", email="staffer-mine@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self._auth(issue_token(staff, "staff"))
        response = self.client.get("/api/events/mine/")
        self.assertEqual(response.status_code, 403)
