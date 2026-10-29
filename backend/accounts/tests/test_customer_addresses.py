import threading

from django.db import connection
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, CustomerAddress
from accounts.testing import make_staff

URL = "/api/accounts/addresses/"


def body(**over):
    data = {
        "label": "Home", "recipient_name": "Ama Buyer", "phone": "024 123 4567",
        "gps_address": "AK-039-5028", "landmark": "Blue gate behind the chemist",
    }
    data.update(over)
    return data


def as_customer(customer):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
    return client


def make_customer(phone="+233200002222"):
    return Customer.objects.create(full_name="Ama Buyer", phone=phone, password_hash="x")


class AddressBookTests(TestCase):
    def setUp(self):
        self.customer = make_customer()
        self.client = as_customer(self.customer)

    def post(self, **over):
        return self.client.post(URL, body(**over), format="json")

    def test_first_address_becomes_default(self):
        first = self.post()
        self.assertEqual(first.status_code, 201, first.content)
        self.assertTrue(first.json()["is_default"])
        second = self.post(label="Work")
        self.assertFalse(second.json()["is_default"])
        self.assertEqual(
            set(first.json()),
            {"id", "label", "recipient_name", "phone", "gps_address", "landmark", "address_text",
             "lat", "lng", "is_default", "created_at"},
        )

    def test_list_is_plain_default_first_then_newest(self):
        a = self.post(label="A").json()["id"]
        b = self.post(label="B").json()["id"]
        c = self.post(label="C").json()["id"]
        rows = self.client.get(URL).json()
        self.assertIsInstance(rows, list)
        self.assertEqual([r["id"] for r in rows], [a, c, b])

    def test_set_default_moves_the_flag_and_only_one_is_default(self):
        a = self.post(label="A").json()["id"]
        b = self.post(label="B").json()["id"]
        response = self.client.post(f"{URL}{b}/set-default/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["is_default"])
        defaults = list(self.customer.addresses.filter(is_default=True).values_list("id", flat=True))
        self.assertEqual(defaults, [b])
        again = self.client.post(f"{URL}{b}/set-default/")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(self.customer.addresses.filter(is_default=True).count(), 1)
        self.assertFalse(CustomerAddress.objects.get(pk=a).is_default)

    def test_gps_is_validated_and_normalised(self):
        ok = self.post(gps_address="  ak-039-5028 ")
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.json()["gps_address"], "AK-039-5028")
        bad = self.post(gps_address="not a code")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("gps_address", bad.json())
        patched = self.client.patch(f"{URL}{ok.json()['id']}/", {"gps_address": "ak-123-4567"}, format="json")
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(patched.json()["gps_address"], "AK-123-4567")
        bad_patch = self.client.patch(f"{URL}{ok.json()['id']}/", {"gps_address": "zz"}, format="json")
        self.assertEqual(bad_patch.status_code, 400)

    def test_non_ashanti_code_refused(self):
        response = self.post(gps_address="GA-123-4567")
        self.assertEqual(response.status_code, 400)
        self.assertIn("gps_address", response.json())
        self.assertEqual(CustomerAddress.objects.count(), 0)

    def test_landmark_required(self):
        for value in ("", "   "):
            response = self.post(landmark=value)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(
                response.json()["landmark"], ["Add a landmark near your door so the rider can find you."]
            )
        long = self.post(landmark="x" * 201)
        self.assertEqual(long.json()["landmark"], ["Keep the landmark under 200 characters."])

    def test_recipient_and_phone_required(self):
        self.assertEqual(self.post(recipient_name="").status_code, 400)
        self.assertEqual(self.post(phone="").status_code, 400)
        self.assertEqual(self.post(phone="12").status_code, 400)

    def test_eleventh_address_refused_400(self):
        for i in range(10):
            self.assertEqual(self.post(label=f"A{i}").status_code, 201)
        response = self.post(label="one too many")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json(), {"detail": "You can save up to 10 addresses. Remove one to add another."}
        )
        self.assertEqual(self.customer.addresses.count(), 10)

    def test_delete_default_promotes_the_newest_other(self):
        a = self.post(label="A").json()["id"]
        b = self.post(label="B").json()["id"]
        c = self.post(label="C").json()["id"]
        self.assertEqual(self.client.delete(f"{URL}{a}/").status_code, 204)
        self.assertEqual(list(self.customer.addresses.filter(is_default=True).values_list("id", flat=True)), [c])
        # Deleting a non-default leaves the default alone.
        self.assertEqual(self.client.delete(f"{URL}{b}/").status_code, 204)
        self.assertTrue(CustomerAddress.objects.get(pk=c).is_default)
        self.assertEqual(self.client.delete(f"{URL}{c}/").status_code, 204)
        self.assertEqual(CustomerAddress.objects.count(), 0)

    def test_patch_cannot_change_is_default(self):
        a = self.post(label="A").json()["id"]
        b = self.post(label="B").json()["id"]
        response = self.client.patch(f"{URL}{b}/", {"is_default": True, "label": "B2"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["label"], "B2")
        self.assertFalse(response.json()["is_default"])
        self.assertTrue(CustomerAddress.objects.get(pk=a).is_default)

    def test_another_customers_address_is_404_for_get_patch_delete_and_default(self):
        other = make_customer("+233200003333")
        theirs = CustomerAddress.objects.create(
            customer=other, label="Theirs", recipient_name="Kofi", phone="0241234567",
            gps_address="AK-039-5028", landmark="Mango tree", is_default=True,
        )
        url = f"{URL}{theirs.pk}/"
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {"label": "Mine"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)
        self.assertEqual(self.client.post(f"{url}set-default/").status_code, 404)
        self.assertEqual(self.client.get(URL).json(), [])
        theirs.refresh_from_db()
        self.assertEqual(theirs.label, "Theirs")
        self.assertTrue(theirs.is_default)

    def test_staff_and_business_owner_get_403(self):
        staff = make_staff("operations", "ops@example.com")
        owner = BusinessOwner.objects.create(
            full_name="Efua", login_phone="+233206665544", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        for account, kind in ((staff, "staff"), (owner, "business_owner")):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind, two_factor=True)}")
            self.assertEqual(client.get(URL).status_code, 403, kind)
            self.assertEqual(client.post(URL, body(), format="json").status_code, 403, kind)

    def test_anonymous_401(self):
        anon = APIClient()
        self.assertEqual(anon.get(URL).status_code, 401)
        self.assertEqual(anon.post(URL, body(), format="json").status_code, 401)


class AddressDefaultRaceTests(TransactionTestCase):
    serialized_rollback = True  # a flush must not wipe migration-seeded rows for the classes that run after
    def test_two_simultaneous_set_defaults_leave_exactly_one(self):
        customer = make_customer()
        rows = [
            CustomerAddress.objects.create(
                customer=customer, label=str(i), recipient_name="A", phone="0241234567",
                gps_address="AK-039-5028", landmark="Gate", is_default=(i == 0),
            )
            for i in range(3)
        ]
        statuses = []

        def worker(pk):
            try:
                statuses.append(as_customer(customer).post(f"{URL}{pk}/set-default/").status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(rows[i].pk,)) for i in (1, 2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(statuses, [200, 200])
        self.assertEqual(customer.addresses.filter(is_default=True).count(), 1)
