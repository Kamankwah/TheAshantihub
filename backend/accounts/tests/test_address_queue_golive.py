"""The address-verification queue is the scout queue (self-serve phase 2, Task 5): a business that went live on its own
(confirmed email, shop pin, business type, accepted terms) has no KYC decision and no staff-checked address, and it must
still sit in the pending tab for staff to visit. A KYC-rejected business never appears."""
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import email_confirmation, golive, location_tier
from accounts.claims import hash_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, EmailConfirmationToken
from accounts.testing import make_staff, staff_token
from otp.models import EMAIL, VerifiedContact

QUEUE = "/api/accounts/address-verification/"


class AddressQueueGoLiveTests(TestCase):
    _n = 0

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.ops = make_staff("operations", "ops@example.com")

    def live_owner(self, *, kyc_status=BusinessOwner.PENDING, confirm="contact", **profile_fields):
        """A self-registered business that satisfies every go-live rule. `confirm` is how the email was confirmed."""
        type(self)._n += 1
        n = self._n
        owner = BusinessOwner.objects.create(
            full_name=f"Live Owner {n}", login_phone=f"+23324430{n:04d}", password_hash="x", email=f"live{n}@example.com",
            registration_channel=BusinessOwner.SELF, kyc_status=kyc_status,
        )
        fields = dict(
            business_name=f"Live Shop {n}", business_kind="product", terms_accepted_at=timezone.now(),
            lat=Decimal("6.690000"), lng=Decimal("-1.620000"), location_accuracy_m=15, location_set_by="owner",
            location_set_at=timezone.now(), location_is_manual=False,
        )
        fields.update(profile_fields)
        profile = BusinessOwnerProfile.objects.create(business_owner=owner, **fields)
        if confirm == "contact":
            VerifiedContact.objects.create(
                account_type="business_owner", account_id=owner.pk, channel=EMAIL, destination=owner.email.lower(),
            )
        elif confirm == "link":
            EmailConfirmationToken.objects.create(
                business_owner=owner, email=owner.email.lower(), token_hash=hash_token(f"raw-{n}"),
                expires_at=timezone.now() + timedelta(hours=1),
            )
            email_confirmation.confirm(f"raw-{n}")
        return owner, profile

    def queue(self, query=""):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.ops)}")
        response = self.client.get(f"{QUEUE}{query}")
        self.assertEqual(response.status_code, 200)
        return [row["id"] for row in response.json()["results"]]

    def test_a_live_unvisited_business_with_pending_kyc_is_in_the_default_queue(self):
        owner, profile = self.live_owner()
        self.assertTrue(golive.is_live(owner))
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)
        self.assertEqual(location_tier.tier(profile), location_tier.LOCATED)
        self.assertIsNone(profile.address_verified_at)
        self.assertIn(owner.pk, self.queue())

    def test_it_is_listed_whether_the_email_was_confirmed_by_link_or_by_contact_row(self):
        by_link, _ = self.live_owner(confirm="link")
        by_row, _ = self.live_owner(confirm="contact")
        self.assertTrue(golive.is_live(by_link))
        self.assertTrue(golive.is_live(by_row))
        ids = self.queue()
        self.assertIn(by_link.pk, ids)
        self.assertIn(by_row.pk, ids)

    def test_the_default_tab_is_the_pending_tab(self):
        owner, _ = self.live_owner()
        self.assertIn(owner.pk, self.queue("?status=pending"))
        self.assertIn(owner.pk, self.queue("?status=nonsense"))  # an unknown value means pending
        self.assertNotIn(owner.pk, self.queue("?status=verified"))
        self.assertNotIn(owner.pk, self.queue("?status=wrong"))

    def test_a_kyc_rejected_business_is_not_listed_even_though_it_is_located(self):
        rejected, profile = self.live_owner(kyc_status=BusinessOwner.REJECTED)
        self.assertEqual(location_tier.tier(profile), location_tier.LOCATED)
        self.assertIsNone(profile.address_verified_at)
        kept, _ = self.live_owner()
        for tab in ("", "?status=pending", "?status=verified", "?status=wrong"):
            self.assertNotIn(rejected.pk, self.queue(tab), tab)
        self.assertIn(kept.pk, self.queue())

    def test_a_business_whose_address_is_decided_leaves_the_pending_tab(self):
        owner, _ = self.live_owner()
        self.assertIn(owner.pk, self.queue())
        BusinessOwnerProfile.objects.filter(business_owner=owner).update(
            address_verified=False, address_verified_by=self.ops, address_verified_at=timezone.now(),
        )
        self.assertNotIn(owner.pk, self.queue())
        self.assertIn(owner.pk, self.queue("?status=wrong"))
