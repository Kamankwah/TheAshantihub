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


def jpeg(name="p.jpg", size=None):
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "orange").save(buf, format="JPEG")
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
