"""Listing media: up to 9 images and 2 videos, uploads converted for the web, staged media hidden until approved."""
import io
import tempfile
from datetime import timedelta
from unittest import mock

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser
from core import video as core_video
from listings import media, revisions, tasks
from listings.models import Category, Listing, ListingPhoto, ListingRevision, ListingVideo, Zone

TEST_MEDIA_ROOT = tempfile.mkdtemp()
FIVE_MB = 5 * 1024 * 1024
MP4_HEAD = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
YT = "dQw4w9WgXcQ"
FIXED_FAILURE = "We could not process this video. Try another file."


def make_owner(name, phone):
    owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x", kyc_status=BusinessOwner.VERIFIED)
    BusinessOwnerProfile.objects.create(
        business_owner=owner, ghana_card_number=f"GHA-{phone[-9:]}-1", gps_address="AK-039-7001",
        business_contact_phone=phone, is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
        payout_momo_number=phone, payout_momo_name=name,
    )
    return owner


def jpeg(name="p.jpg", size=None):
    buf = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buf, format="JPEG")
    data = buf.getvalue()
    if size:
        data += b"\0" * (size - len(data))  # trailing bytes keep it a valid JPEG
    return SimpleUploadedFile(name, data, content_type="image/jpeg")


def mp4(name="clip.mp4", size=2048):
    return SimpleUploadedFile(name, MP4_HEAD + b"\0" * (size - len(MP4_HEAD)), content_type="video/mp4")


def fake_probe(duration=12.0):
    return mock.patch.object(core_video, "probe", return_value={"duration": duration, "size": 2048})


