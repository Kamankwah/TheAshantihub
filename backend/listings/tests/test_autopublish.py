"""Minimal auto-publish at submit (self-serve phase 2, Task 8): a live business's clean listing is published at once,
a fixable one comes back with reasons, a prohibited word or the daily limit sends it to staff. Switch off, nothing
changes."""
import io
import shutil
import tempfile
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from fraud.models import FraudFlag
from listings import autopublish
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from otp.models import EMAIL, VerifiedContact

MEDIA = tempfile.mkdtemp(prefix="autopublish-test-")
LONG = "Handwoven kente cloth made in Bonwire, six yards, bright gold and green."


def image_file(width, height, name="photo.jpg"):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (212, 160, 23)).save(buffer, "JPEG")
    return ContentFile(buffer.getvalue(), name=name)


def make_owner(phone, *, kind="service", email="trader@example.com", verified_address=False):
    owner = BusinessOwner.objects.create(full_name="Ama Trader", login_phone=phone, password_hash="x", email=email)
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_contact_phone=phone, business_kind=kind,
        lat=Decimal("6.690000"), lng=Decimal("-1.620000"), terms_accepted_at=timezone.now(),
        address_verified=verified_address, address_verified_at=timezone.now() if verified_address else None,
    )
    VerifiedContact.objects.create(
        account_type="business_owner", account_id=owner.pk, channel=EMAIL, destination=email.lower(),
    )
    return BusinessOwner.objects.get(pk=owner.pk)


