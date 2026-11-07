"""Review DB-04: what account deletion erases, what the retention job blanks, the activity log's truncated addresses, and the
data export."""
from datetime import timedelta
from io import StringIO

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import export, retention
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, CustomerAddress
from accounts.testing import make_staff
from activity import services as activity
from activity.models import ActivityEvent
from messaging.models import Conversation, Message
from notifications.models import Notification
from orders.models import Order
from wallets.models import PayoutDestination

PASSWORD = "s3cret-pass"


def _customer(**extra):
    return Customer.objects.create(
        full_name="Ama Owusu", phone="+233241234567", email="ama@example.com", password_hash=make_password(PASSWORD),
        address="Adum", **extra,
    )


def _destination(holder_type, holder_id, number="0241234567", removed=False):
    return PayoutDestination.objects.create(
        holder_type=holder_type, holder_id=holder_id, rail="momo", institution="MTN", account_number=number,
        account_name="Ama Owusu", matched_name="Ama Owusu", name_source="simulated", usable_from=timezone.now(),
        removed_at=timezone.now() if removed else None,
    )


def _order(customer, days_old=0, **fields):
    order = Order.objects.create(
        customer=customer, status=Order.PAID, delivery_status=Order.DELIVERED, total_amount="100.00",
        delivery_address="Plot 4, Adum", delivery_phone="0241234567", delivery_gps_address="AK-039-5028",
        delivery_landmark="Near the market", delivery_lat=6.69, delivery_lng=-1.62, **fields,
    )
    Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(days=days_old))
    return order


class DeletionErasesPayoutAndNotificationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = _customer()

    def test_deleting_an_account_blanks_every_payout_destination_and_drops_notifications(self):
        live = _destination("customer", self.customer.pk)
        gone = _destination("customer", self.customer.pk, number="0551112223", removed=True)
        other = _destination("customer", self.customer.pk + 1, number="0509998887")
        Notification.objects.create(customer=self.customer, kind=Notification.ORDER_STATUS, title="Shipped", body="to Adum")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.assertEqual(self.client.post("/api/accounts/me/delete/", {"password": PASSWORD}, format="json").status_code, 204)
        for destination in (live, gone):
            destination.refresh_from_db()
            self.assertEqual(destination.account_number, "")
            self.assertIsNone(destination.account_number_idx)
            self.assertEqual((destination.account_name, destination.matched_name), ("Deleted user", "Deleted user"))
            self.assertIsNotNone(destination.removed_at)
        other.refresh_from_db()
        self.assertEqual(other.account_number, "0509998887")  # someone else's is untouched
        self.assertFalse(Notification.objects.filter(customer=self.customer).exists())


