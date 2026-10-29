"""Guard: no staff-facing response carries the owner-confirmation link (plan M3, Task 12).

Stages a registration confirmation and drafts (one confirmed and submitted for approval, one waiting on the owner), then
walks every portfolio, field, listings, events, marketplace, approvals, activity and task endpoint a staff member can
reach for that business, draft and approval, as each staff role, and asserts no response body holds a raw token, its
hash, or a `token=` / `#token=` URL. Staff see the masked number, the dates and the state, never the link."""
import re

from django.core.cache import cache

from approvals.models import ApprovalRequest
from otp import senders
from portfolio import confirmations
from portfolio.models import ListingDraft, OwnerConfirmation
from portfolio.tests.test_staff_drafts import TOKEN, DraftBase
from field.models import Prospect

LEAK_PATTERN = re.compile(r"#?\??&?token=", re.I)


def text_of(response):
    if getattr(response, "streaming", False):
        return b"".join(response.streaming_content).decode(errors="replace")
    return response.content.decode(errors="replace")


class NoLinkLeakTests(DraftBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.ops = self.lead
        self.prospect = Prospect.objects.create(scout=self.scout, name="Akosua's Kitchen", phone=self.owner.login_phone)

    def stage(self):
        """Returns every raw token that was ever texted for the owner."""
        raws = []
        self.as_staff(self.scout)
        first = self.make_draft()
        self.send([first])
        raws.append(self.raw())
        confirmations.confirm(raws[-1])  # first draft goes to approval
        first.refresh_from_db()
        second = self.make_draft(name="Second item")
        self.send([second])
        raws.append(self.raw())
        third = self.make_draft(name="Third item")
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(self.owner, self.scout, drafts=[third], registration=True)
        raws.append(TOKEN.search(senders.sms_outbox[-1].body).group(1))
        return raws, first, second

    def urls(self, first, second):
        owner, approval = self.owner.pk, first.approval_id
        draft_base = f"/api/portfolio/businesses/{owner}/drafts/"
        urls = [
            "/api/portfolio/businesses/", "/api/portfolio/businesses/counts/", "/api/portfolio/businesses/export/",
            f"/api/portfolio/businesses/{owner}/", f"/api/portfolio/businesses/{owner}/oversight/",
            f"/api/portfolio/businesses/{owner}/orders/", f"/api/portfolio/businesses/{owner}/hours/",
            f"/api/portfolio/businesses/{owner}/review/", f"/api/portfolio/businesses/{owner}/reveal-phone/",
            draft_base, f"{draft_base}{first.pk}/", f"{draft_base}{second.pk}/",
            "/api/portfolio/leaderboard/", "/api/portfolio/subscriptions-due/", "/api/portfolio/detail-changes/",
            "/api/portfolio/detail-changes/mine/", "/api/portfolio/owner/changes/", "/api/portfolio/meta/listing-form/",
            "/api/field/prospects/", f"/api/field/prospects/{self.prospect.pk}/", "/api/field/visits/",
            "/api/field/visits/team/", "/api/field/visit-targets/",
            "/api/approvals/", "/api/approvals/counts/", "/api/approvals/stats/", "/api/approvals/rules/",
            f"/api/approvals/{approval}/",
            "/api/listings/moderation/pending/", "/api/listings/moderation/stats/",
            "/api/events/moderation/pending/",
            "/api/marketplace/listings/", "/api/marketplace/listings/counts/", "/api/marketplace/listings/export/",
            "/api/marketplace/events/", "/api/marketplace/events/counts/", "/api/marketplace/events/export/",
            "/api/activity/", "/api/activity/export/", "/api/activity/people/", "/api/tasks/",
            "/api/targets/", "/api/targets/mine/",
        ]
        return urls

    def test_no_staff_response_carries_the_link(self):
        raws, first, second = self.stage()
        hashes = list(OwnerConfirmation.objects.values_list("token_hash", flat=True))
        self.assertTrue(hashes)
        needles = raws + hashes
        approval = ApprovalRequest.objects.get(pk=first.approval_id)
        seen_ok = 0
        # The responses recorded while staging (create, send) are staff-facing too.
        bodies = [text_of(r) for r in self.responses]
        for staff in (self.scout, self.ops, self.admin, self.gm, self.support):
            self.as_staff(staff)
            for url in self.urls(first, second):
                response = self.client.get(url)
                if response.status_code == 200:
                    seen_ok += 1
                    bodies.append(text_of(response))
                    if url == f"/api/approvals/{approval.pk}/" and staff in (self.ops, self.admin):
                        self.assertIn("listing.staff_create", bodies[-1])
        self.assertGreater(seen_ok, 40, "the walk reached too few endpoints to mean anything")
        for body in bodies:
            for needle in needles:
                self.assertNotIn(needle, body, "a staff response carries the confirmation token or its hash")
            self.assertIsNone(LEAK_PATTERN.search(body), "a staff response carries a token= URL")
        # The only place the raw token lives is the owner's text.
        self.assertTrue(all(any(raw in m.body for m in senders.sms_outbox) for raw in raws))
