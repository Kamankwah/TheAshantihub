from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Permission, Role
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from announcements import services
from announcements.models import Announcement
from notifications.models import Notification


class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.ama = make_staff("operations", "ama@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.ama)
        self.yaa = make_staff("scout", "yaa@example.com", manager=self.ama)
        self.esi = make_staff("support", "esi@example.com")
        self.gone = make_staff("scout", "gone@example.com", is_active=False)
        self.held = make_staff("scout", "held@example.com", is_suspended=True)

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def compose(self, **extra):
        body = {"title": "Pickup codes start Tuesday", "body": "Riders type the 4-digit code.", "roles": ["scout"], "when": "now", **extra}
        return self.client.post("/api/announcements/", body, format="json")


class ComposeTests(Base):
    def test_only_super_admin_holds_the_permission(self):
        permission = Permission.objects.get(codename="announcements.send")
        self.assertEqual(list(Role.objects.filter(permissions=permission).values_list("name", flat=True)), ["super_admin"])
        self.as_staff(self.ama)
        self.assertEqual(self.client.get("/api/announcements/").status_code, 403)
        self.assertEqual(self.compose().status_code, 403)

    def test_sending_now_reaches_active_unsuspended_people_in_the_roles(self):
        self.as_staff(self.boss)
        response = self.compose()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body["status"], body["recipients"], body["to"]), ("sent", 2, "Scout"))
        notified = set(Notification.objects.filter(kind="announcement").values_list("staff__email", flat=True))
        self.assertEqual(notified, {"kwame@example.com", "yaa@example.com"})
        event = ActivityEvent.objects.get(verb="announcement.sent")
        self.assertEqual((event.actor_id, event.after["recipients"]), (self.boss.pk, 2))
        self.assertEqual(ActivityEvent.objects.filter(verb="announcement.sent").count(), 1)

    def test_a_team_is_its_lead_direct_reports(self):
        self.as_staff(self.boss)
        body = self.compose(roles=[], team_manager=self.ama.pk).json()
        self.assertEqual((body["recipients"], body["to"]), (2, "Ama's team"))

    def test_the_sender_is_not_sent_their_own(self):
        self.as_staff(self.boss)
        self.assertEqual(self.compose(roles=["super_admin", "support"]).json()["recipients"], 1)

    def test_validation(self):
        self.as_staff(self.boss)
        for bad in ({"title": " "}, {"body": ""}, {"title": "x" * 151}, {"body": "x" * 2001}, {"roles": ["nonsense"]},
                    {"roles": []}, {"when": "later"}, {"when": "schedule"}, {"when": "schedule", "send_at": "2001-01-01T10:00:00Z"},
                    {"roles": ["cosigner"]}, {"team_manager": 99999, "roles": []}):
            self.assertEqual(self.compose(**bad).status_code, 400, bad)
        self.assertFalse(Announcement.objects.exists())

    def test_email_is_refused_where_none_is_connected(self):
        self.as_staff(self.boss)
        with override_settings(EMAIL_HOST=""):
            self.assertEqual(self.compose(send_email=True).status_code, 400)
            self.assertFalse(self.client.get("/api/announcements/").json()["channels"]["email"])

    @override_settings(EMAIL_HOST="smtp.example.com")
    def test_email_when_asked_and_connected(self):
        self.as_staff(self.boss)
        with self.captureOnCommitCallbacks(execute=True):
            body = self.compose(send_email=True, require_confirm=True).json()
        self.assertEqual(body["emailed"], 2)
        self.assertEqual(len(mail.outbox), 2)
        self.assertIn("I've read this", mail.outbox[0].body)
        channels = self.client.get("/api/announcements/").json()["channels"]
        self.assertEqual(channels, {"in_app": True, "email": True, "push": False, "sms": False, "whatsapp": False})

    def test_a_draft_sends_nothing_and_a_sent_one_cannot_be_cancelled(self):
        self.as_staff(self.boss)
        draft = self.compose(when="draft").json()
        self.assertEqual((draft["status"], Notification.objects.filter(kind="announcement").count()), ("draft", 0))
        self.assertEqual(self.client.post(f"/api/announcements/{draft['id']}/cancel/").status_code, 200)
        sent = self.compose().json()
        self.assertEqual(self.client.post(f"/api/announcements/{sent['id']}/cancel/").status_code, 400)

    def test_the_list_reports_roles_and_teams(self):
        self.as_staff(self.boss)
        body = self.client.get("/api/announcements/").json()
        self.assertEqual(next(r for r in body["roles"] if r["name"] == "scout")["people"], 2)
        self.assertEqual(body["teams"], [{"id": self.ama.pk, "name": "Ama", "people": 2}])


