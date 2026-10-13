from accounts.authentication import issue_token
from orders.models import DeliveryAssignment as DA

from .test_tracking import TrackingCase

JOB_KEYS = {"stage", "pickup", "drop", "rider", "leg", "route"}
QUEUE_KEYS = {"pickup", "drop", "trip", "route", "riders"}


class ManagerMapTests(TrackingCase):
    def test_queue_map_for_a_waiting_order(self):
        order = self.make_order()
        self.as_staff(self.manager)
        r = self.client.get(f"/api/delivery/queue/{order.pk}/map/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(set(r.json()), QUEUE_KEYS)

    def test_queue_map_404_for_an_order_no_longer_waiting(self):
        a = self.job()
        self.as_staff(self.manager)
        self.assertEqual(self.client.get(f"/api/delivery/queue/{a.order_id}/map/").status_code, 404)

    def test_job_map_for_an_assigned_job(self):
        a = self.job()
        self.as_staff(self.manager)
        r = self.client.get(f"/api/delivery/jobs/{a.pk}/map/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(set(r.json()), JOB_KEYS)
        self.assertEqual(r.json()["stage"], DA.ACCEPTED)

    def test_job_map_404_for_unknown_job(self):
        self.as_staff(self.manager)
        self.assertEqual(self.client.get("/api/delivery/jobs/999999/map/").status_code, 404)

    def test_unauthenticated_and_customer_refused(self):
        order = self.make_order()
        a = self.job()
        urls = [f"/api/delivery/queue/{order.pk}/map/", f"/api/delivery/jobs/{a.pk}/map/", f"/api/orders/dispatch/{a.pk}/map/"]
        self.client.credentials()
        for url in urls:
            self.assertIn(self.client.get(url).status_code, (401, 403), url)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        for url in urls:
            self.assertIn(self.client.get(url).status_code, (401, 403), url)


class DispatchMapTests(TrackingCase):
    def test_dispatch_sees_own_assignment(self):
        a = self.job()
        self.as_staff(self.rider_staff)
        r = self.client.get(f"/api/orders/dispatch/{a.pk}/map/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(set(r.json()), JOB_KEYS)

    def test_dispatch_404_for_another_dispatchers_assignment(self):
        a = self.job()
        self.as_staff(self.other_staff)
        self.assertEqual(self.client.get(f"/api/orders/dispatch/{a.pk}/map/").status_code, 404)

    def test_manager_without_dispatch_permission_refused(self):
        a = self.job()
        self.as_staff(self.manager)
        self.assertEqual(self.client.get(f"/api/orders/dispatch/{a.pk}/map/").status_code, 403)
