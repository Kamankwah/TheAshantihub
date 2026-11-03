import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from listings.models import Category, Zone

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def jpeg(name="p.jpg", size=None, dims=(4, 4)):
    buf = io.BytesIO()
    Image.new("RGB", dims, "orange").save(buf, format="JPEG")
    data = buf.getvalue()
    if size:
        data += b"\0" * (size - len(data))
    return SimpleUploadedFile(name, data, content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class CategoryZoneImageTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.category = Category.objects.get(slug="books")
        self.zone = Zone.objects.get(name="Manhyia")

    def as_staff(self, role_name):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person", email=f"{role_name}-img@example.com", password_hash="x", role=Role.objects.get(name=role_name),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def cat_url(self):
        return f"/api/listings/categories/{self.category.pk}/image/"

    def zone_url(self):
        return f"/api/listings/zones/{self.zone.pk}/image/"

    def test_marketing_operations_and_super_admin_can_set_a_category_picture(self):
        for role in ("marketing", "operations", "super_admin"):
            self.as_staff(role)
            response = self.client.post(self.cat_url(), {"image": jpeg()}, format="multipart")
            self.assertEqual(response.status_code, 200, (role, response.content))
            self.assertTrue(response.json()["image"].startswith("http"), role)
            StaffUser.objects.filter(email=f"{role}-img@example.com").delete()
        self.category.refresh_from_db()
        self.assertTrue(self.category.image)

    def test_operations_can_now_edit_categories(self):
        self.as_staff("operations")
        response = self.client.patch(f"/api/listings/categories/{self.category.pk}/", {"label": "Reading"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_zone_picture_set_and_cleared_by_zone_managers(self):
        self.as_staff("operations")
        response = self.client.post(self.zone_url(), {"image": jpeg()}, format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(Zone.objects.get(pk=self.zone.pk).image)
        response = self.client.delete(self.zone_url())
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["image"])
        self.assertFalse(Zone.objects.get(pk=self.zone.pk).image)

    def test_replacing_a_picture_removes_the_old_file(self):
        self.as_staff("marketing")
        self.client.post(self.cat_url(), {"image": jpeg("one.jpg")}, format="multipart")
        self.category.refresh_from_db()
        first = self.category.image.name
        self.assertTrue(self.category.image.storage.exists(first))
        self.client.post(self.cat_url(), {"image": jpeg("two.jpg")}, format="multipart")
        self.category.refresh_from_db()
        self.assertNotEqual(self.category.image.name, first)
        self.assertFalse(self.category.image.storage.exists(first))

    def test_other_roles_and_the_public_cannot_change_a_picture(self):
        self.assertEqual(self.client.post(self.cat_url(), {"image": jpeg()}, format="multipart").status_code, 401)
        self.as_staff("support")
        self.assertEqual(self.client.post(self.cat_url(), {"image": jpeg()}, format="multipart").status_code, 403)
        self.assertEqual(self.client.delete(self.zone_url()).status_code, 403)

    def test_rejects_non_images_and_oversized_files(self):
        self.as_staff("marketing")
        fake = SimpleUploadedFile("x.jpg", b"not an image" * 30, content_type="image/jpeg")
        self.assertEqual(self.client.post(self.cat_url(), {"image": fake}, format="multipart").status_code, 400)
        big = jpeg(size=5 * 1024 * 1024 + 10)
        self.assertEqual(self.client.post(self.cat_url(), {"image": big}, format="multipart").status_code, 400)
        self.assertEqual(self.client.post(self.cat_url(), {}, format="multipart").status_code, 400)
        self.category.refresh_from_db()
        self.assertFalse(self.category.image)

    def test_picture_reaches_the_public_tree_and_lists(self):
        self.as_staff("marketing")
        self.client.post(self.cat_url(), {"image": jpeg()}, format="multipart")
        self.client.credentials()
        tree = self.client.get("/api/listings/categories/tree/?full=0")
        self.assertEqual(tree.status_code, 200)
        flat = []
        stack = list(tree.json())
        while stack:
            node = stack.pop()
            flat.append(node)
            stack.extend(node["children"])
        self.assertTrue(all("image" in n for n in flat))
        cats = {c["slug"]: c for c in self.client.get("/api/listings/categories/").json()}
        self.assertTrue(cats["books"]["image"])
        self.assertIsNone(cats["electronics"]["image"])
        self.assertIn("image", self.client.get("/api/listings/zones/").json()[0])


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class PictureVariantTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        staff = StaffUser.objects.create(full_name="M", email="m-var@example.com", password_hash="x", role=Role.objects.get(name="marketing"))
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        self.category = Category.objects.get(slug="books")
        self.url = f"/api/listings/categories/{self.category.pk}/image/"

    def upload(self, **kw):
        return self.client.post(self.url, {"image": jpeg(**kw)}, format="multipart")

    def test_upload_makes_resized_webp_copies_the_home_can_use(self):
        body = self.upload(dims=(2000, 1000)).json()
        variants = body["image_variants"]
        self.assertEqual(set(variants), {"thumb", "medium", "large"})
        self.assertTrue(all(url.endswith(".webp") for url in variants.values()))
        self.category.refresh_from_db()
        storage = self.category.image.storage
        self.assertTrue(storage.exists(self.category.image_variants["thumb"]))
        with storage.open(self.category.image_variants["thumb"]) as f:
            self.assertEqual(max(Image.open(f).size), 320)

    def test_a_small_picture_falls_back_to_the_original_for_every_size(self):
        body = self.upload().json()
        self.assertEqual(set(body["image_variants"].values()), {body["image"]})

    def test_replacing_and_clearing_remove_the_old_copies(self):
        self.upload(dims=(2000, 1000))
        self.category.refresh_from_db()
        first = {k: v for k, v in self.category.image_variants.items() if k != "src"}
        storage = self.category.image.storage
        self.upload(dims=(1500, 900))
        self.assertFalse(any(storage.exists(path) for path in first.values()))
        self.category.refresh_from_db()
        second = {k: v for k, v in self.category.image_variants.items() if k != "src"}
        self.assertTrue(second and all(storage.exists(path) for path in second.values()))
        response = self.client.delete(self.url)
        self.assertIsNone(response.json()["image_variants"])
        self.assertFalse(any(storage.exists(path) for path in second.values()))
        self.category.refresh_from_db()
        self.assertEqual(self.category.image_variants, {})

    def test_variants_reach_the_public_tree_and_home_feed_and_never_for_a_missing_picture(self):
        self.upload(dims=(2000, 1000))
        self.client.credentials()
        cats = {c["slug"]: c for c in self.client.get("/api/listings/categories/").json()}
        self.assertEqual(set(cats["books"]["image_variants"]), {"thumb", "medium", "large"})
        self.assertIsNone(cats["electronics"]["image_variants"])

    def test_backfill_makes_copies_for_pictures_uploaded_before_variants_existed(self):
        from django.core.management import call_command

        self.upload(dims=(2000, 1000))
        Category.objects.filter(pk=self.category.pk).update(image_variants={})
        call_command("backfill_image_variants", verbosity=0)
        self.category.refresh_from_db()
        self.assertIn("thumb", self.category.image_variants)