class ScheduleTests(Base):
    def test_a_scheduled_one_is_sent_once_when_due(self):
        self.as_staff(self.boss)
        when = (timezone.now() + timedelta(hours=2)).isoformat()
        body = self.compose(when="schedule", send_at=when).json()
        self.assertEqual((body["status"], Notification.objects.filter(kind="announcement").count()), ("scheduled", 0))
        self.assertEqual(services.send_due(), 0)
        Announcement.objects.update(send_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(services.send_due(), 1)
        self.assertEqual(services.send_due(), 0)
        self.assertEqual(Notification.objects.filter(kind="announcement").count(), 2)
        self.assertIn("on schedule", ActivityEvent.objects.get(verb="announcement.sent").summary)

    def test_a_cancelled_one_is_never_sent(self):
        self.as_staff(self.boss)
        body = self.compose(when="schedule", send_at=(timezone.now() + timedelta(hours=1)).isoformat()).json()
        self.client.post(f"/api/announcements/{body['id']}/cancel/")
        Announcement.objects.update(send_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(services.send_due(), 0)
        self.assertIsNone(services.send(Announcement.objects.get()))

    def test_the_task_is_registered_on_the_beat(self):
        from django.conf import settings

        self.assertEqual(settings.CELERY_BEAT_SCHEDULE["announcements-send-due"]["task"], "announcements.tasks.send_due_announcements")


class ReceiptTests(Base):
    def setUp(self):
        super().setUp()
        self.as_staff(self.boss)
        self.sent = self.compose(require_confirm=True).json()

    def test_a_recipient_sees_it_opens_it_and_confirms_it(self):
        self.as_staff(self.kwame)
        mine = self.client.get("/api/announcements/mine/").json()
        self.assertEqual([(m["id"], m["require_confirm"], m["from"]) for m in mine], [(self.sent["id"], True, "Boss")])
        self.assertEqual(self.client.post(f"/api/announcements/mine/{self.sent['id']}/open/").status_code, 204)
        self.assertEqual(len(self.client.get("/api/announcements/mine/").json()), 1)  # still waiting: it asks to be confirmed
        self.assertEqual(self.client.post(f"/api/announcements/mine/{self.sent['id']}/confirm/").status_code, 204)
        self.assertEqual(self.client.get("/api/announcements/mine/").json(), [])

    def test_someone_outside_the_audience_sees_nothing_and_cannot_confirm(self):
        self.as_staff(self.esi)
        self.assertEqual(self.client.get("/api/announcements/mine/").json(), [])
        self.assertEqual(self.client.post(f"/api/announcements/mine/{self.sent['id']}/confirm/").status_code, 404)

    def test_opening_clears_one_that_asks_for_nothing(self):
        self.as_staff(self.boss)
        plain = self.compose(title="FYI").json()
        self.as_staff(self.kwame)
        self.client.post(f"/api/announcements/mine/{plain['id']}/open/")
        self.assertEqual([m["id"] for m in self.client.get("/api/announcements/mine/").json()], [self.sent["id"]])

    def test_the_sender_sees_who_has_opened_and_confirmed(self):
        self.as_staff(self.kwame)
        self.client.post(f"/api/announcements/mine/{self.sent['id']}/confirm/")
        self.as_staff(self.yaa)
        self.client.post(f"/api/announcements/mine/{self.sent['id']}/open/")
        self.as_staff(self.boss)
        detail = self.client.get(f"/api/announcements/{self.sent['id']}/").json()
        self.assertEqual((detail["recipients"], detail["opened"], detail["confirmed"], detail["not_opened"]), (2, 2, 1, 0))
        self.assertEqual({p["name"]: bool(p["confirmed_at"]) for p in detail["people"]}, {"Kwame": True, "Yaa": False})
        listed = self.client.get("/api/announcements/").json()["announcements"][0]
        self.assertEqual((listed["opened"], listed["confirmed"]), (2, 1))

    def test_a_reminder_goes_only_to_those_who_have_not_confirmed_and_once_an_hour(self):
        self.as_staff(self.kwame)
        self.client.post(f"/api/announcements/mine/{self.sent['id']}/confirm/")
        self.as_staff(self.boss)
        Notification.objects.all().delete()
        self.assertEqual(self.client.post(f"/api/announcements/{self.sent['id']}/remind/").json(), {"reminded": 1})
        note = Notification.objects.get()
        self.assertEqual((note.staff, note.title), (self.yaa, "Reminder: Pickup codes start Tuesday"))
        self.assertEqual(self.client.post(f"/api/announcements/{self.sent['id']}/remind/").status_code, 400)

    def test_an_old_notice_stops_showing(self):
        Announcement.objects.update(sent_at=timezone.now() - timedelta(days=15))
        self.as_staff(self.kwame)
        self.assertEqual(self.client.get("/api/announcements/mine/").json(), [])
