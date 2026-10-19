"""Hero slider slides (plan M1 Task 7): images, direct video, YouTube, dates, staff slides."""
import io
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner
from accounts.testing import make_staff, staff_token
from listings import hero_rules
from listings.models import HeroMediaSubmission

MEDIA = tempfile.mkdtemp()

MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
WEBM = (
    b"\x1a\x45\xdf\xa3\xa3\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08"
    b"\x42\x82\x84webm\x42\x87\x81\x04\x42\x85\x81\x02" + b"\x00" * 64
)
YT = "dQw4w9WgXcQ"


def _image(name="s.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def _window(start_h=1, days=7):
    now = timezone.now()
    return {
        "starts_at": (now + timedelta(hours=start_h)).isoformat(),
        "ends_at": (now + timedelta(hours=start_h, days=days)).isoformat(),
    }


@override_settings(MEDIA_ROOT=MEDIA)
class HeroSlideBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Ama Trader", login_phone="+233207990001", password_hash="x")
        self.owner_token = issue_token(self.owner, "business_owner")
        self.marketing = make_staff("marketing", "mk-slides@example.com")
        self.operations = make_staff("operations", "ops-slides@example.com")
        self.boss = make_staff("super_admin", "boss-slides@example.com")
        self.support = make_staff("support", "sup-slides@example.com")

    def as_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.owner_token}")

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def submit(self, **over):
        self.as_owner()
        data = {"media_type": "image", "media": _image(), "title": "Kente sale", "caption": "Fresh weaves", **_window()}
        data.update(over)
        data = {k: v for k, v in data.items() if v is not None}
        return self.client.post("/api/hero/submit/", data, format="multipart")

    def live_slide(self, **over):
        now = timezone.now()
        fields = dict(
            business_owner=self.owner, media_type="image", caption="c", title="t", status=HeroMediaSubmission.APPROVED,
            starts_at=now - timedelta(hours=1), ends_at=now + timedelta(days=1), approved_at=now,
            expires_at=now + timedelta(days=1),
        )
        fields.update(over)
        row = HeroMediaSubmission(**fields)
        row.media.save("m.jpg", _image(), save=False)
        row.save()
        return row


class BusinessSubmissionTests(HeroSlideBase):
    def test_business_submits_image_slide_pending(self):
        r = self.submit()
        self.assertEqual(r.status_code, 201, r.content)
        row = HeroMediaSubmission.objects.get(pk=r.json()["id"])
        self.assertEqual((row.status, row.business_owner, row.media_type), ("pending", self.owner, "image"))
        self.assertIsNotNone(row.starts_at)
        self.assertIsNone(row.reviewed_by)

    def test_business_submits_youtube_slide_normalises_id(self):
        for url in (
            f"https://www.youtube.com/watch?v={YT}&t=3s", f"https://youtu.be/{YT}?si=x",
            f"https://youtube.com/embed/{YT}", f"https://www.youtube.com/shorts/{YT}",
        ):
            r = self.submit(media_type="video", media=None, youtube_url=url)
            self.assertEqual(r.status_code, 201, (url, r.content))
            row = HeroMediaSubmission.objects.get(pk=r.json()["id"])
            self.assertEqual(row.youtube_url, f"https://www.youtube.com/watch?v={YT}")
            self.assertEqual(r.json()["youtube_id"], YT)

    def test_business_uploads_video_file_validated(self):
        ok = self.submit(media_type="video", media=None, video_file=SimpleUploadedFile("a.mp4", MP4, content_type="video/mp4"))
        self.assertEqual(ok.status_code, 201, ok.content)
        webm = self.submit(media_type="video", media=None, video_file=SimpleUploadedFile("a.webm", WEBM, content_type="video/webm"))
        self.assertEqual(webm.status_code, 201, webm.content)
        bad = self.submit(media_type="video", media=None, video_file=SimpleUploadedFile("evil.mp4", b"MZ\x90\x00\x03" + b"\x00" * 200, content_type="video/mp4"))
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(HeroMediaSubmission.objects.count(), 2)

    def test_video_needs_exactly_one_source(self):
        mp4 = SimpleUploadedFile("a.mp4", MP4, content_type="video/mp4")
        self.assertEqual(self.submit(media_type="video", media=None).status_code, 400)
        both = self.submit(media_type="video", media=None, video_file=mp4, youtube_url=f"https://youtu.be/{YT}")
        self.assertEqual(both.status_code, 400)

    def test_image_needs_media(self):
        self.assertEqual(self.submit(media=None).status_code, 400)

    def test_non_youtube_url_rejected(self):
        for url in ("https://vimeo.com/123456", "https://evil.example/watch?v=" + YT, "https://youtube.com.evil.example/watch?v=" + YT,
                    "https://www.youtube.com/watch?v=short", "javascript:alert(1)"):
            r = self.submit(media_type="video", media=None, youtube_url=url)
            self.assertEqual(r.status_code, 400, url)

    def test_window_longer_than_30_days_rejected(self):
        r = self.submit(**_window(days=31))
        self.assertEqual(r.status_code, 400)
        self.assertIn("A hero slide can run for at most 30 days.", str(r.json()))

    def test_exactly_30_days_accepted(self):
        self.assertEqual(self.submit(**_window(days=30)).status_code, 201)

    def test_window_must_end_after_start_and_not_start_in_the_past(self):
        now = timezone.now()
        self.assertEqual(self.submit(starts_at=now.isoformat(), ends_at=(now - timedelta(days=1)).isoformat()).status_code, 400)
        self.assertEqual(self.submit(starts_at=(now - timedelta(days=3)).isoformat(), ends_at=(now + timedelta(days=2)).isoformat()).status_code, 400)

    def test_link_path_must_be_site_relative(self):
        for bad in ("https://evil.example", "//evil.example", "javascript:alert(1)", "events", "/a\\b"):
            self.assertEqual(self.submit(link_path=bad).status_code, 400, bad)
        self.assertEqual(self.submit(link_path="/events?x=1").status_code, 201)

    def test_unlimited_slides_not_capped_by_plan(self):
        for _ in range(4):
            self.assertEqual(self.submit().status_code, 201)

    def test_legacy_listing_photo_submit_still_needs_photo_id(self):
        r = self.submit(listing_photo=999999, media=None)
        self.assertEqual(r.status_code, 404)


