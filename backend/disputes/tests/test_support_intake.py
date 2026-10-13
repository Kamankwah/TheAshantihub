from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from disputes.models import Dispute, DisputeEvidence
from listings.models import Category, Listing, Zone
from messaging.models import Conversation
from notifications.models import Notification
from orders.models import Order, OrderItem

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82"
)


class SupportDisputeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Kofi Trader", login_phone="+233207883330", password_hash="x")
        self.customer = Customer.objects.create(full_name="Kwesi Amoako", phone="+233245550900", password_hash="x")
        self.stranger = Customer.objects.create(full_name="Other Person", phone="+233245550901", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"), zone=Zone.objects.get(name="Manhyia"),
            name="iPhone 12", description="A phone.", contact_phone="+233207112233",
            price_amount="3150.00", status=Listing.PUBLISHED,
        )
        self.order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount="3150.00")
        OrderItem.objects.create(order=self.order, listing=self.listing, quantity=1, unit_price="3150.00", line_total="3150.00")
        self.dispute = Dispute.objects.create(
            order=self.order, raised_by=self.customer, reason=Dispute.QUALITY_ISSUE,
            description="It won't charge.", status=Dispute.OPEN,
        )
        self.conversation = Conversation.objects.create(customer=self.customer, subject="Re: iPhone")
        self.support = StaffUser.objects.create(
            full_name="Esi Nyarko", email="support-sd@example.com", password_hash="x", role=Role.objects.get(name="support"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Mark Eting", email="mkt-sd@example.com", password_hash="x", role=Role.objects.get(name="marketing"),
        )
        self.auth(self.support)

    def auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def url(self, suffix=""):
        return f"/api/disputes/{self.dispute.pk}/{suffix}"

    def test_intake_saves_the_fields_and_links_the_customers_conversation(self):
        response = self.client.patch(self.url("intake/"), {
            "problem_type": "faulty_item", "customer_ask": "money_back",
            "intake_summary": "Phone delivered Sunday, won't charge.", "conversation": self.conversation.pk,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.dispute.refresh_from_db()
        self.assertEqual((self.dispute.problem_type, self.dispute.customer_ask), ("faulty_item", "money_back"))
        self.assertEqual(self.dispute.conversation, self.conversation)
        self.assertEqual(response.json()["customer_name"], "Kwesi Amoako")
        self.assertEqual(response.json()["raised_by_kind"], "customer")

    def test_intake_refuses_someone_elses_conversation_and_bad_choices(self):
        other = Conversation.objects.create(customer=self.stranger, subject="Not theirs")
        self.assertEqual(self.client.patch(self.url("intake/"), {"conversation": other.pk}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(self.url("intake/"), {"problem_type": "customer_unreachable"}, format="json").status_code, 400)

    def test_intake_is_closed_once_flagged_and_needs_the_permission(self):
        self.dispute.status = Dispute.INVESTIGATING
        self.dispute.save()
        self.assertEqual(self.client.patch(self.url("intake/"), {"intake_summary": "x"}, format="json").status_code, 409)
        self.auth(self.marketing)
        self.assertEqual(self.client.patch(self.url("intake/"), {"intake_summary": "x"}, format="json").status_code, 403)

    def test_flag_requires_a_summary(self):
        response = self.client.post(self.url("flag/"), {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.dispute.refresh_from_db()
        self.assertEqual(self.dispute.status, Dispute.OPEN)

    def test_flag_with_a_summary_in_the_body_or_already_saved(self):
        response = self.client.post(self.url("flag/"), {"intake_summary": "Faulty phone."}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.dispute.refresh_from_db()
        self.assertEqual((self.dispute.status, self.dispute.intake_summary, self.dispute.flagged_by), (Dispute.INVESTIGATING, "Faulty phone.", self.support))
        other = Dispute.objects.create(order=self.order, raised_by=self.customer, reason="other", description="d", intake_summary="Saved earlier")
        self.assertEqual(self.client.post(f"/api/disputes/{other.pk}/flag/").status_code, 200)

    def test_evidence_can_be_added_but_not_changed_or_removed(self):
        response = self.client.post(self.url("evidence/"), {"title": "Business's answer", "body": "No answer on Wed."}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        evidence = DisputeEvidence.objects.get()
        self.assertEqual(evidence.added_by, self.support)
        for method in ("put", "patch", "delete"):
            self.assertEqual(getattr(self.client, method)(self.url("evidence/")).status_code, 405)
            self.assertEqual(getattr(self.client, method)(f"{self.url('evidence/')}{evidence.pk}/").status_code, 404)
        evidence.title = "Edited"
        with self.assertRaises(RuntimeError):
            evidence.save()
        with self.assertRaises(RuntimeError):
            evidence.delete()
        evidence.refresh_from_db()
        self.assertEqual(evidence.title, "Business's answer")

    def test_evidence_takes_a_photo_and_refuses_a_non_image_and_an_empty_entry(self):
        photo = SimpleUploadedFile("phone.png", PNG, content_type="image/png")
        response = self.client.post(self.url("evidence/"), {"title": "Photo", "file": photo}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["kind"], "file")
        exe = SimpleUploadedFile("run.exe", b"MZ\x90\x00", content_type="application/octet-stream")
        self.assertEqual(self.client.post(self.url("evidence/"), {"title": "x", "file": exe}, format="multipart").status_code, 400)
        self.assertEqual(self.client.post(self.url("evidence/"), {"title": "x"}, format="json").status_code, 400)

    def test_evidence_is_closed_on_a_decided_dispute_and_needs_the_permission(self):
        self.auth(self.marketing)
        self.assertEqual(self.client.post(self.url("evidence/"), {"title": "x", "body": "y"}, format="json").status_code, 403)
        self.auth(self.support)
        self.dispute.status = Dispute.RESOLVED
        self.dispute.save()
        self.assertEqual(self.client.post(self.url("evidence/"), {"title": "x", "body": "y"}, format="json").status_code, 409)

    def test_detail_lists_evidence_and_the_records_that_attach_themselves(self):
        DisputeEvidence.objects.create(dispute=self.dispute, title="Note", body="b", added_by=self.support)
        data = self.client.get(self.url()).json()
        self.assertEqual([e["title"] for e in data["evidence"]], ["Note"])
        self.assertEqual([r["key"] for r in data["records"]], ["words"])  # no delivery stamps, no calls: not listed

    def test_staff_can_log_a_dispute_from_an_order(self):
        response = self.client.post("/api/disputes/log/", {
            "order": self.order.pk, "description": "Rang to say it never arrived.", "problem_type": "not_received",
            "customer_ask": "replacement", "conversation": self.conversation.pk,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        dispute = Dispute.objects.get(pk=response.json()["id"])
        self.assertEqual((dispute.logged_by, dispute.raised_by, dispute.status), (self.support, None, Dispute.OPEN))
        self.assertEqual(dispute.reason, Dispute.DELIVERY_ISSUE)
        self.assertEqual(response.json()["raised_by_kind"], "staff")
        self.assertEqual(response.json()["customer_name"], "Kwesi Amoako")
        self.assertTrue(Notification.objects.filter(customer=self.customer, kind="dispute_logged").exists())

    def test_logging_needs_a_real_order_and_the_permission(self):
        self.assertEqual(self.client.post("/api/disputes/log/", {"order": 99999, "description": "x"}, format="json").status_code, 400)
        self.auth(self.marketing)
        self.assertEqual(self.client.post("/api/disputes/log/", {"order": self.order.pk, "description": "x"}, format="json").status_code, 403)

    def test_list_filters_by_order_for_the_inbox_deep_link(self):
        other_order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount="1.00")
        Dispute.objects.create(order=other_order, raised_by=self.customer, reason="other", description="d")
        results = self.client.get("/api/disputes/", {"order": self.order.pk}).json()["results"]
        self.assertEqual([r["id"] for r in results], [self.dispute.pk])

    def test_counts_use_only_real_statuses(self):
        Dispute.objects.create(order=self.order, raised_by=self.customer, reason="other", description="d", status=Dispute.INVESTIGATING)
        counts = self.client.get("/api/disputes/counts/").json()
        self.assertEqual(counts, {"needs_intake": 1, "with_accounting": 1, "decided_this_week": 0})

    def test_the_customers_own_dispute_response_never_carries_the_intake_summary(self):
        self.dispute.intake_summary = "Internal: suspect fraud"
        self.dispute.save()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        response = self.client.post(f"/api/orders/{self.order.pk}/dispute/", {"reason": "other", "description": "again"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("intake_summary", response.json())
        self.assertNotIn("suspect fraud", str(response.json()))
