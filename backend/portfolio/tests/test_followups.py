"""Follow-ups and delivery problems (scout WP3): returned approvals task their
maker, a delivery dispute tasks the account manager, a scout can flag a
delivery problem, and a business page lists its orders without a customer."""
import itertools
import json
from datetime import timedelta

from django.utils import timezone

from accounts import kyc
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff
from activity.models import ActivityEvent
from approvals import services as approvals
from disputes.models import Dispute
from notifications.models import Notification
from orders.models import DeliveryAssignment, Order, OrderItem
from portfolio import proposals
from portfolio.tests.change_fixtures import ChangeTestBase, make_business, make_listing
from staff_tasks.models import Task

CUSTOMER_NAME = "Esi Customer-Secret"
CUSTOMER_PHONE = "+233201234567"
CUSTOMER_ADDRESS = "14 Secret Lane, Kumasi"


_customers = itertools.count(1)


def make_order(*owners, status=Order.PAID, days_ago=1):
    """A paid door-to-door order with one line from each business."""
    customer = Customer.objects.create(
        full_name=CUSTOMER_NAME, phone=f"+23320{next(_customers):07d}", password_hash="x",
    )
    order = Order.objects.create(
        customer=customer, status=status, total_amount="30.00", delivery_method=Order.DOOR_TO_DOOR,
        delivery_address=CUSTOMER_ADDRESS, delivery_phone=CUSTOMER_PHONE,
    )
    for owner in owners:
        listing = owner.listings.first() or make_listing(owner, name=f"{owner.display_name} item")
        OrderItem.objects.create(order=order, listing=listing, quantity=2, unit_price="10.00", line_total="20.00")
    Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(days=days_ago))
    return order


class ReturnedApprovalTests(ChangeTestBase):
    def submit_kyc(self, owner):
        return approvals.submit(
            self.scout, "business.kyc", target=owner, title=f"New business: {owner.display_name}",
            payload={"business_owner_id": owner.pk},
        )

    def test_a_returned_detail_change_tasks_its_maker_for_24_hours_with_the_note(self):
        approval = proposals.propose_update(self.scout, self.owner, {"business_name": "Abena Palace"}, reason="Rebrand")
        before = timezone.now()
        approvals.reject(approval.pk, self.lead, "Send the signboard photo too")
        task = Task.objects.get()
        self.assertEqual(
            (task.owner, task.kind, task.business_owner, task.source_type, task.source_id, task.status),
            (self.scout, Task.RETURNED_APPROVAL, self.owner, "approvals.approvalrequest", str(approval.pk), Task.OPEN),
        )
        self.assertAlmostEqual((task.due_at - before).total_seconds(), 24 * 3600, delta=60)
        self.assertIn("Send the signboard photo too", task.notes)
        self.assertIn("Ama", task.notes)
        self.assertEqual(task.created_by, self.lead)  # so the screen can say "From Ama"
        self.assertTrue(task.title.startswith("Returned: "))

    def test_a_returned_listing_request_points_at_the_listing_business(self):
        listing = make_listing(self.owner, status="draft")
        approval = approvals.submit(
            self.scout, "listing.photos", target=listing, title="Photos for Kente stole",
            payload={"listing_id": listing.pk, "photo_ids": [], "reason": "x"},
        )
        approvals.reject(approval.pk, self.lead, "Too dark")
        self.assertEqual(Task.objects.get().business_owner, self.owner)

    def test_an_approved_request_makes_no_task(self):
        approval = proposals.propose_update(self.scout, self.owner, {"business_name": "Abena Palace"}, reason="Rebrand")
        approvals.approve(approval.pk, self.lead)
        self.assertFalse(Task.objects.exists())

    def test_the_kyc_queue_rejection_fires_the_same_callback(self):
        pending = make_business(self.scout, phone="+233244100999", name="Kofi Spares", kyc_status=BusinessOwner.PENDING)
        approval = self.submit_kyc(pending)
        kyc.reject_owner(pending.pk, self.lead, "Ghana Card is blurry")
        task = Task.objects.get()
        self.assertEqual((task.owner, task.kind, task.business_owner), (self.scout, Task.RETURNED_APPROVAL, pending))
        self.assertIn("Ghana Card is blurry", task.notes)
        approval.refresh_from_db()
        self.assertEqual(approval.status, "rejected")

    def test_the_inbox_rejection_of_kyc_tasks_the_maker_once(self):
        pending = make_business(self.scout, phone="+233244100998", name="Kofi Spares", kyc_status=BusinessOwner.PENDING)
        approval = self.submit_kyc(pending)
        approvals.reject(approval.pk, self.lead, "Pin is wrong")
        self.assertEqual(Task.objects.filter(kind=Task.RETURNED_APPROVAL).count(), 1)

    def test_a_failing_callback_never_blocks_the_return(self):
        from unittest import mock

        approval = proposals.propose_update(self.scout, self.owner, {"business_name": "Abena Palace"}, reason="Rebrand")
        with mock.patch("portfolio.approval_kinds.create_task", side_effect=RuntimeError("boom")), \
                self.assertLogs("approvals.services", "ERROR"):
            approvals.reject(approval.pk, self.lead, "No")
        approval.refresh_from_db()
        self.assertEqual(approval.status, "rejected")
        self.assertFalse(Task.objects.exists())