class ApprovalTests(HeroSlideBase):
    def test_marketing_operations_super_admin_can_approve(self):
        for staff in (self.marketing, self.operations, self.boss):
            sub_id = self.submit().json()["id"]
            self.as_staff(staff)
            r = self.client.post(f"/api/listings/hero/{sub_id}/approve/")
            self.assertEqual(r.status_code, 200, (staff.role.name, r.content))
            row = HeroMediaSubmission.objects.get(pk=sub_id)
            self.assertEqual((row.status, row.reviewed_by), ("approved", staff))
            self.assertEqual(row.expires_at, row.ends_at)

    def test_support_cannot_approve(self):
        sub_id = self.submit().json()["id"]
        self.as_staff(self.support)
        self.assertEqual(self.client.post(f"/api/listings/hero/{sub_id}/approve/").status_code, 403)
        self.assertEqual(self.client.post("/api/hero/staff/", {}, format="multipart").status_code, 403)

    def test_rejected_slide_can_be_re_reviewed(self):
        sub_id = self.submit().json()["id"]
        self.as_staff(self.marketing)
        self.assertEqual(self.client.post(f"/api/listings/hero/{sub_id}/reject/", {"reason": "Blurry"}, format="json").status_code, 200)
        row = HeroMediaSubmission.objects.get(pk=sub_id)
        self.assertEqual((row.status, row.reviewed_by), ("rejected", self.marketing))
        self.assertEqual(self.client.post(f"/api/listings/hero/{sub_id}/re-review/").status_code, 200)
        row.refresh_from_db()
        self.assertEqual((row.status, row.reviewed_by, row.reviewed_at, row.rejection_reason), ("pending", None, None, None))
        self.assertEqual(self.client.post(f"/api/listings/hero/{sub_id}/re-review/").status_code, 400)

    def test_cannot_approve_a_slide_whose_window_has_ended(self):
        row = HeroMediaSubmission(business_owner=self.owner, media_type="image", caption="c", starts_at=timezone.now() - timedelta(days=3),
                                  ends_at=timezone.now() - timedelta(days=1))
        row.media.save("m.jpg", _image(), save=False)
        row.save()
        self.as_staff(self.marketing)
        self.assertEqual(self.client.post(f"/api/listings/hero/{row.pk}/approve/").status_code, 400)

    def test_contact_details_in_title_refused_at_submit_and_blocked_at_approval(self):
        self.assertEqual(self.submit(title="Call 0244 123 456").status_code, 400)
        row = self.live_slide(status="pending", title="Call 0244 123 456")
        self.as_staff(self.marketing)
        self.assertEqual(self.client.post(f"/api/listings/hero/{row.pk}/approve/").status_code, 400)


