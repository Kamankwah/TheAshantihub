from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser
from activity.models import ActivityEvent
from listings.models import Category, Listing, Zone


class ZoneOpsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ops = self._staff("operations", "ops")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.ops, 'staff')}")

    def _staff(self, role, tag):
        return StaffUser.objects.create(
            full_name=f"{role} {tag}", email=f"{role}-{tag}@example.com", password_hash="x",
            role=Role.objects.get(name=role),
        )

    def _business(self, zone, scout=None, tag="b"):
        owner = BusinessOwner.objects.create(
            full_name="Owner", email=f"{tag}@example.com", login_phone=f"+23355000{abs(hash(tag)) % 10000:04d}", password_hash="x", account_manager=scout,
        )
        BusinessOwnerProfile.objects.create(business_owner=owner, zone=zone)
        return owner

    def test_create_records_event(self):
        r = self.client.post("/api/listings/zones/", {"name": "Zkronum"}, format="json")
        self.assertEqual(r.status_code, 201)
        e = ActivityEvent.objects.get(verb="zone.created")
        self.assertEqual(e.summary, "Added Zkronum")

    def test_rename_records_before_after(self):
        z = Zone.objects.create(name="Zkejetia Market")
        r = self.client.patch(f"/api/listings/zones/{z.pk}/", {"name": "Zkejetia"}, format="json")
        self.assertEqual(r.status_code, 200)
        e = ActivityEvent.objects.get(verb="zone.renamed")
        self.assertEqual(e.before, {"name": "Zkejetia Market"})
        self.assertEqual(e.after, {"name": "Zkejetia"})

    def test_rename_to_existing_name_refused(self):
        Zone.objects.create(name="Zadum")
        z = Zone.objects.create(name="Zadom")
        r = self.client.patch(f"/api/listings/zones/{z.pk}/", {"name": "Zadum"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_delete_unused_zone(self):
        z = Zone.objects.create(name="Zkronum")
        self.assertEqual(self.client.delete(f"/api/listings/zones/{z.pk}/").status_code, 204)
        self.assertFalse(Zone.objects.filter(pk=z.pk).exists())
        self.assertTrue(ActivityEvent.objects.filter(verb="zone.deleted", target_label="Zkronum").exists())

    def test_delete_refused_when_business_uses_it(self):
        z = Zone.objects.create(name="Zadum")
        self._business(z)
        r = self.client.delete(f"/api/listings/zones/{z.pk}/")
        self.assertEqual(r.status_code, 409)
        self.assertIn("1 business", r.json()["detail"])
        self.assertTrue(Zone.objects.filter(pk=z.pk).exists())

    def test_support_cannot_manage_zones(self):
        z = Zone.objects.create(name="Zadum")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self._staff('support', 'm'), 'staff')}")
        self.assertEqual(self.client.patch(f"/api/listings/zones/{z.pk}/", {"name": "X"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/listings/zones/{z.pk}/").status_code, 403)
        self.assertEqual(self.client.get("/api/listings/zones/summary/").status_code, 403)

    def test_summary_counts_and_scouts(self):
        scout = self._staff("scout", "s")
        adum = Zone.objects.create(name="Zadum")
        Zone.objects.create(name="Zkronum")
        self._business(adum, scout, "b1")
        self._business(adum, scout, "b2")
        r = self.client.get("/api/listings/zones/summary/")
        self.assertEqual(r.status_code, 200)
        rows = {z["name"]: z for z in r.json()["zones"]}
        self.assertEqual(rows["Zadum"]["businesses"], 2)
        self.assertEqual(rows["Zadum"]["listings"], 0)
        self.assertEqual(rows["Zadum"]["scouts"], [scout.full_name])
        self.assertEqual(rows["Zkronum"]["scouts"], [])

    def test_summary_changes_only_recorded(self):
        self.assertEqual(self.client.get("/api/listings/zones/summary/").json()["changes"], [])
        self.client.post("/api/listings/zones/", {"name": "Zkronum"}, format="json")
        changes = self.client.get("/api/listings/zones/summary/").json()["changes"]
        self.assertEqual([c["what"] for c in changes], ["Added Zkronum"])
        self.assertTrue(changes[0]["mine"])
