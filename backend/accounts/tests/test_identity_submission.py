import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts import kyc
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff, staff_token

TEST_MEDIA_ROOT = tempfile.mkdtemp()
URL = "/api/accounts/business-owners/me/identity/"
PROFILE_URL = "/api/accounts/business-owners/me/profile/"


def _image(name="card.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def _pdf(name="cert.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", content_type="application/pdf")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class IdentitySubmissionTests(TestCase):
    _counter = 0

    def _owner(self, kyc_status=BusinessOwner.PENDING, **profile_fields):
        type(self)._counter += 1
        n = type(self)._counter
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {n}", login_phone=f"+2332100000{n:02d}", password_hash="x", kyc_status=kyc_status,
        )
        defaults = dict(business_owner=owner, gps_address="AK-039-5050", business_contact_phone=owner.login_phone)
        defaults.update(profile_fields)
        BusinessOwnerProfile.objects.create(**defaults)
        return owner

    def _client(self, owner):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        return client

    def _profile(self, owner):
        return BusinessOwnerProfile.objects.get(business_owner=owner)

    def _payload(self, number="GHA-100000001-1", **extra):
        body = {
            "ghana_card_number": number,
            "ghana_card_front_image": _image("front.jpg"),
            "ghana_card_back_image": _image("back.jpg"),
        }
        body.update(extra)
        return body

    def test_post_with_number_and_both_photos_becomes_pending(self):
        owner = self._owner()
        before = timezone.now()
        response = self._client(owner).post(URL, self._payload(), format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["identity_status"], "pending")
        self.assertIsNone(body["identity_rejection_reason"])
        self.assertIsNotNone(body["identity_submitted_at"])
        self.assertFalse(body["has_certificate"])
        self.assertFalse(body["has_tin"])
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "pending")
        self.assertGreaterEqual(profile.identity_submitted_at, before)
        self.assertEqual(profile.ghana_card_number, "GHA-100000001-1")
        self.assertTrue(profile.ghana_card_front_image)
        self.assertTrue(profile.ghana_card_back_image)

    def test_post_without_back_photo_is_400_and_stays_not_submitted(self):
        owner = self._owner()
        payload = self._payload()
        del payload["ghana_card_back_image"]
        response = self._client(owner).post(URL, payload, format="multipart")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("ghana_card_back_image", response.json())
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "not_submitted")
        self.assertIsNone(profile.ghana_card_number)
        self.assertFalse(profile.ghana_card_front_image)

    def test_blank_number_is_400(self):
        owner = self._owner()
        response = self._client(owner).post(URL, self._payload(number="   "), format="multipart")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("ghana_card_number", response.json())
        self.assertEqual(self._profile(owner).identity_status, "not_submitted")

    def test_certificate_and_tin_are_optional(self):
        plain = self._owner()
        response = self._client(plain).post(URL, self._payload(), format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["is_formal"])

        formal = self._owner()
        response = self._client(formal).post(
            URL,
            self._payload(
                number="GHA-100000002-2", is_formal="true", tin="C0012345678", business_reg_certificate=_pdf(),
            ),
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["is_formal"])
        self.assertTrue(body["has_certificate"])
        self.assertTrue(body["has_tin"])
        profile = self._profile(formal)
        self.assertEqual(profile.tin, "C0012345678")
        self.assertTrue(profile.business_reg_certificate)

    def test_resubmit_after_rejection_becomes_pending_and_clears_reason(self):
        owner = self._owner(
            identity_status=BusinessOwnerProfile.IDENTITY_REJECTED,
            identity_rejection_reason="Photo is blurry.",
            ghana_card_number="GHA-OLD-1",
        )
        response = self._client(owner).post(URL, self._payload(number="GHA-100000003-3"), format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["identity_status"], "pending")
        self.assertIsNone(response.json()["identity_rejection_reason"])
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "pending")
        self.assertIsNone(profile.identity_rejection_reason)
        self.assertEqual(profile.ghana_card_number, "GHA-100000003-3")
        self.assertIsNotNone(profile.identity_submitted_at)

    def test_post_while_pending_is_409(self):
        owner = self._owner(identity_status=BusinessOwnerProfile.IDENTITY_PENDING, ghana_card_number="GHA-KEEP-1")
        response = self._client(owner).post(URL, self._payload(number="GHA-100000004-4"), format="multipart")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertIn("detail", response.json())
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "pending")
        self.assertEqual(profile.ghana_card_number, "GHA-KEEP-1")
        self.assertFalse(profile.ghana_card_front_image)

    def test_post_while_verified_is_409_and_documents_unchanged(self):
        owner = self._owner(
            identity_status=BusinessOwnerProfile.IDENTITY_VERIFIED,
            ghana_card_number="GHA-KEEP-2",
            ghana_card_front_image="ghana_cards/keep_front.jpg",
            ghana_card_back_image="ghana_cards/keep_back.jpg",
        )
        response = self._client(owner).post(URL, self._payload(number="GHA-100000005-5"), format="multipart")
        self.assertEqual(response.status_code, 409, response.content)
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "verified")
        self.assertEqual(profile.ghana_card_number, "GHA-KEEP-2")
        self.assertEqual(profile.ghana_card_front_image.name, "ghana_cards/keep_front.jpg")
        self.assertEqual(profile.ghana_card_back_image.name, "ghana_cards/keep_back.jpg")

    def test_works_while_kyc_pending_and_while_kyc_verified(self):
        for index, kyc_status in enumerate((BusinessOwner.PENDING, BusinessOwner.VERIFIED)):
            with self.subTest(kyc_status=kyc_status):
                owner = self._owner(kyc_status=kyc_status)
                response = self._client(owner).post(
                    URL, self._payload(number=f"GHA-20000000{index}-0"), format="multipart",
                )
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(self._profile(owner).identity_status, "pending")
                owner.refresh_from_db()
                self.assertEqual(owner.kyc_status, kyc_status)

    def test_get_never_returns_card_number_or_photo_urls(self):
        owner = self._owner()
        client = self._client(owner)
        self.assertEqual(client.get(URL).json()["identity_status"], "not_submitted")
        response = client.post(URL, self._payload(number="GHA-300000001-1", tin="T123"), format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        for answer in (response, client.get(URL)):
            self.assertEqual(answer.status_code, 200)
            body = answer.json()
            self.assertEqual(
                set(body),
                {"identity_status", "identity_rejection_reason", "identity_submitted_at", "is_formal",
                 "has_certificate", "has_tin"},
            )
            text = answer.content.decode()
            self.assertNotIn("GHA-300000001-1", text)
            self.assertNotIn("ghana_cards", text)
            self.assertNotIn("media", text)

    def test_duplicate_card_number_is_400_generic_message(self):
        holder = self._owner(ghana_card_number="GHA-400000001-1")
        other = self._owner()
        response = self._client(other).post(URL, self._payload(number="GHA-400000001-1"), format="multipart")
        self.assertEqual(response.status_code, 400, response.content)
        body = response.json()
        self.assertIn("ghana_card_number", body)
        text = response.content.decode().lower()
        self.assertNotIn("already", text)
        self.assertNotIn("exists", text)
        self.assertNotIn(holder.full_name.lower(), text)
        self.assertNotIn(holder.login_phone, text)
        self.assertEqual(self._profile(other).identity_status, "not_submitted")
        self.assertIsNone(self._profile(other).ghana_card_number)
        # Resubmitting your own number is not a duplicate.
        mine = self._owner(
            identity_status=BusinessOwnerProfile.IDENTITY_REJECTED, ghana_card_number="GHA-400000002-2",
        )
        response = self._client(mine).post(URL, self._payload(number="GHA-400000002-2"), format="multipart")
        self.assertEqual(response.status_code, 200, response.content)

    def test_profile_patch_with_full_card_makes_identity_pending(self):
        owner = self._owner()
        response = self._client(owner).patch(PROFILE_URL, self._payload(number="GHA-500000001-1"), format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["identity_status"], "pending")
        self.assertIsNone(response.json()["identity_rejection_reason"])
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "pending")
        self.assertIsNotNone(profile.identity_submitted_at)

    def test_profile_patch_with_partial_card_stays_not_submitted(self):
        owner = self._owner()
        payload = self._payload(number="GHA-500000002-2")
        del payload["ghana_card_back_image"]
        response = self._client(owner).patch(PROFILE_URL, payload, format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["identity_status"], "not_submitted")
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "not_submitted")
        self.assertIsNone(profile.identity_submitted_at)

    def test_profile_patch_cannot_set_identity_status(self):
        owner = self._owner()
        response = self._client(owner).patch(
            PROFILE_URL, {"identity_status": "verified", "identity_rejection_reason": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._profile(owner).identity_status, "not_submitted")

    def test_profile_patch_of_other_fields_does_not_resubmit_a_rejected_identity(self):
        owner = self._owner(
            identity_status=BusinessOwnerProfile.IDENTITY_REJECTED,
            identity_rejection_reason="Photo is blurry.",
            ghana_card_number="GHA-500000003-3",
            ghana_card_front_image="ghana_cards/f.jpg",
            ghana_card_back_image="ghana_cards/b.jpg",
        )
        response = self._client(owner).patch(PROFILE_URL, {"gps_address": "AK-039-1111"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["identity_status"], "rejected")
        self.assertEqual(response.json()["identity_rejection_reason"], "Photo is blurry.")

    def _locked_owner(self, status, kyc_status=BusinessOwner.PENDING):
        return self._owner(
            kyc_status=kyc_status,
            identity_status=status,
            ghana_card_number="GHA-700000001-1",
            ghana_card_front_image="ghana_cards/keep_front.jpg",
            ghana_card_back_image="ghana_cards/keep_back.jpg",
        )

    def _assert_documents_unchanged(self, owner, status):
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, status)
        self.assertEqual(profile.ghana_card_number, "GHA-700000001-1")
        self.assertEqual(profile.ghana_card_front_image.name, "ghana_cards/keep_front.jpg")
        self.assertEqual(profile.ghana_card_back_image.name, "ghana_cards/keep_back.jpg")

    def test_profile_patch_cannot_change_documents_while_pending_or_verified(self):
        for status in (BusinessOwnerProfile.IDENTITY_PENDING, BusinessOwnerProfile.IDENTITY_VERIFIED):
            cases = {
                "number": ({"ghana_card_number": "GHA-700000009-9"}, "ghana_card_number"),
                "blank number": ({"ghana_card_number": ""}, "ghana_card_number"),
                "front photo": ({"ghana_card_front_image": _image("f.jpg")}, "ghana_card_front_image"),
                "back photo": ({"ghana_card_back_image": _image("b.jpg")}, "ghana_card_back_image"),
            }
            for label, (payload, field) in cases.items():
                with self.subTest(status=status, case=label):
                    BusinessOwner.objects.all().delete()
                    owner = self._locked_owner(status)
                    response = self._client(owner).patch(PROFILE_URL, payload, format="multipart")
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertIn(field, response.json())
                    self.assertIn("in review", response.json()[field][0] if isinstance(response.json()[field], list) else response.json()[field])
                    self._assert_documents_unchanged(owner, status)

    def test_profile_patch_with_the_same_number_while_pending_is_a_no_op(self):
        owner = self._locked_owner(BusinessOwnerProfile.IDENTITY_PENDING)
        response = self._client(owner).patch(
            PROFILE_URL, {"ghana_card_number": "GHA-700000001-1", "gps_address": "AK-039-1111"}, format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self._assert_documents_unchanged(owner, "pending")
        self.assertEqual(self._profile(owner).gps_address, "AK-039-1111")

    def test_unrelated_patch_while_identity_verified_leaves_identity_untouched(self):
        staff = make_staff("operations", "reviewer@example.com")
        owner = self._locked_owner(BusinessOwnerProfile.IDENTITY_VERIFIED)
        stamp = timezone.now()
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(
            identity_submitted_at=stamp, identity_reviewed_at=stamp, identity_reviewed_by=staff,
        )
        response = self._client(owner).patch(
            PROFILE_URL, {"gps_address": "AK-039-2222", "business_contact_phone": "+233208889900"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        profile = self._profile(owner)
        self.assertEqual(profile.gps_address, "AK-039-2222")
        self.assertEqual(profile.identity_status, "verified")
        self.assertEqual(profile.identity_submitted_at, stamp)
        self.assertEqual(profile.identity_reviewed_at, stamp)
        self.assertEqual(profile.identity_reviewed_by_id, staff.pk)
        self._assert_documents_unchanged(owner, "verified")

    def test_profile_patch_locks_the_profile_row_and_validates_against_it(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        owner = self._owner()
        with CaptureQueriesContext(connection) as queries:
            response = self._client(owner).patch(PROFILE_URL, {"gps_address": "AK-039-3333"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        # A SELECT ... FOR UPDATE on the profile only works inside a transaction, so this also shows the PATCH is atomic.
        locking = [q["sql"] for q in queries.captured_queries if "FOR UPDATE" in q["sql"]
                   and "accounts_businessownerprofile" in q["sql"]]
        self.assertTrue(locking)
        # Only the profile row is locked: other code locks the owner first and the profile second, so also locking
        # the joined owner row here (in the opposite order) could deadlock.
        for sql in locking:
            clause = sql[sql.index("FOR UPDATE"):]
            self.assertIn('OF "accounts_businessownerprofile"', clause)
            self.assertNotIn("accounts_businessowner\"", clause)

    def test_profile_patch_validates_the_rule_against_the_row_not_a_stale_copy(self):
        # The row becomes pending after the owner's request began: the refusal reads the locked, current row.
        from unittest import mock

        owner = self._owner(ghana_card_number="GHA-700000001-1")
        original = BusinessOwnerProfile.objects.select_for_update

        def pending_before_lock(**kwargs):
            BusinessOwnerProfile.objects.filter(business_owner=owner).update(identity_status="pending")
            return original(**kwargs)

        with mock.patch.object(BusinessOwnerProfile.objects, "select_for_update", side_effect=pending_before_lock):
            response = self._client(owner).patch(PROFILE_URL, {"ghana_card_number": "GHA-700000009-9"}, format="json")
        # Refused (the test's own pending update rolls back with the refused request's transaction).
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("ghana_card_number", response.json())
        self.assertEqual(self._profile(owner).ghana_card_number, "GHA-700000001-1")

    def test_profile_patch_with_card_fields_on_a_rejected_identity_resubmits(self):
        owner = self._owner(
            identity_status=BusinessOwnerProfile.IDENTITY_REJECTED,
            identity_rejection_reason="Photo is blurry.",
            ghana_card_number="GHA-700000002-2",
            ghana_card_front_image="ghana_cards/f.jpg",
            ghana_card_back_image="ghana_cards/b.jpg",
        )
        response = self._client(owner).patch(
            PROFILE_URL, {"ghana_card_front_image": _image("new_front.jpg")}, format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["identity_status"], "pending")
        self.assertIsNone(response.json()["identity_rejection_reason"])
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, "pending")
        self.assertIsNotNone(profile.identity_submitted_at)
        self.assertNotEqual(profile.ghana_card_front_image.name, "ghana_cards/f.jpg")

    def test_me_exposes_identity_status(self):
        owner = self._owner()
        client = self._client(owner)
        body = client.get("/api/accounts/me/").json()
        self.assertEqual(body["identity_status"], "not_submitted")
        self.assertIsNone(body["identity_rejection_reason"])
        profile = self._profile(owner)
        profile.identity_status = BusinessOwnerProfile.IDENTITY_REJECTED
        profile.identity_rejection_reason = "Photo is blurry."
        profile.save()
        body = client.get("/api/accounts/me/").json()
        self.assertEqual(body["identity_status"], "rejected")
        self.assertEqual(body["identity_rejection_reason"], "Photo is blurry.")

    def test_customer_and_staff_get_403(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200003333", password_hash="x")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertEqual(client.get(URL).status_code, 403)
        self.assertEqual(client.post(URL, self._payload(), format="multipart").status_code, 403)

        staff = make_staff("operations", "ops@example.com")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        self.assertEqual(client.get(URL).status_code, 403)
        self.assertEqual(client.post(URL, self._payload(), format="multipart").status_code, 403)


class SubmitIdentityServiceTests(TestCase):
    def _profile(self, **fields):
        owner = BusinessOwner.objects.create(full_name="Svc Owner", login_phone="+233210009999", password_hash="x")
        return BusinessOwnerProfile.objects.create(business_owner=owner, **fields)

    def _full(self, **extra):
        return dict(
            ghana_card_number="GHA-600000001-1",
            ghana_card_front_image="ghana_cards/f.jpg",
            ghana_card_back_image="ghana_cards/b.jpg",
            **extra,
        )

    def test_moves_not_submitted_to_pending_and_is_idempotent(self):
        profile = self._profile(**self._full())
        self.assertTrue(kyc.submit_identity(profile))
        self.assertEqual(profile.identity_status, "pending")
        stamp = profile.identity_submitted_at
        self.assertIsNotNone(stamp)
        self.assertFalse(kyc.submit_identity(profile))
        profile.refresh_from_db()
        self.assertEqual(profile.identity_status, "pending")
        self.assertEqual(profile.identity_submitted_at, stamp)

    def test_refuses_without_all_documents(self):
        profile = self._profile(ghana_card_number="GHA-600000002-2", ghana_card_front_image="ghana_cards/f.jpg")
        self.assertFalse(kyc.submit_identity(profile))
        profile.refresh_from_db()
        self.assertEqual(profile.identity_status, "not_submitted")

    def test_rejected_resubmits_and_clears_reason_but_verified_and_pending_do_not_move(self):
        rejected = self._profile(
            **self._full(identity_status="rejected", identity_rejection_reason="Blurry"),
        )
        self.assertTrue(kyc.submit_identity(rejected))
        rejected.refresh_from_db()
        self.assertEqual((rejected.identity_status, rejected.identity_rejection_reason), ("pending", None))
        rejected.identity_status = "verified"
        rejected.save()
        self.assertFalse(kyc.submit_identity(rejected))
        rejected.refresh_from_db()
        self.assertEqual(rejected.identity_status, "verified")