class StaffSlideTests(HeroSlideBase):
    def staff_post(self, **over):
        self.as_staff(self.marketing)
        data = {"media_type": "image", "media": _image(), "title": "Opening day", "caption": "We open 6 Nov", "link_path": "/deals", **_window(start_h=0)}
        data.update(over)
        return self.client.post("/api/hero/staff/", {k: v for k, v in data.items() if v is not None}, format="multipart")

    def test_marketing_created_slide_is_live_in_window(self):
        r = self.staff_post(starts_at=(timezone.now() - timedelta(minutes=1)).isoformat())
        self.assertEqual(r.status_code, 201, r.content)
        row = HeroMediaSubmission.objects.get(pk=r.json()["id"])
        self.assertEqual((row.status, row.reviewed_by, row.created_by_staff, row.business_owner), ("approved", self.marketing, self.marketing, None))
        self.assertIsNotNone(row.reviewed_at)
        self.client.credentials()
        feed = self.client.get("/api/hero/active/").json()
        self.assertEqual([x["id"] for x in feed], [row.pk])
        self.assertEqual(feed[0]["link_path"], "/deals")

    def test_staff_slide_rules_match_business_rules(self):
        self.assertEqual(self.staff_post(**_window(start_h=0, days=31)).status_code, 400)
        self.assertEqual(self.staff_post(link_path="https://evil.example").status_code, 400)
        self.assertEqual(self.staff_post(media_type="video", media=None, youtube_url="https://vimeo.com/1").status_code, 400)
        ok = self.staff_post(media_type="video", media=None, youtube_url=f"https://youtu.be/{YT}")
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.json()["youtube_id"], YT)

    def test_staff_slide_can_be_rejected_without_a_business(self):
        sub_id = self.staff_post().json()["id"]
        self.assertEqual(self.client.post(f"/api/listings/hero/{sub_id}/reject/", {"reason": "Wrong"}, format="json").status_code, 200)


class ActiveFeedTests(HeroSlideBase):
    def feed(self):
        self.client.credentials()
        r = self.client.get("/api/hero/active/")
        self.assertEqual(r.status_code, 200)
        return r.json()

    def test_slide_not_active_before_start_or_after_end(self):
        now = timezone.now()
        self.live_slide(starts_at=now + timedelta(hours=2), ends_at=now + timedelta(days=2))
        self.live_slide(starts_at=now - timedelta(days=3), ends_at=now - timedelta(hours=1), expires_at=now - timedelta(hours=1))
        pending = self.live_slide(status="pending")
        self.assertEqual(self.feed(), [])
        self.assertFalse(hero_rules.is_live(pending, now))

    def test_unlimited_slides_returned_in_start_order(self):
        now = timezone.now()
        rows = [self.live_slide(starts_at=now - timedelta(hours=h)) for h in (1, 5, 3, 2, 4, 6)]
        ids = [x["id"] for x in self.feed()]
        expected = [r.pk for r in sorted(rows, key=lambda r: r.starts_at)]
        self.assertEqual(ids, expected)

    def test_active_feed_has_no_contact_fields(self):
        self.live_slide(media_type="video", media=None, youtube_url=f"https://www.youtube.com/watch?v={YT}")
        item = self.feed()[0]
        for key in ("id", "media_type", "image", "video_url", "youtube_id", "title", "caption", "link_path", "listing_id"):
            self.assertIn(key, item)
        self.assertEqual(item["youtube_id"], YT)
        for banned in ("phone", "email", "contact", "login_phone", "business_owner", "reviewed_by"):
            self.assertFalse([k for k in item if banned in k], banned)
        self.assertNotIn(self.owner.login_phone, str(item))

    def test_video_file_slide_exposes_video_url(self):
        row = self.live_slide(media_type="video", media=None)
        row.video_file.save("a.mp4", SimpleUploadedFile("a.mp4", MP4), save=True)
        item = self.feed()[0]
        self.assertTrue(item["video_url"].endswith(".mp4") or ".mp4" in item["video_url"])
        self.assertIsNone(item["youtube_id"])

    def test_old_rows_without_dates_keep_their_expiry(self):
        now = timezone.now()
        old = self.live_slide(starts_at=None, ends_at=None, expires_at=now + timedelta(days=2))
        gone = self.live_slide(starts_at=None, ends_at=None, expires_at=now - timedelta(days=2))
        ids = [x["id"] for x in self.feed()]
        self.assertIn(old.pk, ids)
        self.assertNotIn(gone.pk, ids)
        self.assertTrue(hero_rules.is_live(old, now))
        self.assertFalse(hero_rules.is_live(gone, now))


class PermissionSeedTests(TestCase):
    def test_approver_roles_hold_hero_permission(self):
        from accounts.models import Role

        for name in ("marketing", "operations", "super_admin"):
            self.assertTrue(Role.objects.get(name=name).permissions.filter(codename="hero_media.approve").exists(), name)
        self.assertFalse(Role.objects.get(name="support").permissions.filter(codename="hero_media.approve").exists())


class RulesUnitTests(TestCase):
    def test_validate_window(self):
        from django.core.exceptions import ValidationError

        now = timezone.now()
        hero_rules.validate_window(now, now + timedelta(days=30), now=now)
        with self.assertRaisesMessage(ValidationError, "A hero slide can run for at most 30 days."):
            hero_rules.validate_window(now, now + timedelta(days=30, seconds=1), now=now)
