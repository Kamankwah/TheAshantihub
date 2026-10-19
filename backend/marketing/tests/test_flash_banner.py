"""Flash banner (plan M1 Task 7): Marketing publishes it directly, no Super Admin approval."""
from datetime import timedelta

from django.utils import timezone

from accounts.testing import make_staff
from approvals.models import ApprovalRequest
from marketing.models_banners import Banner

from .base import MarketingBase
from .test_banners import BannerBase, form


class FlashBannerTests(BannerBase):
    def flash(self, **over):
        now = timezone.now()
        data = {"slot": "flash", "title": "Opening soon", "message": "Flash sale ends soon", "link_path": "/deals", "image": None,
                "starts_at": (now - timedelta(minutes=5)).isoformat(), "ends_at": (now + timedelta(days=2)).isoformat(),
                "countdown_ends_at": (now + timedelta(hours=6)).isoformat()}
        data.update(over)
        self.as_staff(self.akua)
        return self.client.post("/api/marketing/site-banners/", form(**data), format="multipart")

    def test_marketing_publishes_flash_banner_without_approval(self):
        r = self.flash()
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["state"], "draft")
        pk = r.json()["id"]
        r = self.client.post(f"/api/marketing/site-banners/{pk}/publish/")
        self.assertEqual(r.status_code, 200, r.content)
        banner = Banner.objects.get(pk=pk)
        self.assertEqual((banner.state, banner.approved_by), ("approved", self.akua))
        self.assertIsNone(banner.approval)
        self.assertFalse(ApprovalRequest.objects.filter(kind="marketing.banner").exists())

    def test_other_slots_still_need_super_admin_approval(self):
        self.as_staff(self.akua)
        pk = self.create_via_api(starts_at=(timezone.now() - timedelta(minutes=5)).isoformat()).json()["id"]
        self.assertGreaterEqual(self.client.post(f"/api/marketing/site-banners/{pk}/publish/").status_code, 400)
        self.assertEqual(Banner.objects.get(pk=pk).state, "draft")
        self.assertEqual(self.client.post(f"/api/marketing/site-banners/{pk}/submit/").json()["state"], "waiting")
        self.assertTrue(ApprovalRequest.objects.filter(kind="marketing.banner").exists())

    def test_flash_countdown_ends_at_exposed_publicly_only_while_live(self):
        pk = self.flash().json()["id"]
        self.client.credentials()
        self.assertEqual(self.client.get("/api/marketing/banners/?slot=flash").json()["banners"], [])
        self.as_staff(self.akua)
        self.client.post(f"/api/marketing/site-banners/{pk}/publish/")
        self.client.credentials()
        rows = self.client.get("/api/marketing/banners/?slot=flash").json()["banners"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["message"], "Flash sale ends soon")
        self.assertTrue(rows[0]["countdown_ends_at"])
        Banner.objects.filter(pk=pk).update(ends_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.client.get("/api/marketing/banners/?slot=flash").json()["banners"], [])
        # other slots never expose the flash-only fields
        self.make(slot="home_strip")
        row = self.client.get("/api/marketing/banners/?slot=home_strip").json()["banners"][0]
        self.assertNotIn("countdown_ends_at", row)

    def test_non_marketing_cannot_publish_flash(self):
        pk = self.flash().json()["id"]
        for staff in (self.scout, self.accountant):
            self.as_staff(staff)
            self.assertEqual(self.client.post(f"/api/marketing/site-banners/{pk}/publish/").status_code, 403)
        self.assertEqual(Banner.objects.get(pk=pk).state, "draft")

    def test_flash_needs_a_message_and_countdown_after_start(self):
        self.assertEqual(self.flash(message=None).status_code, 400)
        self.assertEqual(self.flash(message="Call 0244 123 456").status_code, 400)
        bad = self.flash(countdown_ends_at=(timezone.now() - timedelta(days=1)).isoformat())
        self.assertEqual(bad.status_code, 400)

    def test_flash_countdown_is_optional(self):
        self.assertEqual(self.flash(countdown_ends_at=None).status_code, 201)
