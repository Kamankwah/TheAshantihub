"""Review finding BE-01: identity documents are private, served only by a fresh signed link, and the move is safe."""
import io
import tempfile
from pathlib import Path
from unittest import mock

from django.core.files.base import ContentFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from core import private_files

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\x9f\xcb\x00\x00\x00\x00IEND\xaeB`\x82"
)


class PrivateIdentityFileTests(TestCase):
    def setUp(self):
        self.private = tempfile.TemporaryDirectory()
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.private.cleanup)
        self.addCleanup(self.media.cleanup)
        patcher = override_settings(PRIVATE_MEDIA_ROOT=self.private.name, MEDIA_ROOT=self.media.name)
        patcher.enable()
        self.addCleanup(patcher.disable)
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233241112222", email="k@example.com")
        self.profile = BusinessOwnerProfile.objects.create(business_owner=self.owner)
        self.client = APIClient()

    def upload(self):
        self.profile.ghana_card_front_image.save("My Card.PNG", ContentFile(PNG), save=True)
        return self.profile.ghana_card_front_image

    def test_upload_lands_in_private_storage_with_a_random_name(self):
        field = self.upload()
        self.assertTrue(Path(self.private.name, "kyc", field.name).is_file())
        self.assertFalse(any(Path(self.media.name).rglob("*.png")))
        self.assertRegex(field.name, r"^ghana_cards/[0-9a-f]{32}\.png$")
        self.assertNotIn("my", field.name.split("/")[-1])  # the client's file name is gone

    def test_url_is_a_signed_link_that_serves_the_file_with_no_login(self):
        field = self.upload()
        response = self.client.get(field.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(b"".join(response.streaming_content), PNG)

    def test_expired_forged_or_missing_links_are_all_the_same_404(self):
        field = self.upload()
        token = field.url.split("t=")[1]
        with mock.patch.object(private_files, "LINK_SECONDS", -1):
            self.assertEqual(self.client.get(f"/api/core/private-file/?t={token}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/core/private-file/?t={token}x").status_code, 404)
        self.assertEqual(self.client.get("/api/core/private-file/").status_code, 404)

    def test_a_token_naming_another_area_or_a_path_escape_is_refused(self):
        from django.core import signing
        for payload in ({"a": "media", "n": "x.png"}, {"a": "kyc", "n": "../../etc/passwd"}, {"a": "kyc", "n": "/etc/passwd"}):
            token = signing.dumps(payload, salt=private_files.SALT, compress=False)
            self.assertEqual(self.client.get(f"/api/core/private-file/?t={token}").status_code, 404, payload)

    def test_the_public_media_url_pattern_is_gone(self):
        field = self.upload()
        self.assertNotIn("/media/", field.url)

    def test_move_command_moves_referenced_and_orphan_files_and_is_repeatable(self):
        media_cards = Path(self.media.name, "ghana_cards")
        media_cards.mkdir(parents=True)
        (media_cards / "old-card.png").write_bytes(PNG)
        (media_cards / "orphan.png").write_bytes(PNG)
        BusinessOwnerProfile.objects.filter(pk=self.profile.pk).update(ghana_card_front_image="ghana_cards/old-card.png")
        out = io.StringIO()
        call_command("move_identity_files_private", stdout=out)
        self.assertIn("moved=2", out.getvalue())
        self.assertFalse(any(media_cards.iterdir()))
        self.assertTrue(Path(self.private.name, "kyc", "ghana_cards", "old-card.png").is_file())
        self.profile.refresh_from_db()
        self.assertEqual(self.client.get(self.profile.ghana_card_front_image.url).status_code, 200)
        again = io.StringIO()
        call_command("move_identity_files_private", "--check", stdout=again)  # nothing left: exits cleanly
        self.assertIn("public_left=0", again.getvalue())

    def test_check_flag_fails_while_a_file_is_still_public(self):
        media_cards = Path(self.media.name, "ghana_cards")
        media_cards.mkdir(parents=True)
        (media_cards / "leftover.png").write_bytes(PNG)
        with self.assertRaises(SystemExit):
            call_command("move_identity_files_private", "--check", stdout=io.StringIO())
        self.assertTrue((media_cards / "leftover.png").exists())  # --check never changes anything

    def test_move_never_overwrites_a_private_file(self):
        media_cards = Path(self.media.name, "ghana_cards")
        media_cards.mkdir(parents=True)
        (media_cards / "same.png").write_bytes(b"public copy")
        private_card = Path(self.private.name, "kyc", "ghana_cards", "same.png")
        private_card.parent.mkdir(parents=True)
        private_card.write_bytes(b"private original")
        call_command("move_identity_files_private", stdout=io.StringIO(), stderr=io.StringIO())
        self.assertEqual(private_card.read_bytes(), b"private original")
        self.assertTrue((media_cards / "same.png").exists())

    def test_replaced_identity_files_are_deleted_from_private_storage(self):
        from accounts import files
        field = self.upload()
        path = Path(self.private.name, "kyc", field.name)
        self.assertTrue(path.is_file())
        files.delete_files([field.name])
        self.assertFalse(path.exists())