@override_settings(MEDIA_ROOT=MEDIA, LISTING_AUTO_PUBLISH_ENABLED=True, LISTING_PROHIBITED_TERMS=[], UNVERIFIED_DAILY_LISTING_LIMIT=20)
class AutoPublishTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.client = APIClient()
        self.hotels = Category.objects.get(slug="hotels")  # a service category
        self.goods = Category.objects.filter(kind="product").first()
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = make_owner("+233241460001")

    def listing(self, owner=None, *, category=None, name="Kente cloth", description=LONG, price="120.00",
                photo=(900, 900), status=Listing.DRAFT):
        owner = owner or self.owner
        row = Listing.objects.create(
            business_owner=owner, category=category or self.hotels, zone=self.zone, name=name,
            description=description, contact_phone=owner.login_phone,
            price_amount=None if price is None else Decimal(price), status=status,
        )
        if photo:
            row.main_photo.save("photo.jpg", image_file(*photo), save=True)
        return row

    def submit(self, listing, owner=None):
        owner = owner or listing.business_owner
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        return self.client.post(f"/api/listings/mine/{listing.pk}/submit/")

    def assert_fix(self, response, listing, expected):
        self.assertEqual(response.status_code, 400, response.content)
        body = response.json()
        self.assertEqual(body["code"], "needs_fixes")
        self.assertEqual(body["reasons"], [expected])
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.DRAFT)

    # ---- fix reasons, one at a time ------------------------------------------------------------------------
    def test_small_photo_is_a_fix(self):
        row = self.listing(photo=(799, 900))
        self.assert_fix(self.submit(row), row, "Your main photo is 799 by 900 pixels. Upload one that is at least 800 by 800 pixels.")

    def test_exactly_800_by_800_passes(self):
        row = self.listing(photo=(800, 800))
        self.assertEqual(self.submit(row).json()["status"], Listing.PUBLISHED)

    def test_photoless_listing_is_a_fix_not_a_500(self):
        row = self.listing(photo=None)
        self.assert_fix(self.submit(row), row, autopublish.NO_PHOTO)

    def test_corrupt_image_is_a_fix_not_a_500(self):
        row = self.listing(photo=None)
        row.main_photo.save("bad.jpg", ContentFile(b"this is not an image"), save=True)
        with self.assertLogs("listings.autopublish", "WARNING"):
            response = self.submit(row)
        self.assert_fix(response, row, autopublish.UNREADABLE_PHOTO)

    def test_zero_byte_image_is_a_fix_not_a_500(self):
        row = self.listing(photo=None)
        row.main_photo.save("empty.jpg", ContentFile(b""), save=True)
        with self.assertLogs("listings.autopublish", "WARNING"):
            response = self.submit(row)
        self.assert_fix(response, row, autopublish.UNREADABLE_PHOTO)

    def test_missing_file_is_a_fix_not_a_500(self):
        row = self.listing()
        row.main_photo.storage.delete(row.main_photo.name)
        with self.assertLogs("listings.autopublish", "WARNING"):
            response = self.submit(row)
        self.assert_fix(response, row, autopublish.UNREADABLE_PHOTO)

    def test_a_storage_outage_holds_the_listing_for_staff_and_never_blames_the_owner(self):
        from unittest import mock

        row = self.listing()
        with mock.patch.object(row.main_photo.storage, "open", side_effect=ConnectionError("storage is down")):
            verdict = autopublish.evaluate(row)
            self.assertEqual(verdict.outcome, autopublish.HOLD)
            self.assertEqual(verdict.reasons[0], autopublish.PHOTO_CHECK_UNAVAILABLE)
            self.assertNotIn(autopublish.UNREADABLE_PHOTO, verdict.reasons)
            with self.assertLogs("listings.autopublish", "WARNING"):
                response = self.submit(row)
        self.assertEqual((response.status_code, response.json()["status"]), (200, Listing.PENDING_REVIEW))
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PENDING_REVIEW)

    def test_other_fixes_are_still_asked_for_during_a_storage_outage(self):
        from unittest import mock

        row = self.listing(name="Ab")
        with mock.patch.object(row.main_photo.storage, "open", side_effect=ConnectionError("down")):
            with self.assertLogs("listings.autopublish", "WARNING"):
                verdict = autopublish.evaluate(row)
        self.assertEqual((verdict.outcome, verdict.reasons), (autopublish.FIX, [autopublish.SHORT_NAME]))

    def test_short_name_is_a_fix(self):
        row = self.listing(name="Ab")
        self.assert_fix(self.submit(row), row, autopublish.SHORT_NAME)

    def test_short_description_is_a_fix(self):
        row = self.listing(description="x" * 39)
        self.assert_fix(self.submit(row), row, autopublish.SHORT_DESCRIPTION)

    def test_zero_price_is_a_fix(self):
        row = self.listing(price="0.00")
        self.assert_fix(self.submit(row), row, autopublish.NO_PRICE)

    def test_missing_price_is_a_fix(self):
        row = self.listing(price=None)
        self.assert_fix(self.submit(row), row, autopublish.NO_PRICE)

    def test_wrong_kind_category_is_a_fix(self):
        row = self.listing(category=self.goods)  # the business is registered for services
        self.assert_fix(
            self.submit(row), row, "Your business is registered for service listings only. Choose a service category.",
        )

    def test_phone_number_in_description_is_a_fix(self):
        row = self.listing(description=LONG + " Call 0241234567 now.")
        self.assert_fix(self.submit(row), row, autopublish.CONTACT_IN_TEXT)

    def test_link_in_name_is_a_fix(self):
        row = self.listing(name="Buy at shop.com")
        self.assert_fix(self.submit(row), row, autopublish.CONTACT_IN_TEXT)

    def test_several_problems_are_all_listed(self):
        row = self.listing(name="Ab", price="0")
        response = self.submit(row)
        self.assertEqual(response.json()["reasons"], [autopublish.SHORT_NAME, autopublish.NO_PRICE])

    def test_a_rejected_listing_that_needs_fixes_stays_rejected(self):
        row = self.listing(name="Ab", status=Listing.REJECTED)
        response = self.submit(row)
        self.assertEqual(response.status_code, 400)
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.REJECTED)

    # ---- pass ----------------------------------------------------------------------------------------------
    def test_clean_listing_is_published_at_once_and_owner_notified(self):
        row = self.listing()
        response = self.submit(row)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"id": row.pk, "status": "published"})
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PUBLISHED)
        self.assertIsNone(row.reviewed_by)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, kind="listing_approved").exists())

    def test_a_rejected_listing_resubmitted_clean_is_published_and_reason_cleared(self):
        row = self.listing(status=Listing.REJECTED)
        Listing.objects.filter(pk=row.pk).update(rejection_reason="Blurry photo")
        self.assertEqual(self.submit(row).status_code, 200)
        row.refresh_from_db()
        self.assertEqual((row.status, row.rejection_reason), (Listing.PUBLISHED, None))

    # ---- hold ----------------------------------------------------------------------------------------------
    def test_prohibited_term_holds_for_staff_with_no_error(self):
        with self.settings(LISTING_PROHIBITED_TERMS=["Gun", " "]):
            row = self.listing(description=LONG + " Includes a gun holster.")
            response = self.submit(row)
        self.assertEqual(response.status_code, 200, response.content)
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PENDING_REVIEW)

    def test_prohibited_term_matches_whole_words_only(self):
        with self.settings(LISTING_PROHIBITED_TERMS=["gun"]):
            row = self.listing(description=LONG + " Gunpowder tea blend, a Ghanaian favourite.")
            self.submit(row)
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PUBLISHED)

    def test_the_21st_listing_of_the_day_by_a_located_business_holds(self):
        for index in range(20):
            self.listing(name=f"Earlier {index}", status=Listing.PENDING_REVIEW)
        row = self.listing(name="Twenty first")
        self.assertEqual(self.submit(row).status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PENDING_REVIEW)

    def test_the_20th_listing_of_the_day_still_publishes(self):
        for index in range(19):
            self.listing(name=f"Earlier {index}", status=Listing.PENDING_REVIEW)
        row = self.listing(name="Twentieth")
        self.submit(row)
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PUBLISHED)

    def test_listings_from_before_today_do_not_count(self):
        for index in range(20):
            old = self.listing(name=f"Earlier {index}", status=Listing.PUBLISHED)
            Listing.objects.filter(pk=old.pk).update(updated_at=timezone.now() - timedelta(days=2))
        row = self.listing(name="Today")
        self.submit(row)
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PUBLISHED)

    def test_accra_day_boundary_is_local_midnight(self):
        midnight = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        before = self.listing(name="Just before", status=Listing.PUBLISHED)
        after = self.listing(name="Just after", status=Listing.PUBLISHED)
        Listing.objects.filter(pk=before.pk).update(updated_at=midnight - timedelta(seconds=1))
        Listing.objects.filter(pk=after.pk).update(updated_at=midnight + timedelta(seconds=1))
        self.assertEqual(autopublish.submitted_today(self.owner), 1)

    def test_a_verified_location_business_is_not_limited(self):
        owner = make_owner("+233241460002", email="verified@example.com", verified_address=True)
        for index in range(20):
            self.listing(owner, name=f"Earlier {index}", status=Listing.PENDING_REVIEW)
        row = self.listing(owner, name="Twenty first")
        self.submit(row)
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PUBLISHED)

    # ---- first-listing spot check ----------------------------------------------------------------------------
    def test_first_published_listing_raises_exactly_one_flag_and_the_second_none(self):
        self.submit(self.listing(name="First one"))
        flags = FraudFlag.objects.filter(business_owner=self.owner)
        self.assertEqual(flags.count(), 1)
        flag = flags.get()
        self.assertEqual((flag.kind, flag.status, flag.dedupe_key), ("other", "open", f"first-listing-{self.owner.pk}"))
        self.submit(self.listing(name="Second one"))
        self.assertEqual(FraudFlag.objects.filter(business_owner=self.owner).count(), 1)

    def test_a_held_listing_raises_no_flag(self):
        with self.settings(LISTING_PROHIBITED_TERMS=["gun"]):
            self.submit(self.listing(description=LONG + " gun"))
        self.assertFalse(FraudFlag.objects.filter(business_owner=self.owner).exists())

    def test_the_flag_kind_reverses_no_commission_and_cannot_suspend(self):
        from commission.services import REVERSING_KINDS

        self.assertNotIn(FraudFlag.OTHER, REVERSING_KINDS)
        self.assertNotIn(FraudFlag.OTHER, FraudFlag.SUSPENDABLE)

    # ---- unchanged behaviour ---------------------------------------------------------------------------------
    @override_settings(LISTING_AUTO_PUBLISH_ENABLED=False)
    def test_switch_off_leaves_a_clean_listing_pending_review(self):
        row = self.listing()
        response = self.submit(row)
        self.assertEqual((response.status_code, response.json()["status"]), (200, "pending_review"))
        self.assertFalse(FraudFlag.objects.exists())

    @override_settings(LISTING_AUTO_PUBLISH_ENABLED=False)
    def test_switch_off_does_not_ask_for_fixes(self):
        row = self.listing(name="Ab", photo=None)
        self.assertEqual(self.submit(row).json()["status"], "pending_review")

    def test_not_live_owner_still_gets_403_not_live(self):
        VerifiedContact.objects.all().delete()
        row = self.listing()
        response = self.submit(row)
        self.assertEqual((response.status_code, response.json()["code"]), (403, "not_live"))
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.DRAFT)

    def test_the_company_owner_and_staff_made_listings_never_auto_publish(self):
        company = BusinessOwner.objects.create(
            full_name="Ashanti Direct", login_phone="+233241460009", password_hash="x", is_company=True,
        )
        self.assertFalse(autopublish.eligible(company, self.listing(company)))
        staff_made = self.listing(name="Scout draft")
        self.assertTrue(autopublish.eligible(self.owner, staff_made))
        Listing.objects.filter(pk=staff_made.pk).update(created_by_staff=self._staff())
        staff_made.refresh_from_db()
        self.assertFalse(autopublish.eligible(self.owner, staff_made))

    def _staff(self):
        from accounts.models import Role, StaffUser

        return StaffUser.objects.create(
            full_name="Scout Person", email="scout-ap@example.com", password_hash="x", role=Role.objects.get(name="operations"),
        )

    # ---- the submit door locks the row -------------------------------------------------------------------------
    # A real two-thread race needs a TransactionTestCase and a second connection; these change the row at the exact
    # moment the view has read it but not yet locked it (inside the permission check after the first read).
    def published_notices(self):
        return Notification.objects.filter(business_owner=self.owner, kind="listing_approved").count()

    def test_a_second_submit_of_a_published_listing_is_the_same_400_and_sends_no_second_notice(self):
        row = self.listing()
        self.assertEqual(self.submit(row).status_code, 200)
        response = self.submit(row)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"status": "Only draft or rejected listings can be submitted for review."})
        self.assertEqual(self.published_notices(), 1)
        self.assertEqual(FraudFlag.objects.filter(business_owner=self.owner).count(), 1)

    def test_a_listing_dropped_after_the_first_read_is_not_resurrected(self):
        from unittest import mock

        from listings.views import ListingSubmitView

        row = self.listing()
        original = ListingSubmitView.check_object_permissions

        def drop_then_check(view, request, obj):
            Listing.objects.filter(pk=obj.pk).update(status=Listing.DROPPED)  # another request, after our read
            return original(view, request, obj)

        with mock.patch.object(ListingSubmitView, "check_object_permissions", drop_then_check):
            response = self.submit(row)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"status": "A dropped or discontinued listing cannot be submitted."})
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.DROPPED)
        self.assertEqual(self.published_notices(), 0)

    def test_a_failing_notification_still_answers_200_with_the_listing_published(self):
        from unittest import mock

        row = self.listing()
        with mock.patch("listings.views.notify_business_owner", side_effect=RuntimeError("boom")):
            with self.assertLogs("listings.views", "ERROR"):
                response = self.submit(row)
        self.assertEqual((response.status_code, response.json()["status"]), (200, "published"))
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.PUBLISHED)
        self.assertEqual(FraudFlag.objects.filter(business_owner=self.owner).count(), 1)