def fake_ffmpeg():
    def convert(src, dst):
        with open(dst, "wb") as out:
            out.write(MP4_HEAD + b"web")

    def poster(src, dst):
        buf = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buf, format="JPEG")
        with open(dst, "wb") as out:
            out.write(buf.getvalue())

    return (
        mock.patch.object(core_video, "convert_to_web_mp4", side_effect=convert),
        mock.patch.object(core_video, "poster_frame", side_effect=poster),
    )


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class ListingMediaTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_owner("Ama Bakes", "+233207775001")
        self.other = make_owner("Kofi Other", "+233207775002")
        self.zone = Zone.objects.get(name="Manhyia")
        self.shops = Category.objects.get(slug="shops")
        self.draft = self.listing(Listing.DRAFT)
        self.live = self.listing(Listing.PUBLISHED)
        self.auth(self.owner)

    def listing(self, status, owner=None):
        return Listing.objects.create(
            business_owner=owner or self.owner, category=self.shops, zone=self.zone, name="Cake", description="A cake.",
            contact_phone="+233207775001", price_amount="10.00", stock_quantity=5, status=status,
        )

    def auth(self, who, kind="business_owner"):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who, kind)}")

    def photos_url(self, listing=None, photo=None):
        base = f"/api/listings/mine/{(listing or self.draft).pk}/photos/"
        return f"{base}{photo.pk}/" if photo else base

    def videos_url(self, listing=None, video=None):
        base = f"/api/listings/mine/{(listing or self.draft).pk}/videos/"
        return f"{base}{video.pk}/" if video else base

    def add_photo(self, listing=None, **kw):
        return self.client.post(self.photos_url(listing), {"image": kw.pop("image", None) or jpeg(), **kw}, format="multipart")

    def upload_video(self, listing=None, **kw):
        return self.client.post(self.videos_url(listing), {"file": mp4()}, format="multipart")

    def youtube(self, listing=None, url=None):
        return self.client.post(self.videos_url(listing), {"youtube_url": url or f"https://youtu.be/{YT}"}, format="json")

    def convert_all(self):
        convert, poster = fake_ffmpeg()
        with fake_probe(5.0), convert, poster:
            for video in ListingVideo.objects.filter(kind="upload", status=ListingVideo.PROCESSING):
                tasks.convert_listing_video(video.pk)

    def public(self, listing):
        response = APIClient().get(f"/api/listings/{listing.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    # ── images ───────────────────────────────────────────────────────────────────────────────────────────────────

    def test_review_focus_nine_images_five_megabytes(self):
        self.assertEqual(media.MAX_IMAGE_BYTES, 5 * 1024 * 1024)
        self.assertEqual((media.MAX_IMAGES, media.MAX_VIDEOS, media.MAX_VIDEO_BYTES, media.MAX_VIDEO_SECONDS), (9, 2, 100 * 1024 * 1024, 60))
        for number in range(9):
            size = FIVE_MB if number < 2 else None
            response = self.add_photo(image=jpeg(f"p{number}.jpg", size))
            self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(ListingPhoto.objects.filter(listing=self.draft, revision=None).count(), 9)
        self.assertEqual(media.image_count(self.draft), 9)

    def test_main_photo_counts_toward_the_nine(self):
        self.draft.main_photo.save("main.jpg", ContentFile(jpeg().read()), save=True)
        for number in range(8):
            self.assertEqual(self.add_photo().status_code, 201)
        self.assertEqual(media.image_count(self.draft), 9)
        response = self.add_photo()
        self.assertEqual(response.status_code, 400)
        self.assertIn("9", response.json()["detail"])

    def test_a_tenth_image_is_refused(self):
        for _ in range(9):
            self.assertEqual(self.add_photo().status_code, 201)
        response = self.add_photo()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(ListingPhoto.objects.filter(listing=self.draft).count(), 9)

    def test_an_oversize_image_is_refused(self):
        self.assertEqual(self.add_photo(image=jpeg("exact.jpg", FIVE_MB)).status_code, 201)
        response = self.add_photo(image=jpeg("big.jpg", FIVE_MB + 1))
        self.assertEqual(response.status_code, 400)
        self.assertIn("5 MB", response.json()["detail"])
        self.assertEqual(ListingPhoto.objects.filter(listing=self.draft).count(), 1)

    def test_a_staged_replacement_main_photo_counts_once(self):
        self.live.main_photo.save("main.jpg", ContentFile(jpeg().read()), save=True)
        revisions.save_draft(self.live, self.owner, {}, new_main_photo=jpeg("new-main.jpg"))
        self.assertEqual(media.image_count(self.live), 1)
        for _ in range(8):
            self.assertEqual(self.add_photo(self.live).status_code, 201)
        self.assertEqual(self.add_photo(self.live).status_code, 400)

    def test_queued_removals_free_a_slot_and_staged_rows_count(self):
        rows = [ListingPhoto.objects.create(listing=self.live, image=jpeg(f"l{n}.jpg"), order=n) for n in range(9)]
        self.assertEqual(self.add_photo(self.live).status_code, 400)
        self.assertEqual(self.client.delete(self.photos_url(self.live, rows[0])).status_code, 202)
        self.assertEqual(media.image_count(self.live), 8)
        self.assertEqual(self.add_photo(self.live).status_code, 201)
        self.assertEqual(media.image_count(self.live), 9)
        self.assertEqual(self.add_photo(self.live).status_code, 400)

    def test_images_can_be_added_while_editing_an_approved_listing(self):
        response = self.add_photo(self.live)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()["staged"])
        photo = ListingPhoto.objects.get(pk=response.json()["id"])
        revision = ListingRevision.objects.get(listing=self.live)
        self.assertEqual((revision.status, photo.revision_id), (ListingRevision.DRAFT, revision.pk))

    def test_a_pending_revision_refuses_new_media_in_plain_words(self):
        revisions.save_draft(self.live, self.owner, {"changes": {"name": "Better Cake"}})
        revisions.submit(ListingRevision.objects.get(listing=self.live))
        response = self.add_photo(self.live)
        self.assertEqual(response.status_code, 400)
        self.assertIn("waiting for review", response.json()["detail"])
        self.assertEqual(self.youtube(self.live).status_code, 400)

    def test_a_discontinued_listing_takes_no_media(self):
        discontinued = self.listing(Listing.DISCONTINUED)
        self.assertEqual(self.add_photo(discontinued).status_code, 400)
        self.assertEqual(self.youtube(discontinued).status_code, 400)

    # ── videos ───────────────────────────────────────────────────────────────────────────────────────────────────

    def test_third_video_refused_whatever_the_kind(self):
        with fake_probe():
            self.assertEqual(self.upload_video().status_code, 201)
            self.assertEqual(self.youtube().status_code, 201)
            self.assertEqual(self.youtube().status_code, 400)
            response = self.upload_video()
            self.assertEqual(response.status_code, 400)
        self.assertEqual(ListingVideo.objects.filter(listing=self.draft).count(), 2)

    def test_video_over_sixty_seconds_is_refused_before_saving(self):
        with fake_probe(61.0):
            response = self.upload_video()
        self.assertEqual(response.status_code, 400)
        self.assertIn("60 seconds", response.json()["detail"])
        self.assertFalse(ListingVideo.objects.exists())
        with fake_probe(60.0):
            self.assertEqual(self.upload_video().status_code, 201)

    def test_video_over_one_hundred_megabytes_is_refused(self):
        with fake_probe() as probe, mock.patch.object(media, "MAX_VIDEO_BYTES", 1024):
            response = self.upload_video()
        self.assertEqual(response.status_code, 400)
        self.assertIn("100 MB", response.json()["detail"])
        probe.assert_not_called()
        self.assertFalse(ListingVideo.objects.exists())

    def test_an_unreadable_video_is_refused_without_tool_output(self):
        with mock.patch.object(core_video, "probe", side_effect=core_video.VideoError("ffprobe: secret /usr/bin path")):
            response = self.upload_video()
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("ffprobe", response.content.decode())
        self.assertFalse(ListingVideo.objects.exists())

    def test_a_file_that_is_not_a_video_is_refused(self):
        bad = SimpleUploadedFile("x.mp4", b"not a video at all" * 20, content_type="video/mp4")
        with fake_probe() as probe:
            response = self.client.post(self.videos_url(), {"file": bad}, format="multipart")
        self.assertEqual(response.status_code, 400)
        probe.assert_not_called()

    def test_upload_is_converted_to_a_web_format(self):
        with fake_probe(12.0):
            response = self.upload_video()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], "processing")
        video = ListingVideo.objects.get()
        self.assertTrue(video.source)
        convert, poster = fake_ffmpeg()
        with fake_probe(11.5), convert as convert_mock, poster:
            tasks.convert_listing_video(video.pk)
        video.refresh_from_db()
        self.assertEqual(video.status, ListingVideo.READY)
        self.assertTrue(video.web_file)
        self.assertTrue(video.poster)
        self.assertEqual(float(video.duration_seconds), 11.5)
        self.assertEqual(convert_mock.call_count, 1)

    def test_the_uploaded_source_is_deleted_after_conversion_and_after_failure(self):
        with fake_probe():
            self.upload_video()
            self.upload_video()
        ok, bad = ListingVideo.objects.order_by("pk")
        storage, ok_source, bad_source = ok.source.storage, ok.source.name, bad.source.name
        self.assertTrue(storage.exists(ok_source) and storage.exists(bad_source))
        convert, poster = fake_ffmpeg()
        with fake_probe(5.0), convert, poster, self.captureOnCommitCallbacks(execute=True):
            tasks.convert_listing_video(ok.pk)
        with mock.patch.object(core_video, "convert_to_web_mp4", side_effect=core_video.VideoError()):
            tasks.convert_listing_video(bad.pk)
        ok.refresh_from_db(), bad.refresh_from_db()
        self.assertFalse(ok.source or bad.source)
        self.assertTrue(ok.web_file and ok.poster)
        self.assertFalse(storage.exists(ok_source) or storage.exists(bad_source))

    def test_conversion_failure_marks_failed_with_fixed_text(self):
        with fake_probe():
            self.upload_video()
        video = ListingVideo.objects.get()
        with mock.patch.object(core_video, "convert_to_web_mp4", side_effect=core_video.VideoError("ffmpeg: /srv/secret exploded")):
            tasks.convert_listing_video(video.pk)
        video.refresh_from_db()
        self.assertEqual(video.status, ListingVideo.FAILED)
        listed = self.client.get("/api/listings/mine/").json()
        row = next(item for item in (listed["results"] if isinstance(listed, dict) else listed) if item["id"] == self.draft.pk)
        self.assertEqual(row["videos"][0]["status"], "failed")
        self.assertEqual(row["videos"][0]["error"], FIXED_FAILURE)
        self.assertNotIn("secret", str(row))

    def test_a_missing_ffmpeg_is_a_video_error(self):
        with mock.patch("subprocess.run", side_effect=FileNotFoundError("ffprobe")):
            with self.assertRaises(core_video.VideoError):
                core_video.probe("/nonexistent.mp4")

    def test_a_redelivered_task_converts_once(self):
        with fake_probe():
            self.upload_video()
        video = ListingVideo.objects.get()
        convert, poster = fake_ffmpeg()
        with fake_probe(5.0), convert as convert_mock, poster:
            tasks.convert_listing_video(video.pk)
            tasks.convert_listing_video(video.pk)
        self.assertEqual(convert_mock.call_count, 1)
        # A second delivery that arrives mid-conversion is also turned away.
        other = ListingVideo.objects.create(listing=self.draft, kind="upload", source="x.mp4", status=ListingVideo.CONVERTING)
        with convert as convert_mock, poster:
            tasks.convert_listing_video(other.pk)
        convert_mock.assert_not_called()

    def test_reaper_fails_rows_stuck_processing(self):
        old = timezone.now() - timedelta(minutes=45)
        stuck = ListingVideo.objects.create(listing=self.draft, kind="upload", source="a.mp4", status=ListingVideo.PROCESSING)
        converting = ListingVideo.objects.create(
            listing=self.draft, kind="upload", source="b.mp4", status=ListingVideo.CONVERTING, claimed_at=old,
        )
        fresh = ListingVideo.objects.create(listing=self.draft, kind="upload", source="c.mp4", status=ListingVideo.PROCESSING)
        ListingVideo.objects.filter(pk=stuck.pk).update(created_at=old)
        self.assertEqual(tasks.reap_stuck_videos(), 2)
        self.assertFalse(ListingVideo.objects.filter(pk__in=[stuck.pk, converting.pk]).exclude(source="").exclude(source=None).exists())
        for row in (stuck, converting, fresh):
            row.refresh_from_db()
        self.assertEqual((stuck.status, converting.status, fresh.status), ("failed", "failed", "processing"))

    def test_the_reaper_is_on_the_beat_schedule(self):
        from django.conf import settings

        self.assertIn("listings.tasks.reap_stuck_videos", {e["task"] for e in settings.CELERY_BEAT_SCHEDULE.values()})

    def test_youtube_forms_parse_and_bad_urls_are_refused(self):
        for url in (
            f"https://www.youtube.com/watch?v={YT}", f"https://youtu.be/{YT}", f"https://www.youtube.com/shorts/{YT}",
            f"https://www.youtube.com/embed/{YT}",
        ):
            self.assertEqual(media.parse_youtube(url), YT, url)
        for url in (
            f"https://evil.example/watch?v={YT}", f"javascript:alert('{YT}')", f"ftp://youtu.be/{YT}", "https://youtu.be/short",
            f"https://www.youtube.com.evil.example/watch?v={YT}", f"https://www.youtube.com/watch?v={YT}%0A", "", None, 12,
        ):
            with self.assertRaises(media.MediaError, msg=str(url)):
                media.parse_youtube(url)
        response = self.youtube(url=f"https://evil.example/watch?v={YT}")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ListingVideo.objects.exists())
        ok = self.youtube()
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(ok.json()["youtube_id"], YT)
        self.assertEqual(ListingVideo.objects.get().status, ListingVideo.READY)

    # ── staging and the public page ───────────────────────────────────────────────────────────────────────────────

    def test_public_serializer_shows_only_ready_uploads_and_youtube(self):
        ListingVideo.objects.create(listing=self.live, kind="upload", source="a.mp4", status=ListingVideo.PROCESSING)
        ListingVideo.objects.create(listing=self.live, kind="upload", source="b.mp4", status=ListingVideo.FAILED)
        ready = ListingVideo.objects.create(
            listing=self.live, kind="upload", source="c.mp4", web_file="listing_videos/web/c.mp4", status=ListingVideo.READY, position=1,
        )
        tube = ListingVideo.objects.create(listing=self.live, kind="youtube", youtube_id=YT, status=ListingVideo.READY, position=2)
        videos = self.public(self.live)["videos"]
        self.assertEqual([v["id"] for v in videos], [ready.pk, tube.pk])
        self.assertEqual(set(videos[0]), {"id", "kind", "url", "poster", "position"})
        self.assertEqual(set(videos[1]), {"id", "kind", "youtube_id", "poster", "position"})
        self.assertEqual(videos[1]["youtube_id"], YT)
        self.assertTrue(videos[0]["url"].endswith("c.mp4"))

    def test_review_focus_staged_media_is_not_public(self):
        before = self.public(self.live)
        self.assertEqual((before["photos"], before["videos"]), ([], []))
        self.assertEqual(self.add_photo(self.live).status_code, 201)
        self.assertEqual(self.youtube(self.live).status_code, 201)
        with fake_probe():
            self.assertEqual(self.upload_video(self.live).status_code, 201)
        after = self.public(self.live)
        self.assertEqual((after["photos"], after["videos"]), ([], []))
        # The owner sees them, flagged.
        owner = self.client.get(f"/api/listings/mine/{self.live.pk}/revision/").json()
        self.assertEqual(len(owner["diff"]["media"]["staged_photos"]), 1)
        self.assertEqual(len(owner["diff"]["media"]["staged_videos"]), 2)
        revision = ListingRevision.objects.get(listing=self.live)
        with self.assertRaises(revisions.RevisionError):  # R24: staff see every video, so it must be converted first
            revisions.submit(revision)
        self.convert_all()
        revisions.submit(revision)
        self.assertEqual(self.public(self.live)["photos"], [])
        self.assertEqual(self.public(self.live)["videos"], [])
        revisions.apply_revision(ListingRevision.objects.get(pk=revision.pk), StaffUser.objects.create(
            full_name="Checker", email="c@example.com", password_hash="x", role=Role.objects.get(name="operations")))
        live = self.public(self.live)
        self.assertEqual(len(live["photos"]), 1)
        self.assertEqual(sorted(v["kind"] for v in live["videos"]), ["upload", "youtube"])
        self.assertFalse(ListingPhoto.objects.filter(revision__isnull=False).exists())

    def test_staged_media_shows_flagged_in_the_owner_listing(self):
        self.add_photo(self.live)
        self.youtube(self.live)
        ListingPhoto.objects.create(listing=self.live, image=jpeg("live.jpg"), order=0)
        row = self.client.get("/api/listings/mine/").json()
        row = next(item for item in (row["results"] if isinstance(row, dict) else row) if item["id"] == self.live.pk)
        self.assertEqual(sorted(p["staged"] for p in row["photos"]), [False, True])
        self.assertEqual([v["staged"] for v in row["videos"]], [True])
        self.assertEqual(row["videos"][0]["status"], "ready")

    def test_removal_is_queued_until_approval(self):
        photo = ListingPhoto.objects.create(listing=self.live, image=jpeg("live.jpg"), order=0)
        tube = ListingVideo.objects.create(listing=self.live, kind="youtube", youtube_id=YT, status=ListingVideo.READY)
        self.assertEqual(self.client.delete(self.photos_url(self.live, photo)).status_code, 202)
        self.assertEqual(self.client.delete(self.videos_url(self.live, tube)).status_code, 202)
        self.assertTrue(ListingPhoto.objects.filter(pk=photo.pk).exists())
        self.assertTrue(ListingVideo.objects.filter(pk=tube.pk).exists())
        self.assertEqual(len(self.public(self.live)["photos"]), 1)
        revision = ListingRevision.objects.get(listing=self.live)
        self.assertEqual((revision.remove_photo_ids, revision.remove_video_ids), ([photo.pk], [tube.pk]))
        diff = revisions.diff(revision)
        self.assertEqual([r["id"] for r in diff["media"]["remove_videos"]], [tube.pk])
        revisions.submit(revision)
        staff = StaffUser.objects.create(full_name="Checker", email="c2@example.com", password_hash="x", role=Role.objects.get(name="operations"))
        revisions.apply_revision(ListingRevision.objects.get(pk=revision.pk), staff)
        self.assertFalse(ListingPhoto.objects.filter(pk=photo.pk).exists())
        self.assertFalse(ListingVideo.objects.filter(pk=tube.pk).exists())

    def test_deleting_a_staged_row_deletes_it_at_once(self):
        photo_id = self.add_photo(self.live).json()["id"]
        photo = ListingPhoto.objects.get(pk=photo_id)
        storage, name = photo.image.storage, photo.image.name
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.delete(self.photos_url(self.live, photo)).status_code, 204)
        self.assertFalse(ListingPhoto.objects.filter(pk=photo_id).exists())
        self.assertFalse(storage.exists(name))
        video_id = self.youtube(self.live).json()["id"]
        self.assertEqual(self.client.delete(self.videos_url(self.live, ListingVideo.objects.get(pk=video_id))).status_code, 204)
        self.assertFalse(ListingVideo.objects.exists())

    def test_discard_deletes_the_revision_and_staged_rows(self):
        photo = ListingPhoto.objects.get(pk=self.add_photo(self.live).json()["id"])
        with fake_probe():
            video = ListingVideo.objects.get(pk=self.upload_video(self.live).json()["id"])
        storage = photo.image.storage
        names = [photo.image.name, video.source.name]
        self.assertTrue(all(storage.exists(n) for n in names))
        revision = ListingRevision.objects.get(listing=self.live)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.delete(f"/api/listings/mine/{self.live.pk}/revision/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(ListingRevision.objects.filter(pk=revision.pk).exists())
        self.assertFalse(ListingPhoto.objects.exists() or ListingVideo.objects.exists())
        self.assertFalse(any(storage.exists(n) for n in names))

    def test_discontinuing_deletes_staged_media_files(self):
        photo = ListingPhoto.objects.get(pk=self.add_photo(self.live).json()["id"])
        storage, name = photo.image.storage, photo.image.name
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post(f"/api/listings/mine/{self.live.pk}/discontinue/").status_code, 200)
        self.assertFalse(ListingPhoto.objects.exists())
        self.assertFalse(storage.exists(name))

    def test_a_failed_staged_video_is_dropped_on_approval(self):
        revisions.save_draft(self.live, self.owner, {"changes": {"name": "Better"}})
        revision = ListingRevision.objects.get(listing=self.live)
        bad = ListingVideo.objects.create(listing=self.live, revision=revision, kind="upload", source="a.mp4", status=ListingVideo.FAILED)
        revisions.submit(revision)
        staff = StaffUser.objects.create(full_name="Checker", email="c3@example.com", password_hash="x", role=Role.objects.get(name="operations"))
        revisions.apply_revision(ListingRevision.objects.get(pk=revision.pk), staff)
        self.assertFalse(ListingVideo.objects.filter(pk=bad.pk).exists())

    def test_media_alone_is_a_sendable_revision(self):
        self.add_photo(self.live)
        response = self.client.post(f"/api/listings/mine/{self.live.pk}/revision/submit/")
        self.assertEqual(response.status_code, 200, response.content)

    def test_conversion_is_queued_after_commit(self):
        with fake_probe(), mock.patch.object(tasks.convert_listing_video, "delay") as delay:
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                self.upload_video()
            delay.assert_not_called()
            for callback in callbacks:
                callback()
        delay.assert_called_once_with(ListingVideo.objects.get().pk)

    # ── isolation ────────────────────────────────────────────────────────────────────────────────────────────────

    def test_owner_cannot_delete_another_owners_media(self):
        photo = ListingPhoto.objects.create(listing=self.draft, image=jpeg("mine.jpg"), order=0)
        tube = ListingVideo.objects.create(listing=self.draft, kind="youtube", youtube_id=YT, status=ListingVideo.READY)
        self.auth(self.other)
        self.assertEqual(self.client.delete(self.photos_url(self.draft, photo)).status_code, 404)
        self.assertEqual(self.client.delete(self.videos_url(self.draft, tube)).status_code, 404)
        self.assertEqual(self.add_photo(self.draft).status_code, 404)
        self.assertEqual(self.youtube(self.draft).status_code, 404)
        # Nor through their own listing's URL with someone else's row id.
        mine = self.listing(Listing.DRAFT, owner=self.other)
        self.assertEqual(self.client.delete(self.photos_url(mine, photo)).status_code, 404)
        self.assertEqual(self.client.delete(self.videos_url(mine, tube)).status_code, 404)
        self.assertTrue(ListingPhoto.objects.filter(pk=photo.pk).exists() and ListingVideo.objects.filter(pk=tube.pk).exists())

    def test_anonymous_and_customers_cannot_add_media(self):
        self.client.credentials()
        self.assertIn(self.add_photo().status_code, (401, 403))

    # ── fix round 1 ──────────────────────────────────────────────────────────────────────────────────────────────

    def test_unqueuing_a_removal_cannot_push_a_listing_past_nine_images(self):
        rows = [ListingPhoto.objects.create(listing=self.live, image=jpeg(f"l{n}.jpg"), order=n) for n in range(9)]
        self.assertEqual(self.client.delete(self.photos_url(self.live, rows[0])).status_code, 202)
        self.assertEqual(self.add_photo(self.live).status_code, 201)
        url = f"/api/listings/mine/{self.live.pk}/revision/"
        response = self.client.put(url, {"remove_photo_ids": []}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("9", str(response.json()))
        self.assertEqual(ListingRevision.objects.get(listing=self.live).remove_photo_ids, [rows[0].pk])

    def test_unqueuing_a_removal_cannot_push_a_listing_past_two_videos(self):
        first = ListingVideo.objects.create(listing=self.live, kind="youtube", youtube_id=YT, status="ready")
        ListingVideo.objects.create(listing=self.live, kind="youtube", youtube_id="abcdefghijk", status="ready", position=1)
        self.assertEqual(self.client.delete(self.videos_url(self.live, first)).status_code, 202)
        self.assertEqual(self.youtube(self.live).status_code, 201)
        response = self.client.put(f"/api/listings/mine/{self.live.pk}/revision/", {"remove_video_ids": []}, format="json")
        self.assertEqual(response.status_code, 400, response.content)

    def test_apply_revision_backstops_the_limits(self):
        revisions.save_draft(self.live, self.owner, {"changes": {"name": "Better"}})
        revision = ListingRevision.objects.get(listing=self.live)
        for n in range(10):
            ListingPhoto.objects.create(listing=self.live, revision=revision, image=jpeg(f"s{n}.jpg"), order=n)
        revisions.submit(revision)
        staff = StaffUser.objects.create(full_name="Checker", email="c4@example.com", password_hash="x", role=Role.objects.get(name="operations"))
        with self.assertRaises(revisions.RevisionError):
            revisions.apply_revision(ListingRevision.objects.get(pk=revision.pk), staff)
        self.assertEqual(ListingRevision.objects.get(pk=revision.pk).status, ListingRevision.PENDING)

    def test_a_main_photo_cannot_make_a_tenth_image(self):
        for n in range(9):
            ListingPhoto.objects.create(listing=self.draft, image=jpeg(f"d{n}.jpg"), order=n)
            ListingPhoto.objects.create(listing=self.live, image=jpeg(f"p{n}.jpg"), order=n)
        response = self.client.patch(f"/api/listings/mine/{self.draft.pk}/", {"main_photo": jpeg("main.jpg")}, format="multipart")
        self.assertEqual(response.status_code, 400, response.content)
        self.draft.refresh_from_db()
        self.assertFalse(self.draft.main_photo)
        response = self.client.put(f"/api/listings/mine/{self.live.pk}/revision/", {"new_main_photo": jpeg("new.jpg")}, format="multipart")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(ListingRevision.objects.filter(listing=self.live).exclude(new_main_photo="").exists())

    def test_a_main_photo_over_five_megabytes_is_refused(self):
        response = self.client.patch(
            f"/api/listings/mine/{self.draft.pk}/", {"main_photo": jpeg("big.jpg", FIVE_MB + 1)}, format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.content)
        response = self.client.put(
            f"/api/listings/mine/{self.live.pk}/revision/", {"new_main_photo": jpeg("big.jpg", FIVE_MB + 1)}, format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.content)
        ok = self.client.put(
            f"/api/listings/mine/{self.live.pk}/revision/", {"new_main_photo": jpeg("ok.jpg", FIVE_MB)}, format="multipart",
        )
        self.assertEqual(ok.status_code, 200, ok.content)

    def test_staff_can_watch_every_video_before_it_goes_public(self):
        from listings.serializers import ModerationListingSerializer

        ready = ListingVideo.objects.create(
            listing=self.draft, kind="upload", web_file="listing_videos/web/z.mp4", status=ListingVideo.READY,
        )
        seen = ModerationListingSerializer(self.draft).data["videos"]
        self.assertEqual([(v["id"], v["status"]) for v in seen], [(ready.pk, "ready")])
        self.assertTrue(seen[0]["url"].endswith("z.mp4"))
        revisions.save_draft(self.live, self.owner, {"changes": {"name": "Better"}})
        revision = ListingRevision.objects.get(listing=self.live)
        ListingVideo.objects.create(
            listing=self.live, revision=revision, kind="upload", web_file="listing_videos/web/y.mp4", status=ListingVideo.READY,
        )
        ListingVideo.objects.create(listing=self.live, revision=revision, kind="upload", source="q.mp4", status=ListingVideo.CONVERTING)
        lines = revisions.diff(revision)["media"]["staged_videos"]
        self.assertTrue(lines[0]["url"].endswith("y.mp4"))
        self.assertEqual((lines[1]["status"], lines[1]["url"]), ("processing", None))

    def test_submit_is_refused_while_an_upload_is_converting(self):
        ListingVideo.objects.create(listing=self.draft, kind="upload", source="a.mp4", status=ListingVideo.PROCESSING)
        response = self.client.post(f"/api/listings/mine/{self.draft.pk}/submit/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Wait for your video to finish converting, then send it.")
        ListingVideo.objects.update(status=ListingVideo.READY)
        self.assertEqual(self.client.post(f"/api/listings/mine/{self.draft.pk}/submit/").status_code, 200)
        revisions.save_draft(self.live, self.owner, {"changes": {"name": "Better"}})
        revision = ListingRevision.objects.get(listing=self.live)
        ListingVideo.objects.create(listing=self.live, revision=revision, kind="upload", source="b.mp4", status=ListingVideo.CONVERTING)
        response = self.client.post(f"/api/listings/mine/{self.live.pk}/revision/submit/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Wait for your video", response.json()["detail"])

    def test_removing_a_video_the_public_never_saw_deletes_it_at_once(self):
        stuck = ListingVideo.objects.create(listing=self.live, kind="upload", source="a.mp4", status=ListingVideo.FAILED)
        self.assertEqual(self.client.delete(self.videos_url(self.live, stuck)).status_code, 204)
        self.assertFalse(ListingVideo.objects.exists())
        self.assertFalse(ListingRevision.objects.filter(listing=self.live).exists())

    def test_a_broker_that_is_down_fails_the_row_instead_of_the_request(self):
        with fake_probe(), mock.patch.object(tasks.convert_listing_video, "delay", side_effect=OSError("broker")):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.upload_video()
        self.assertEqual(response.status_code, 201)
        video = ListingVideo.objects.get()
        self.assertEqual(video.status, ListingVideo.FAILED)
        self.assertFalse(video.source)

    def test_a_conversion_longer_than_the_limit_fails(self):
        with fake_probe():
            self.upload_video()
        video = ListingVideo.objects.get()
        convert, poster = fake_ffmpeg()
        with fake_probe(75.0), convert, poster:
            tasks.convert_listing_video(video.pk)
        video.refresh_from_db()
        self.assertEqual(video.status, ListingVideo.FAILED)
        self.assertFalse(video.web_file)

    def test_a_poster_failure_leaves_no_web_file_behind(self):
        with fake_probe():
            self.upload_video()
        video = ListingVideo.objects.get()
        storage = video.source.storage
        convert, _ = fake_ffmpeg()
        with fake_probe(5.0), convert, mock.patch.object(core_video, "poster_frame", side_effect=core_video.VideoError()):
            tasks.convert_listing_video(video.pk)
        video.refresh_from_db()
        self.assertEqual(video.status, ListingVideo.FAILED)
        self.assertFalse(storage.exists(f"listing_videos/web/{video.pk}.mp4"))

    def test_approved_photo_removals_delete_their_files(self):
        photo = ListingPhoto.objects.create(listing=self.live, image=jpeg("gone.jpg"), order=0)
        storage, name = photo.image.storage, photo.image.name
        self.client.delete(self.photos_url(self.live, photo))
        revision = ListingRevision.objects.get(listing=self.live)
        revisions.submit(revision)
        staff = StaffUser.objects.create(full_name="Checker", email="c5@example.com", password_hash="x", role=Role.objects.get(name="operations"))
        with self.captureOnCommitCallbacks(execute=True):
            revisions.apply_revision(ListingRevision.objects.get(pk=revision.pk), staff)
        self.assertFalse(storage.exists(name))

    def test_the_owner_listing_list_prefetches_media(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        def queries():
            with CaptureQueriesContext(connection) as context:
                self.assertEqual(self.client.get("/api/listings/mine/").status_code, 200)
            return len(context)

        def more(count):
            for n in range(count):
                listing = self.listing(Listing.PUBLISHED)
                ListingPhoto.objects.create(listing=listing, image=jpeg(f"n{n}.jpg"), order=0)
                ListingVideo.objects.create(listing=listing, kind="youtube", youtube_id=YT, status="ready")

        more(2)
        before = queries()
        more(3)
        self.assertEqual(queries(), before)  # no query per listing

    def test_ffmpeg_and_ffprobe_get_safe_argument_lists(self):
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return mock.Mock(returncode=0, stdout=b'{"streams":[{"codec_type":"video","width":10,"height":10}],"format":{"duration":"3","size":"9"}}', stderr=b"")

        with mock.patch("subprocess.run", side_effect=fake_run), mock.patch("os.path.exists", return_value=True), mock.patch("os.path.getsize", return_value=5):
            core_video.probe("/tmp/in.mp4")
            core_video.convert_to_web_mp4("/tmp/in.mp4", "/tmp/out.mp4")
            core_video.poster_frame("/tmp/out.mp4", "/tmp/p.jpg")
        probe_args, convert_args, poster_args = (c[0] for c in calls)
        for args, kwargs in calls:
            self.assertIsInstance(args, list)
            self.assertFalse(kwargs.get("shell"))
            self.assertTrue(kwargs.get("timeout"))
            self.assertEqual(args[args.index("-protocol_whitelist") + 1], "file")
        self.assertEqual((probe_args[0], convert_args[0], poster_args[0]), ("ffprobe", "ffmpeg", "ffmpeg"))
        self.assertEqual(convert_args[convert_args.index("-movflags") + 1], "+faststart")
        self.assertEqual(convert_args[convert_args.index("-c:v") + 1], "libx264")
        self.assertEqual(convert_args[convert_args.index("-c:a") + 1], "aac")
        self.assertEqual(convert_args[convert_args.index("-t") + 1], "60")
        self.assertEqual(convert_args[convert_args.index("-map_metadata") + 1], "-1")
        self.assertIn("-sn", convert_args)
        self.assertIn("-dn", convert_args)
        scale = convert_args[convert_args.index("-vf") + 1]
        self.assertIn("1280,720", scale)  # landscape box
        self.assertIn("720,1280", scale)  # portrait box
        self.assertIn("min(", scale)  # never upscaled
        self.assertIn("force_divisible_by=2", scale)

    def test_a_poster_for_a_clip_under_a_second_falls_back_to_the_first_frame(self):
        seconds = []

        def fake_frame(src, dst, second):
            seconds.append(second)
            return second == 0

        with mock.patch.object(core_video, "_frame_at", side_effect=fake_frame):
            core_video.poster_frame("/tmp/a.mp4", "/tmp/a.jpg")
        self.assertEqual(seconds, [1, 0])

    def test_the_web_vhost_templates_allow_a_hundred_megabyte_video(self):
        import pathlib

        base = pathlib.Path(__file__).resolve().parents[3] / "infra" / "hestia" / "templates"
        if not base.exists():  # the container only mounts backend/
            self.skipTest("infra/ is not mounted")
        for name in ("ashantihub-api.tpl.in", "ashantihub-api.stpl.in"):
            text = (base / name).read_text()
            self.assertIn("client_max_body_size 110m;", text)
            self.assertNotIn("^~ /.well-known", text)
