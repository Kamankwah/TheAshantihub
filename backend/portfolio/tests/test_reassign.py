from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from notifications.models import Notification
from portfolio.models import AccountManagerAssignment
from portfolio.services import assign_account_manager
from portfolio.tests.health_fixtures import make_business
from staff_tasks.models import Task

TEAM_ONLY = "You can reassign only between scouts on your team."


class TeamBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_lead = make_staff("operations", "kojo@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.yaw = make_staff("scout", "yaw@example.com", manager=self.other_lead)
        self.owner = make_business("Asafo Hair Studio")
        assign_account_manager(self.owner, self.kwame, by=self.lead, reason="Registered by Kwame")

    def post(self, staff, path, body):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        return self.client.post(path, body, format="json")


class ReassignTests(TeamBase):
    def reassign(self, staff, owner=None, **body):
        return self.post(staff, f"/api/portfolio/businesses/{(owner or self.owner).pk}/reassign/", body)

    def test_a_lead_moves_a_business_between_scouts_on_their_team(self):
        response = self.reassign(self.lead, scout=self.efua.pk, reason="Efua works the Adum side of Asafo")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["account_manager"], {"id": self.efua.pk, "full_name": "Efua"})
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.account_manager, self.efua)
        old, new = AccountManagerAssignment.objects.filter(business_owner=self.owner).order_by("started_at", "pk")
        self.assertEqual((old.scout, old.ended_at is not None), (self.kwame, True))
        self.assertEqual(
            (new.scout, new.assigned_by, new.reason, new.ended_at),
            (self.efua, self.lead, "Efua works the Adum side of Asafo", None),
        )
        self.assertTrue(Notification.objects.filter(
            staff=self.efua, kind="portfolio_assigned", link=f"portfolio/{self.owner.pk}",
        ).exists())
        self.assertTrue(Notification.objects.filter(staff=self.kwame, kind="portfolio_unassigned").exists())
        event = ActivityEvent.objects.get(verb="business.reassigned")
        self.assertEqual(
            (event.actor_id, event.target_type, event.target_id),
            (self.lead.pk, "accounts.businessowner", str(self.owner.pk)),
        )
        self.assertEqual(event.after["reason"], "Efua works the Adum side of Asafo")
        self.assertEqual(event.before["account_manager"]["id"], self.kwame.pk)
        self.assertFalse(ActivityEvent.objects.filter(verb="portfolio-reassign").exists())

    def test_a_reason_is_required(self):
        for body in ({"scout": self.efua.pk}, {"scout": self.efua.pk, "reason": "   "}):
            response = self.reassign(self.lead, **body)
            self.assertEqual(response.status_code, 400, response.content)
            self.assertEqual(response.json(), {"reason": ["Write the reason — it's kept on the record."]})
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.account_manager, self.kwame)

    def test_a_lead_cannot_move_a_business_to_another_team(self):
        response = self.reassign(self.lead, scout=self.yaw.pk, reason="Closer to Ejisu")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": TEAM_ONLY})

    def test_a_lead_cannot_take_a_business_from_another_team(self):
        owner = make_business("Ejisu Phone Accessories")
        assign_account_manager(owner, self.yaw, by=self.other_lead, reason="Registered by Yaw")
        response = self.reassign(self.lead, owner=owner, scout=self.efua.pk, reason="Closer")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": TEAM_ONLY})
        owner.refresh_from_db()
        self.assertEqual(owner.account_manager, self.yaw)

    def test_a_business_without_a_manager_can_go_to_a_team_scout(self):
        owner = make_business("Manhyia Tailoring", kyc=BusinessOwner.PENDING)
        response = self.reassign(self.lead, owner=owner, scout=self.efua.pk, reason="Self-registered in Efua's area")
        self.assertEqual(response.status_code, 200, response.content)
        owner.refresh_from_db()
        self.assertEqual(owner.account_manager, self.efua)
        self.assertFalse(Notification.objects.filter(kind="portfolio_unassigned").exists())

    def test_super_admin_may_move_any_business(self):
        response = self.reassign(self.boss, scout=self.yaw.pk, reason="Yaw covers Asafo now")
        self.assertEqual(response.status_code, 200, response.content)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.account_manager, self.yaw)

    def test_only_an_active_scout_can_take_a_business(self):
        support = make_staff("support", "abena@example.com", manager=self.lead)
        gone = make_staff("scout", "kofi@example.com", manager=self.lead, is_active=False)
        for staff in (support, gone):
            response = self.reassign(self.lead, scout=staff.pk, reason="x")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json(), {"scout": ["Choose an active scout."]})

    def test_moving_to_the_current_manager_is_refused(self):
        response = self.reassign(self.lead, scout=self.kwame.pk, reason="x")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"scout": ["Kwame already manages this business."]})

    def test_scouts_cannot_reassign_and_an_unknown_business_is_404(self):
        self.assertEqual(self.reassign(self.kwame, scout=self.efua.pk, reason="x").status_code, 403)
        response = self.post(self.lead, "/api/portfolio/businesses/999999/reassign/", {"scout": self.efua.pk, "reason": "x"})
        self.assertEqual(response.status_code, 404)