@override_settings(PII_DELETED_ACCOUNT_GRACE_DAYS=90, PII_ORDER_RETENTION_DAYS=2190, NOTIFICATION_RETENTION_DAYS=365)
class RetentionTests(TestCase):
    def _blank(self, order):
        order.refresh_from_db()
        return (order.delivery_address, order.delivery_phone, order.delivery_gps_address, order.delivery_landmark,
                order.delivery_lat, order.delivery_lng) == ("", "", "", "", None, None)

    def test_orders_of_an_account_deleted_past_the_grace_period_lose_their_delivery_details(self):
        customer = _customer()
        order = _order(customer)
        Customer.objects.filter(pk=customer.pk).update(deleted_at=timezone.now() - timedelta(days=91))
        result = retention.scrub_expired()
        self.assertEqual(result["orders"], 1)
        self.assertTrue(self._blank(order))
        order.refresh_from_db()
        self.assertEqual(str(order.total_amount), "100.00")  # the money record stays

    def test_a_recently_deleted_account_and_a_live_recent_one_keep_their_details(self):
        recent_deleted = _customer()
        Customer.objects.filter(pk=recent_deleted.pk).update(deleted_at=timezone.now() - timedelta(days=10))
        live = Customer.objects.create(full_name="Kofi", phone="+233201112233", password_hash="x")
        kept = [_order(recent_deleted), _order(live, days_old=400)]
        retention.scrub_expired()
        self.assertFalse(any(self._blank(o) for o in kept))

    def test_an_order_past_the_retention_period_loses_its_details_even_for_a_live_account(self):
        live = _customer()
        old, recent = _order(live, days_old=2200), _order(live, days_old=100)
        retention.scrub_expired()
        self.assertTrue(self._blank(old))
        self.assertFalse(self._blank(recent))

    def test_support_text_follows_the_same_rule_and_events_are_left(self):
        customer = _customer()
        Customer.objects.filter(pk=customer.pk).update(deleted_at=timezone.now() - timedelta(days=120))
        conversation = Conversation.objects.create(customer=customer, subject="Parcel to Adum")
        said = Message.objects.create(conversation=conversation, sender_type=Message.CUSTOMER, body="My address is Plot 4")
        note = Message.objects.create(conversation=conversation, sender_type=Message.STAFF, body="Called 0241234567", kind=Message.NOTE)
        event = Message.objects.create(conversation=conversation, sender_type=Message.STAFF, body="Assigned", kind=Message.EVENT)
        fresh_owner = Customer.objects.create(full_name="Kofi", phone="+233201112233", password_hash="x")
        keep = Message.objects.create(
            conversation=Conversation.objects.create(customer=fresh_owner, subject="Hello"), sender_type=Message.CUSTOMER, body="Hi",
        )
        result = retention.scrub_expired()
        self.assertEqual(result["messages"], 2)
        for message in (said, note, event, keep):
            message.refresh_from_db()
        self.assertEqual((said.body, note.body), (retention.REMOVED, retention.REMOVED))
        self.assertEqual((event.body, keep.body), ("Assigned", "Hi"))
        conversation.refresh_from_db()
        self.assertEqual(conversation.subject, retention.REMOVED)

    def test_old_notifications_go_and_the_job_is_idempotent(self):
        customer = _customer()
        old = Notification.objects.create(customer=customer, kind=Notification.ORDER_STATUS, title="Old")
        Notification.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=400))
        Notification.objects.create(customer=customer, kind=Notification.ORDER_STATUS, title="New")
        self.assertEqual(retention.scrub_expired()["notifications"], 1)
        self.assertEqual(retention.scrub_expired(), {"orders": 0, "messages": 0, "notifications": 0})
        self.assertEqual(list(Notification.objects.values_list("title", flat=True)), ["New"])


class ActivityAddressTests(TestCase):
    def _request(self, ip):
        request = RequestFactory().get("/", HTTP_X_REAL_IP=ip, HTTP_USER_AGENT="test")
        return request

    def test_a_customers_address_is_stored_as_its_network_and_the_chain_still_verifies(self):
        customer = _customer()
        event = activity.record(customer, "login", request=self._request("203.0.113.57"))
        self.assertEqual(event.ip, "203.0.113.0")
        v6 = activity.record(customer, "login", request=self._request("2001:db8:aa:bb:1:2:3:4"))
        self.assertEqual(v6.ip, "2001:db8:aa::")
        self.assertEqual(activity.verify_chain(), (True, None))

    def test_staff_actions_keep_the_full_address(self):
        staff = make_staff("support", "s1@example.com")
        self.assertEqual(activity.record(staff, "edit", request=self._request("203.0.113.57")).ip, "203.0.113.57")
        self.assertEqual(ActivityEvent.objects.count(), 1)


class ExportTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _get(self, account, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
        return self.client.get("/api/accounts/me/export/")

    def test_a_customer_gets_their_own_data_only_with_numbers_masked_and_no_secrets(self):
        customer, other = _customer(), Customer.objects.create(full_name="Kofi", phone="+233201112233", password_hash="x")
        CustomerAddress.objects.create(customer=customer, label="Home", gps_address="AK-039-5028", landmark="Near the market")
        _order(customer)
        _order(other)
        _destination("customer", customer.pk, number="0241234567")
        Notification.objects.create(customer=customer, kind=Notification.ORDER_STATUS, title="Shipped")
        conversation = Conversation.objects.create(customer=customer, subject="Parcel")
        Message.objects.create(conversation=conversation, sender_type=Message.CUSTOMER, body="Where is it?")
        Message.objects.create(conversation=conversation, sender_type=Message.STAFF, body="Internal", kind=Message.NOTE, is_internal=True)
        response = self._get(customer, "customer")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["account_type"], "customer")
        self.assertEqual(body["profile"]["phone"], "+233241234567")
        self.assertEqual([a["gps_address"] for a in body["addresses"]], ["AK-039-5028"])
        self.assertEqual(len(body["orders"]), 1)
        self.assertEqual(body["orders"][0]["delivery"]["address"], "Plot 4, Adum")
        self.assertEqual(body["notifications"][0]["title"], "Shipped")
        self.assertEqual([m["text"] for m in body["support_conversations"][0]["messages"]], ["Where is it?"])
        self.assertNotIn("0241234567", body["payout_destinations"][0]["number"])
        text = response.content.decode()
        for secret in ("password_hash", "pbkdf2", "Internal", "Kofi", "0201112233"):
            self.assertNotIn(secret, text)
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_a_business_owner_gets_masked_identity_and_payout_numbers(self):
        owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233207886600", email="k@example.com", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name="Kente House", ghana_card_number="GHA-123456789-0", tin="C0012345678",
            payout_momo_number="0207886600", payout_momo_name="Kwame Trader",
        )
        body = self._get(owner, "business_owner").json()
        self.assertEqual(body["profile"]["login_phone"], "+233207886600")
        self.assertEqual(body["business"]["business_name"], "Kente House")
        text = str(body)
        for full in ("GHA-123456789-0", "C0012345678", "0207886600"):
            self.assertNotIn(full, text.replace("+233207886600", ""))
        self.assertTrue(body["business"]["ghana_card_number"].endswith("9-0"))

    def test_it_needs_a_signed_in_customer_or_owner(self):
        self.assertEqual(self.client.get("/api/accounts/me/export/").status_code, 401)
        staff = make_staff("support", "s2@example.com")
        self.assertEqual(self._get(staff, "staff").status_code, 403)


class HashedCodesTests(TestCase):
    """Review DB-14: invite tokens and secondary-contact codes are not stored in the clear."""

    def test_the_secondary_phone_code_is_stored_as_an_hmac_and_still_confirms(self):
        customer = _customer()
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        sent = client.post("/api/accounts/customers/me/secondary-phone/", {"secondary_phone": "+233201112233"}, format="json")
        self.assertEqual(sent.status_code, 200, sent.content)
        code = sent.json()["demo_code"]
        customer.refresh_from_db()
        self.assertNotEqual(customer.secondary_phone_verify_code, code)
        self.assertEqual(len(customer.secondary_phone_verify_code), 64)
        wrong = client.post("/api/accounts/customers/me/secondary-phone/confirm/", {"code": "000000" if code != "000000" else "111111"}, format="json")
        self.assertEqual(wrong.status_code, 400)
        right = client.post("/api/accounts/customers/me/secondary-phone/confirm/", {"code": code}, format="json")
        self.assertEqual(right.status_code, 200, right.content)

    def test_a_legacy_plaintext_code_still_matches_until_it_expires(self):
        from accounts import invite_tokens

        self.assertTrue(invite_tokens.verify_code_matches("123456", "123456"))
        self.assertFalse(invite_tokens.verify_code_matches("123456", "654321"))
        self.assertFalse(invite_tokens.verify_code_matches(None, "123456"))

    def test_the_pickup_collection_code_is_encrypted_in_the_column(self):
        from django.db import connection

        from ledger.models import FulfilmentCheck

        order = _order(_customer())
        check = FulfilmentCheck.objects.create(order=order, collection_code="123456")
        with connection.cursor() as cursor:
            cursor.execute("select collection_code from ledger_fulfilmentcheck where id = %s", [check.pk])
            stored = cursor.fetchone()[0]
        self.assertTrue(stored.startswith("enc1:"))
        check.refresh_from_db()
        self.assertEqual(check.collection_code, "123456")