class _Handle:
    """A stand-in for a storage file object whose reads fail the way a remote store fails."""

    def __init__(self, error):
        self.error = error

    def read(self, *args):
        raise self.error

    def seek(self, *args):
        raise self.error

    def tell(self):
        raise self.error

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class BotoLikeError(Exception):
    """Not an OSError, like botocore's exceptions."""


@override_settings(MEDIA_ROOT=MEDIA, LISTING_AUTO_PUBLISH_ENABLED=True, LISTING_PROHIBITED_TERMS=[], UNVERIFIED_DAILY_LISTING_LIMIT=20)
class PhotoCheckExceptionTests(TestCase):
    """Opening the file from storage is told apart from decoding it: a bad file is the owner's to fix, a storage or
    unexpected failure holds the listing for staff, and nothing is ever a 500."""

    def setUp(self):
        self.client = APIClient()
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = make_owner("+233241460011")
        self.row = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"), zone=self.zone, name="Kente cloth",
            description=LONG, contact_phone=self.owner.login_phone, price_amount=Decimal("120.00"),
        )
        self.row.main_photo.save("photo.jpg", image_file(900, 900), save=True)

    def submit(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        return self.client.post(f"/api/listings/mine/{self.row.pk}/submit/")

    def assert_fix(self):
        with self.assertLogs("listings.autopublish", "WARNING"):
            response = self.submit()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["reasons"], [autopublish.UNREADABLE_PHOTO])

    def assert_hold(self):
        with self.assertLogs("listings.autopublish", "WARNING"):
            response = self.submit()
        self.assertEqual((response.status_code, response.json().get("status")), (200, Listing.PENDING_REVIEW), response.content)
        self.row.refresh_from_db()
        self.assertEqual([item["code"] for item in self.row.hold_reasons], ["photo_check_unavailable"])

    # ---- opening ----------------------------------------------------------------------------------------
    def test_a_missing_file_is_a_fix(self):
        with mock.patch.object(self.row.main_photo.storage, "open", side_effect=FileNotFoundError("gone")):
            self.assert_fix()

    def test_a_value_error_on_open_is_a_fix(self):
        with mock.patch.object(self.row.main_photo.storage, "open", side_effect=ValueError("no file")):
            self.assert_fix()

    def test_connection_timeout_botocore_style_and_generic_errors_on_open_hold(self):
        for error in (ConnectionError("down"), TimeoutError("slow"), BotoLikeError("EndpointConnectionError"),
                      PermissionError("denied"), RuntimeError("anything")):
            with self.subTest(error=type(error).__name__):
                self.row.status = Listing.DRAFT
                self.row.save(update_fields=["status"])
                with mock.patch.object(self.row.main_photo.storage, "open", side_effect=error):
                    self.assert_hold()

    # ---- decoding ---------------------------------------------------------------------------------------
    def test_an_unidentifiable_image_is_a_fix(self):
        from PIL import UnidentifiedImageError

        with mock.patch("PIL.Image.open", side_effect=UnidentifiedImageError("cannot identify")):
            self.assert_fix()

    def test_a_decompression_bomb_is_a_fix(self):
        with mock.patch("PIL.Image.open", side_effect=Image.DecompressionBombError("too big")):
            self.assert_fix()

    def test_pillow_os_and_value_errors_are_fixes(self):
        for error in (OSError("image file is truncated"), ValueError("bad header"), SyntaxError("bad png")):
            with self.subTest(error=type(error).__name__):
                with mock.patch("PIL.Image.open", side_effect=error):
                    self.assert_fix()

    def test_a_truncated_file_is_a_fix(self):
        buffer = io.BytesIO()
        Image.new("RGB", (900, 900), (1, 2, 3)).save(buffer, "PNG")
        self.row.main_photo.save("cut.png", ContentFile(buffer.getvalue()[:20]), save=True)
        self.assert_fix()

    def test_a_storage_error_while_reading_the_bytes_holds_not_fixes(self):
        # ConnectionError and TimeoutError are OSErrors, as Pillow's decode failures are; the read is still storage's.
        for error in (ConnectionError("reset"), TimeoutError("read timed out"), BotoLikeError("ReadTimeoutError")):
            with self.subTest(error=type(error).__name__):
                self.row.status = Listing.DRAFT
                self.row.save(update_fields=["status"])
                with mock.patch.object(self.row.main_photo.storage, "open", return_value=_Handle(error)):
                    self.assert_hold()

    def test_an_unexpected_decoder_error_holds(self):
        with mock.patch("PIL.Image.open", side_effect=RuntimeError("decoder bug")):
            self.assert_hold()


