"""Review ARC-05: every routed queue must be one a worker consumes, and every beat task must resolve to a queue."""
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

from ashantihub.celery import app

CONSUMED = {"celery", "slow", "money"}


class CeleryRoutingTests(SimpleTestCase):
    def test_routes_only_use_queues_a_worker_consumes(self):
        queues = {route["queue"] for route in settings.CELERY_TASK_ROUTES.values()}
        self.assertLessEqual(queues, CONSUMED)
        self.assertIn(settings.CELERY_TASK_DEFAULT_QUEUE, CONSUMED)

    def test_money_jobs_are_on_the_money_queue(self):
        router = app.amqp.router
        for name in ("payments.tasks.expire_stale_checkouts", "ledger.tasks.post_rider_commission", "wallets.tasks.poll_withdrawals"):
            self.assertEqual(router.route({}, name)["queue"].name, "money", name)
        for name in ("wallets.tasks.send_due_vendor_texts", "reports.tasks.reap_stuck_exports"):
            self.assertEqual(router.route({}, name)["queue"].name, "slow", name)
        self.assertEqual(router.route({}, "approvals.tasks.escalate_due_approvals")["queue"].name, "celery")

    def test_the_compose_workers_read_every_queue(self):
        compose = Path(settings.BASE_DIR).parent / "infra" / "compose" / "docker-compose.yml"
        if not compose.exists():
            self.skipTest("infra/ is not mounted in this environment")
        text = compose.read_text()
        for queue in ("celery,slow", "money"):
            self.assertIn(f'"-Q", "{queue}"', text)

    def test_time_limits_are_set_and_ordered(self):
        self.assertTrue(0 < settings.CELERY_TASK_SOFT_TIME_LIMIT < settings.CELERY_TASK_TIME_LIMIT)
