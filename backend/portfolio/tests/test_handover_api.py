import json
import re

from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile, OwnerClaimToken
from accounts.testing import make_staff, session_of, staff_token
from activity.models import ActivityEvent
from listings.models import Zone

CLAIM_URL = "/api/accounts/business-owners/claim/"
PASSWORD = "Akwaaba-Asafo-2026"


def scout_owner(scout, *, email=None):
    owner = BusinessOwner.objects.create(
        full_name="Gifty Asantewaa", login_phone="+233241234567", email=email, password_hash=make_password(None),
        kyc_status=BusinessOwner.PENDING, registration_channel=BusinessOwner.SCOUT,
        registered_by=scout, account_manager=scout,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name="Asafo Hair & Beauty", business_kind="service",
        gps_address="AK-112-0384", business_contact_phone="+233241234567",
        zone=Zone.objects.get_or_create(name="Asafo")[0],
    )
    return owner


class HandoverApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = scout_owner(self.scout, email="gifty.a@example.com")
        self.handover_url = f"/api/portfolio/businesses/{self.owner.pk}/handover/"
        self.link_url = f"/api/portfolio/businesses/{self.owner.pk}/claim-link/"

    def as_(self, staff):
        token = staff_token(staff)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return token

    def test_the_account_manager_hands_the_phone_to_the_owner(self):
        token = self.as_(self.scout)
        response = self.client.post(self.handover_url, {}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(set(body), {"token", "expires_at"})
        row = OwnerClaimToken.objects.get()
        self.assertEqual((row.channel, row.created_by, row.staff_session), ("handover", self.scout, session_of(token)))
        event = ActivityEvent.objects.get(verb="business.handover_started")
        self.assertEqual((event.actor_id, event.target_id), (self.scout.pk, str(self.owner.pk)))
        self.assertNotIn(body["token"], json.dumps([event.summary, event.before, event.after], default=str))
        self.assertFalse(ActivityEvent.objects.filter(verb="portfolio-handover").exists())
        # The owner finishes on the same phone, in the same staff session.
        claim = self.client.post(CLAIM_URL, {
            "token": body["token"], "password": PASSWORD, "password_confirm": PASSWORD, "accept_terms": True,
        }, format="json")
        self.assertEqual(claim.status_code, 200, claim.content)

    def test_who_may_start_a_hand_over(self):
        self.as_(make_staff("scout", "yaw@example.com", manager=self.lead))
        self.assertEqual(self.client.post(self.handover_url, {}, format="json").status_code, 404)
        self.as_(make_staff("support", "esi@example.com"))
        self.assertEqual(self.client.post(self.handover_url, {}, format="json").status_code, 404)
        self.as_(self.lead)  # portfolio.manage
        self.assertEqual(self.client.post(self.handover_url, {}, format="json").status_code, 201)
        self.client.credentials()
        self.assertEqual(self.client.post(self.handover_url, {}, format="json").status_code, 401)

    def test_nothing_to_hand_over_once_the_owner_has_a_login(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=timezone.now())
        self.as_(self.scout)
        for url in (self.handover_url, self.link_url):
            with self.subTest(url=url):
                response = self.client.post(url, {}, format="json")
                self.assertEqual((response.status_code, response.json()["detail"]), (400, "This owner already has a login."))
        self.assertFalse(OwnerClaimToken.objects.exists())

    def test_a_claim_link_is_emailed_masked_and_resending_replaces_it(self):
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            first = self.client.post(self.link_url, {}, format="json")
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()["sent_to"], "gi•••@example.com")
        self.assertIn("expires_at", first.json())
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["gifty.a@example.com"])
        raw = re.search(r"/business/claim\?token=([A-Za-z0-9_-]+)", mail.outbox[0].body).group(1)
        event = ActivityEvent.objects.get(verb="business.claim_link_sent")
        self.assertEqual(event.after["sent_to"], "gi•••@example.com")
        self.assertNotIn(raw, json.dumps([event.summary, event.before, event.after], default=str))
        self.assertNotIn(raw, first.content.decode())
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post(self.link_url, {}, format="json").status_code, 200)
        old, new = OwnerClaimToken.objects.order_by("id")
        self.assertIsNotNone(old.revoked_at)
        self.assertIsNone(new.revoked_at)
        self.assertEqual(len(mail.outbox), 2)

    def test_a_claim_link_needs_the_owners_email(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(email=None)
        self.as_(self.scout)
        response = self.client.post(self.link_url, {}, format="json")
        self.assertEqual(
            (response.status_code, response.json()["detail"]),
            (400, "Add the owner's email first — text messages (SMS) aren't connected yet."),
        )
        self.assertEqual(len(mail.outbox), 0)