@override_settings(MEDIA_ROOT=MEDIA, LISTING_AUTO_PUBLISH_ENABLED=True, LISTING_PROHIBITED_TERMS=[], UNVERIFIED_DAILY_LISTING_LIMIT=20)
class HoldReasonsTests(TestCase):
    """The reasons a listing was held or sent back are stored on it: staff see exactly why, the owner sees a generic
    line for a hold and the plain fix sentences for a fix, and the reasons never outlive the state they describe."""

    def setUp(self):
        self.client = APIClient()
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = make_owner("+233241460021")
        self.staff = make_staff("operations", "hold-reasons@example.com")

    def listing(self, **extra):
        values = dict(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"), zone=self.zone, name="Kente cloth",
            description=LONG, contact_phone=self.owner.login_phone, price_amount=Decimal("120.00"),
        )
        values.update(extra)
        row = Listing.objects.create(**values)
        row.main_photo.save("photo.jpg", image_file(900, 900), save=True)
        return row

    def as_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def as_staff(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.staff)}")

    def submit(self, row):
        self.as_owner()
        return self.client.post(f"/api/listings/mine/{row.pk}/submit/")

    def held_listing(self):
        with self.settings(LISTING_PROHIBITED_TERMS=["gun"]):
            row = self.listing(description=LONG + " Includes a gun holster.")
            self.assertEqual(self.submit(row).json()["status"], Listing.PENDING_REVIEW)
        row.refresh_from_db()
        return row

    def queue_row(self, row, status="pending"):
        self.as_staff()
        body = self.client.get(f"/api/listings/moderation/pending/?status={status}").json()
        return next(item for item in body if item["id"] == row.pk)

    def test_a_prohibited_term_hold_stores_a_coded_reason(self):
        row = self.held_listing()
        self.assertEqual([item["code"] for item in row.hold_reasons], ["prohibited_term"])
        self.assertIn("gun", row.hold_reasons[0]["message"])

    def test_the_daily_limit_hold_stores_a_coded_reason(self):
        with self.settings(UNVERIFIED_DAILY_LISTING_LIMIT=1):
            self.listing(status=Listing.PUBLISHED)
            row = self.listing()
            self.assertEqual(self.submit(row).json()["status"], Listing.PENDING_REVIEW)
        row.refresh_from_db()
        self.assertEqual([item["code"] for item in row.hold_reasons], ["daily_limit"])

    def test_a_storage_failure_hold_stores_a_coded_reason(self):
        row = self.listing()
        with mock.patch.object(row.main_photo.storage, "open", side_effect=ConnectionError("down")):
            with self.assertLogs("listings.autopublish", "WARNING"):
                self.submit(row)
        row.refresh_from_db()
        self.assertEqual([item["code"] for item in row.hold_reasons], ["photo_check_unavailable"])

    def test_staff_queue_shows_why_a_listing_is_held(self):
        row = self.held_listing()
        item = self.queue_row(row)
        self.assertEqual([entry["code"] for entry in item["hold_reasons"]], ["prohibited_term"])
        self.assertIn("gun", item["hold_reasons"][0]["message"])

    def test_staff_queue_hold_reasons_is_an_empty_list_for_a_plain_pending_listing(self):
        with self.settings(LISTING_AUTO_PUBLISH_ENABLED=False):
            row = self.listing()
            self.submit(row)
        self.assertEqual(self.queue_row(row)["hold_reasons"], [])

    def test_the_owner_payload_hides_the_specifics_of_a_hold(self):
        row = self.held_listing()
        self.as_owner()
        item = next(i for i in self.client.get("/api/listings/mine/").json() if i["id"] == row.pk)
        self.assertEqual(item["hold_notice"], autopublish.OWNER_HOLD_NOTICE)
        self.assertEqual(item["fix_reasons"], [])
        self.assertNotIn("hold_reasons", item)
        self.assertNotIn("gun", str(item["hold_notice"]).lower())
        self.assertNotIn("prohibited", str(item).lower())

    def test_a_fix_stores_the_sentences_and_the_owner_payload_shows_them(self):
        row = self.listing(name="Ab")
        response = self.submit(row)
        self.assertEqual(response.status_code, 400)
        row.refresh_from_db()
        self.assertEqual(row.status, Listing.DRAFT)
        self.assertEqual([item["code"] for item in row.hold_reasons], ["name_too_short"])
        self.as_owner()
        item = next(i for i in self.client.get("/api/listings/mine/").json() if i["id"] == row.pk)
        self.assertEqual(item["fix_reasons"], [autopublish.SHORT_NAME])
        self.assertIsNone(item["hold_notice"])

    def test_a_clean_resubmit_after_a_fix_publishes_and_clears_the_reasons(self):
        row = self.listing(name="Ab")
        self.submit(row)
        Listing.objects.filter(pk=row.pk).update(name="Kente cloth")
        self.assertEqual(self.submit(row).json()["status"], Listing.PUBLISHED)
        row.refresh_from_db()
        self.assertEqual(row.hold_reasons, [])

    def test_a_resubmit_that_is_held_again_replaces_the_old_reasons(self):
        row = self.listing(name="Ab")
        self.submit(row)
        with self.settings(LISTING_PROHIBITED_TERMS=["gun"]):
            Listing.objects.filter(pk=row.pk).update(name="Kente cloth", description=LONG + " a gun holster")
            self.submit(row)
        row.refresh_from_db()
        self.assertEqual([item["code"] for item in row.hold_reasons], ["prohibited_term"])

    def test_a_resubmit_with_the_switch_off_clears_the_reasons(self):
        row = self.listing(name="Ab")
        self.submit(row)
        Listing.objects.filter(pk=row.pk).update(name="Kente cloth")
        with self.settings(LISTING_AUTO_PUBLISH_ENABLED=False):
            self.submit(row)
        row.refresh_from_db()
        self.assertEqual((row.status, row.hold_reasons), (Listing.PENDING_REVIEW, []))

    def test_staff_approve_clears_the_reasons(self):
        row = self.held_listing()
        self.as_staff()
        self.assertEqual(self.client.post(f"/api/listings/moderation/{row.pk}/approve/").status_code, 200)
        row.refresh_from_db()
        self.assertEqual((row.status, row.hold_reasons), (Listing.PUBLISHED, []))

    def test_staff_reject_clears_the_reasons(self):
        row = self.held_listing()
        self.as_staff()
        self.assertEqual(
            self.client.post(f"/api/listings/moderation/{row.pk}/reject/", {"reason": "No"}, format="json").status_code, 200,
        )
        row.refresh_from_db()
        self.assertEqual((row.status, row.hold_reasons), (Listing.REJECTED, []))

    def test_re_review_of_a_rejected_listing_starts_with_no_stale_reasons(self):
        row = self.listing(status=Listing.REJECTED, hold_reasons=[{"code": "daily_limit", "message": "old"}])
        self.as_staff()
        self.assertEqual(self.client.post(f"/api/listings/moderation/{row.pk}/re-review/").status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.hold_reasons, [])

    def test_a_published_listing_never_shows_reasons(self):
        row = self.listing(status=Listing.PUBLISHED, hold_reasons=[{"code": "daily_limit", "message": "stale"}])
        self.assertEqual(self.queue_row(row, "approved")["hold_reasons"], [])
        self.as_owner()
        item = next(i for i in self.client.get("/api/listings/mine/").json() if i["id"] == row.pk)
        self.assertEqual((item["hold_notice"], item["fix_reasons"]), (None, []))