class DeliveryDisputeTaskTests(ChangeTestBase):
    def raise_dispute(self, order, reason=Dispute.DELIVERY_ISSUE):
        return Dispute.objects.create(
            order=order, raised_by=order.customer, reason=reason, description=f"Call me on {CUSTOMER_PHONE}",
        )

    def test_a_delivery_dispute_tasks_the_account_manager_of_each_managed_business(self):
        other = make_business(self.other_scout, phone="+233244100777", name="Yaw Cloth")
        unmanaged = make_business(None, phone="+233244100666", name="Nobody Cloth")
        order = make_order(self.owner, other, unmanaged)
        from portfolio.delivery import task_for_dispute

        created = task_for_dispute(self.raise_dispute(order))
        self.assertEqual(len(created), 2)
        mine = Task.objects.get(owner=self.scout)
        self.assertEqual(
            (mine.kind, mine.business_owner, mine.source_type, mine.source_id),
            (Task.DELIVERY_PROBLEM, self.owner, "orders.order", str(order.pk)),
        )
        self.assertEqual(Task.objects.get(owner=self.other_scout).business_owner, other)
        for task in Task.objects.all():
            self.assertNotIn(CUSTOMER_NAME, task.title + task.notes)
            self.assertNotIn(CUSTOMER_PHONE, task.title + task.notes)

    def test_a_second_dispute_on_the_same_order_adds_no_second_task(self):
        order = make_order(self.owner)
        from portfolio.delivery import task_for_dispute

        task_for_dispute(self.raise_dispute(order))
        self.assertEqual(task_for_dispute(self.raise_dispute(order)), [])
        self.assertEqual(Task.objects.count(), 1)

    def test_only_a_delivery_issue_counts(self):
        from portfolio.delivery import task_for_dispute

        self.assertEqual(task_for_dispute(self.raise_dispute(make_order(self.owner), Dispute.QUALITY_ISSUE)), [])
        self.assertFalse(Task.objects.exists())

    def test_the_customers_dispute_endpoint_creates_the_task(self):
        from accounts.authentication import issue_token

        order = make_order(self.owner)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(order.customer, 'customer')}")
        response = self.client.post(
            f"/api/orders/{order.pk}/dispute/", {"reason": "delivery_issue", "description": "Never came"}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Task.objects.get().owner, self.scout)