class FollowUpTests(TeamBase):
    def follow_up(self, staff, **body):
        return self.post(staff, f"/api/portfolio/businesses/{self.owner.pk}/follow-up/", body)

    def tomorrow(self):
        return (timezone.now() + timedelta(days=1)).replace(microsecond=0)

    def test_a_lead_gives_a_scout_on_their_team_a_follow_up(self):
        due = self.tomorrow()
        response = self.follow_up(
            self.lead, owner=self.kwame.pk, title="Visit and help finish the 2 draft listings",
            due_at=due.isoformat(), notes="Bring the price list",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["owner"], {"id": self.kwame.pk, "full_name": "Kwame"})
        task = Task.objects.get(pk=response.json()["id"])
        self.assertEqual(
            (task.owner, task.created_by, task.source_type, task.source_id, task.notes, task.due_at),
            (self.kwame, self.lead, "accounts.businessowner", str(self.owner.pk), "Bring the price list", due),
        )
        self.assertEqual((task.kind, task.business_owner), (Task.OPS_FOLLOW_UP, self.owner))
        self.assertTrue(Notification.objects.filter(staff=self.kwame, kind="follow_up_assigned", link="tasks").exists())
        event = ActivityEvent.objects.get(verb="business.follow_up_created")
        self.assertEqual((event.actor_id, event.target_id), (self.lead.pk, str(self.owner.pk)))
        self.assertEqual(event.after["task_id"], task.pk)
        self.assertFalse(ActivityEvent.objects.filter(verb="portfolio-follow-up").exists())

    def test_a_lead_may_take_the_follow_up_themselves_without_a_notice(self):
        response = self.follow_up(self.lead, owner=self.lead.pk, title="Call the owner", due_at=self.tomorrow().isoformat())
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Task.objects.get().owner, self.lead)
        self.assertEqual(Task.objects.get().kind, Task.MANUAL)
        self.assertFalse(Notification.objects.filter(kind="follow_up_assigned").exists())

    def test_a_date_alone_is_due_at_five_in_the_afternoon(self):
        day = timezone.localdate() + timedelta(days=2)
        response = self.follow_up(self.lead, owner=self.kwame.pk, title="Visit", due_at=day.isoformat())
        self.assertEqual(response.status_code, 201, response.content)
        due = timezone.localtime(Task.objects.get().due_at)
        self.assertEqual((due.date(), due.hour, due.minute), (day, 17, 0))

    def test_the_title_fits_the_assignees_notification(self):
        too_long = self.follow_up(self.lead, owner=self.kwame.pk, title="x" * 186, due_at=self.tomorrow().isoformat())
        self.assertEqual(too_long.status_code, 400)
        self.assertIn("title", too_long.json())
        title = "Visit " + "x" * 179  # 185 characters: "Follow-up: …" is 196
        response = self.follow_up(self.lead, owner=self.kwame.pk, title=title, due_at=self.tomorrow().isoformat())
        self.assertEqual(response.status_code, 201, response.content)
        note = Notification.objects.get(staff=self.kwame, kind="follow_up_assigned")
        self.assertEqual(note.title, f"Follow-up: {title}")

    def test_only_yourself_or_someone_on_your_team(self):
        response = self.follow_up(self.lead, owner=self.yaw.pk, title="Visit", due_at=self.tomorrow().isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"owner": ["Choose yourself or someone on your team."]})
        self.assertFalse(Task.objects.exists())

    def test_a_title_and_a_due_time_that_has_not_passed(self):
        missing = self.follow_up(self.lead, owner=self.kwame.pk, due_at=self.tomorrow().isoformat())
        self.assertEqual(missing.status_code, 400)
        self.assertIn("title", missing.json())
        past = self.follow_up(
            self.lead, owner=self.kwame.pk, title="Visit", due_at=(timezone.now() - timedelta(hours=1)).isoformat(),
        )
        self.assertEqual(past.json(), {"due_at": ["Pick a time that hasn't passed."]})
        yesterday = self.follow_up(
            self.lead, owner=self.kwame.pk, title="Visit", due_at=(timezone.localdate() - timedelta(days=1)).isoformat(),
        )
        self.assertEqual(yesterday.json(), {"due_at": ["Pick a day that hasn't passed."]})
        garbage = self.follow_up(self.lead, owner=self.kwame.pk, title="Visit", due_at="next week")
        self.assertEqual(garbage.json(), {"due_at": ["Use a date like 2026-10-09, or a date and time."]})
        self.assertFalse(Task.objects.exists())

    def test_scouts_cannot_create_follow_ups(self):
        response = self.follow_up(self.kwame, owner=self.kwame.pk, title="Visit", due_at=self.tomorrow().isoformat())
        self.assertEqual(response.status_code, 403)