class FlagDeliveryProblemTests(ChangeTestBase):
    def setUp(self):
        super().setUp()
        self.dm1 = make_staff("delivery_manager", "dm1@example.com", manager=self.lead)
        self.dm2 = make_staff("delivery_manager", "dm2@example.com", manager=self.lead)
        self.order = make_order(self.owner)

    def url(self, order=None, owner=None):
        return f"/api/portfolio/businesses/{(owner or self.owner).pk}/orders/{(order or self.order).pk}/delivery-problem/"

    def test_the_account_manager_tells_every_delivery_manager(self):
        self.as_staff(self.scout)
        response = self.client.post(self.url(), {"note": "Rider never reached the shop"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json(), {"flagged": True, "already": False, "told": 2})
        tasks = Task.objects.filter(kind=Task.DELIVERY_PROBLEM)
        self.assertEqual({t.owner for t in tasks}, {self.dm1, self.dm2})
        task = tasks.first()
        self.assertEqual((task.business_owner, task.created_by, task.source_id), (self.owner, self.scout, str(self.order.pk)))
        self.assertIn("Rider never reached the shop", task.notes)
        self.assertEqual(Notification.objects.filter(kind="delivery_problem_flagged").count(), 2)
        event = ActivityEvent.objects.get(verb="delivery.problem_flagged")
        self.assertEqual((event.actor_id, event.target_label), (self.scout.pk, f"Order #{self.order.pk}"))
        self.assertNotIn(CUSTOMER_NAME, json.dumps([event.target_label, event.summary, event.after]))

    def test_flagging_twice_adds_no_second_task(self):
        self.as_staff(self.scout)
        self.client.post(self.url(), {"note": "First"}, format="json")
        again = self.client.post(self.url(), {"note": "Second"}, format="json")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json(), {"flagged": True, "already": True, "told": 0})
        self.assertEqual(Task.objects.filter(kind=Task.DELIVERY_PROBLEM).count(), 2)
        self.assertEqual(Notification.objects.filter(kind="delivery_problem_flagged").count(), 2)

    def test_the_order_row_is_locked_before_the_dedupe_check(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        self.as_staff(self.scout)
        with CaptureQueriesContext(connection) as queries:
            self.client.post(self.url(), {"note": "Late"}, format="json")
        sql = [q["sql"] for q in queries.captured_queries]
        lock = next(i for i, q in enumerate(sql) if "FOR UPDATE" in q and "orders_order" in q)
        first_task_read = next(i for i, q in enumerate(sql) if "staff_tasks_task" in q and q.startswith("SELECT"))
        self.assertLess(lock, first_task_read)

    def test_a_note_is_required(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.post(self.url(), {"note": "  "}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.url(), {"note": "x" * 501}, format="json").status_code, 400)
        self.assertFalse(Task.objects.exists())

    def test_only_the_account_manager_may_flag(self):
        self.as_staff(self.other_scout)
        self.assertEqual(self.client.post(self.url(), {"note": "x"}, format="json").status_code, 404)
        self.as_staff(self.lead)  # Operations has no check-in or scout permission
        self.assertEqual(self.client.post(self.url(), {"note": "x"}, format="json").status_code, 403)
        self.assertFalse(Task.objects.exists())

    def test_an_order_without_this_business_or_unpaid_is_a_404(self):
        other = make_business(self.other_scout, phone="+233244100777", name="Yaw Cloth")
        self.as_staff(self.scout)
        self.assertEqual(self.client.post(self.url(make_order(other)), {"note": "x"}, format="json").status_code, 404)
        self.assertEqual(
            self.client.post(self.url(make_order(self.owner, status=Order.PENDING)), {"note": "x"}, format="json").status_code, 404,
        )

    def test_no_delivery_manager_is_said_plainly(self):
        from accounts.models import StaffUser

        StaffUser.objects.filter(pk__in=[self.dm1.pk, self.dm2.pk]).update(is_active=False)
        self.as_staff(self.scout)
        response = self.client.post(self.url(), {"note": "x"}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("Delivery Manager", response.json()["detail"])


class BusinessOrdersTests(ChangeTestBase):
    def url(self, owner=None):
        return f"/api/portfolio/businesses/{(owner or self.owner).pk}/orders/"

    def test_lists_paid_orders_with_only_this_business_lines_and_no_customer(self):
        other = make_business(self.other_scout, phone="+233244100777", name="Yaw Cloth")
        shared = make_order(self.owner, other, days_ago=1)
        older = make_order(self.owner, days_ago=5)
        make_order(self.owner, status=Order.PENDING)
        make_order(other)
        DeliveryAssignment.objects.create(order=older, status="delivered", delivered_at=timezone.now() - timedelta(days=4))
        Dispute.objects.create(order=shared, raised_by=shared.customer, reason="delivery_issue", description=CUSTOMER_PHONE)
        self.as_staff(self.scout)
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual([row["id"] for row in body["results"]], [shared.pk, older.pk])
        first, second = body["results"]
        self.assertEqual(first["items"], [{"name": self.owner.listings.first().name, "quantity": 2}])
        self.assertEqual(first["dispute"], {"reason": "delivery_issue", "reason_label": "Delivery Issue", "status": "open"})
        self.assertIsNone(second["dispute"])
        self.assertIsNotNone(second["delivered_at"])
        text = response.content.decode()
        for secret in (CUSTOMER_NAME, CUSTOMER_PHONE, CUSTOMER_ADDRESS, "Yaw Cloth item", other.display_name):
            self.assertNotIn(secret, text)
        self.assertEqual(set(first), {
            "id", "number", "placed_at", "items", "status", "delivery_status", "delivered_at", "dispute", "problem_flagged",
        })

    def test_a_resolved_dispute_is_not_shown(self):
        order = make_order(self.owner)
        Dispute.objects.create(order=order, raised_by=order.customer, reason="delivery_issue", description="x", status="resolved")
        self.as_staff(self.scout)
        self.assertIsNone(self.client.get(self.url()).json()["results"][0]["dispute"])

    def test_marks_an_order_already_flagged(self):
        make_staff("delivery_manager", "dm1@example.com", manager=self.lead)
        order = make_order(self.owner)
        self.as_staff(self.scout)
        self.assertFalse(self.client.get(self.url()).json()["results"][0]["problem_flagged"])
        self.client.post(f"{self.url()}{order.pk}/delivery-problem/", {"note": "Late"}, format="json")
        self.assertTrue(self.client.get(self.url()).json()["results"][0]["problem_flagged"])

    def test_the_flag_clears_once_the_delivery_manager_closes_it(self):
        make_staff("delivery_manager", "dm1@example.com", manager=self.lead)
        order = make_order(self.owner)
        self.as_staff(self.scout)
        self.client.post(f"{self.url()}{order.pk}/delivery-problem/", {"note": "Late"}, format="json")
        Task.objects.filter(kind=Task.DELIVERY_PROBLEM).update(status=Task.DONE)
        self.assertFalse(self.client.get(self.url()).json()["results"][0]["problem_flagged"])
        again = self.client.post(f"{self.url()}{order.pk}/delivery-problem/", {"note": "Late again"}, format="json")
        self.assertFalse(again.json()["already"])

    def test_pages_and_see_all(self):
        for day in range(7):
            make_order(self.owner, days_ago=day + 1)
        self.as_staff(self.scout)
        body = self.client.get(self.url()).json()
        self.assertEqual((body["count"], len(body["results"])), (7, 5))
        self.assertEqual(len(self.client.get(self.url() + "?page_size=20").json()["results"]), 7)

    def test_another_scouts_business_is_a_404_and_operations_may_read(self):
        make_order(self.owner)
        self.as_staff(self.other_scout)
        self.assertEqual(self.client.get(self.url()).status_code, 404)
        ops = make_staff("operations", "ops2@example.com")
        self.as_staff(ops)
        self.assertEqual(self.client.get(self.url()).status_code, 200)
