"""The scout's prospects list reports a derived pipeline stage (plan M3, Task 8): prospect < registered <
awaiting_owner < confirmed < listing < live, from the owner confirmation rows, this scout's drafts, listings and events."""
import itertools
from datetime import timedelta

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from accounts.models import BusinessOwner
from approvals.models import ApprovalRequest
from events.models import Event
from field.models import Prospect
from field.tests.test_prospects import PROSPECTS, ProspectBase
from listings.models import Category, Listing, Zone
from portfolio import confirmations
from portfolio.models import ListingDraft, OwnerConfirmation
from portfolio.tests.test_confirmations import make_owner

_n = itertools.count(1)


class PipelineBase(ProspectBase):
    def registered(self, scout=None, *, confirmation=None, **owner_extra):
        """A registered prospect (and its business) for `scout`. `confirmation`: None (no row, grandfathered), or one of
        open, expired, declined, revoked, confirmed."""
        scout = scout or self.kwame
        i = next(_n)
        owner = make_owner(f"024 555 {i:04d}", business_name=f"Biz {i}", registration_channel=BusinessOwner.SCOUT,
                           registered_by=scout, **owner_extra)
        if confirmation:
            self.confirmation(owner, confirmation)
        prospect = Prospect.objects.create(
            scout=scout, name=f"Biz {i}", phone=f"+23324555{i:04d}", status=Prospect.REGISTERED,
            registered_business=owner, registered_at=timezone.now(),
        )
        return prospect, owner

    def confirmation(self, owner, state, *, scope=OwnerConfirmation.REGISTRATION):
        now = timezone.now()
        fields = {"expires_at": now + timedelta(days=5)}
        if state == "expired":
            fields["expires_at"] = now - timedelta(days=1)
        elif state == "declined":
            fields["declined_at"] = now
        elif state == "revoked":
            fields["revoked_at"] = now
        elif state == "confirmed":
            fields["confirmed_at"] = now
        return OwnerConfirmation.objects.create(
            business_owner=owner, scope=scope, token_hash=f"h{next(_n):063d}", created_by=self.kwame, **fields,
        )

    def draft(self, owner, scout=None, status=ListingDraft.DRAFT, **extra):
        return ListingDraft.objects.create(
            business_owner=owner, kind="product", created_by=scout or self.kwame, payload={"name": "X"}, status=status, **extra,
        )

    def listing(self, owner, scout=None, status=Listing.PUBLISHED, reviewed_at=None):
        return Listing.objects.create(
            business_owner=owner, category=Category.objects.get_or_create(
                slug="t-pipe", defaults={"icon": "x", "label": "Pipe", "color": "#fff", "kind": "product"})[0],
            zone=self.zone, name="Stole", description="D.", contact_phone="+233241110000", status=status,
            has_warranty=False, has_expiry=False, return_policy="r", created_by_staff=scout or self.kwame,
            reviewed_at=reviewed_at or timezone.now(),
        )

    def event(self, owner, scout=None, status=Event.APPROVED, reviewed_at=None):
        return Event.objects.create(
            category=Category.objects.get_or_create(
                slug="t-fest", defaults={"icon": "x", "label": "Fest", "color": "#fff", "kind": "event"})[0],
            zone=self.zone, submitted_by_business=owner, name="Fair", description="D.", address="A",
            event_date=timezone.now() + timedelta(days=5), visibility_days=14, status=status,
            created_by_staff=scout or self.kwame, reviewed_at=reviewed_at or timezone.now(),
        )

    def get(self, who=None, query="?status=registered"):
        self.as_staff(who or self.kwame)
        response = self.client.get(PROSPECTS + query)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def row(self, prospect, who=None):
        return next(r for r in self.get(who)["results"] if r["id"] == prospect.pk)


class PipelineStageTests(PipelineBase):
    def stage(self, prospect):
        return self.row(prospect)["pipeline"]["stage"]

    def test_prospect_row_has_pipeline_stage_for_each_state(self):
        plain = Prospect.objects.create(scout=self.kwame, name="Plain", phone="+233241119999")
        self.as_staff(self.kwame)
        listed = {r["id"]: r for r in self.client.get(PROSPECTS).json()["results"]}
        self.assertEqual(listed[plain.pk]["pipeline"]["stage"], "prospect")

        # registered but never asked, no row at all -> grandfathered: confirmed
        grand, _ = self.registered()
        self.assertEqual(self.stage(grand), "confirmed")
        for state, expected in [
            ("open", "awaiting_owner"), ("expired", "registered"), ("declined", "registered"),
            ("revoked", "registered"), ("confirmed", "confirmed"),
        ]:
            prospect, _ = self.registered(confirmation=state)
            self.assertEqual(self.stage(prospect), expected, state)

        prospect, owner = self.registered(confirmation="open")
        self.draft(owner)
        self.assertEqual(self.stage(prospect), "listing")
        prospect, owner = self.registered(confirmation="confirmed")
        self.draft(owner, status=ListingDraft.WITHDRAWN)
        self.assertEqual(self.stage(prospect), "confirmed")  # a withdrawn draft is no step
        prospect, owner = self.registered(confirmation="confirmed")
        self.listing(owner, status=Listing.PUBLISHED)
        self.assertEqual(self.stage(prospect), "live")
        prospect, owner = self.registered()
        self.event(owner)
        self.assertEqual(self.stage(prospect), "live")
        prospect, owner = self.registered()
        self.event(owner, status=Event.PENDING)
        self.assertEqual(self.stage(prospect), "listing")

    def test_listing_counts_only_this_scouts_drafts(self):
        prospect, owner = self.registered(confirmation="confirmed")
        self.draft(owner)
        self.draft(owner, status=ListingDraft.AWAITING_OWNER, confirmation=self.confirmation(owner, "open", scope="listings"))
        approval = ApprovalRequest.objects.create(
            kind="listing.staff_create", title="t", maker=self.kwame, due_at=timezone.now() + timedelta(days=1),
        )
        self.draft(owner, status=ListingDraft.SUBMITTED, approval=approval)
        self.draft(owner, status=ListingDraft.WITHDRAWN)
        self.draft(owner, scout=self.efua)  # someone else's draft on the same business
        self.listing(owner)
        self.listing(owner, scout=self.efua)
        counts = self.row(prospect)["pipeline"]["listings"]
        self.assertEqual(counts, {"drafts": 1, "awaiting_owner": 1, "lapsed": 0, "pending_approval": 1, "live": 1})

        # A link that ran out unconfirmed reads as lapsed (an expired link is still unrevoked, so it is the owner's one row).
        lapsed_prospect, lapsed_owner = self.registered(confirmation="confirmed")
        self.draft(
            lapsed_owner, status=ListingDraft.AWAITING_OWNER,
            confirmation=self.confirmation(lapsed_owner, "expired", scope="listings"),
        )
        self.assertEqual(
            self.row(lapsed_prospect)["pipeline"]["listings"],
            {"drafts": 0, "awaiting_owner": 0, "lapsed": 1, "pending_approval": 0, "live": 0},
        )

        # Efua's view of her own prospect on the same business sees only her own work.
        other = Prospect.objects.create(
            scout=self.efua, name="Same", phone="+233241118888", status=Prospect.REGISTERED,
            registered_business=owner, registered_at=timezone.now(),
        )
        self.assertEqual(
            self.row(other, self.efua)["pipeline"]["listings"],
            {"drafts": 1, "awaiting_owner": 0, "lapsed": 0, "pending_approval": 0, "live": 1},
        )

    def approval(self, status):
        return ApprovalRequest.objects.create(
            kind="listing.staff_create", title="t", maker=self.kwame, status=status,
            due_at=timezone.now() + timedelta(days=1),
        )

    def test_owner_confirmed_declined_and_decided_submissions_are_counted_once(self):
        prospect, owner = self.registered(confirmation="confirmed")
        self.draft(owner, status=ListingDraft.OWNER_CONFIRMED)
        self.draft(owner, status=ListingDraft.OWNER_DECLINED)
        self.draft(owner, status=ListingDraft.SUBMITTED, approval=self.approval(ApprovalRequest.APPROVED))
        self.draft(owner, status=ListingDraft.SUBMITTED, approval=self.approval(ApprovalRequest.REJECTED))
        self.draft(owner, status=ListingDraft.SUBMITTED, approval=self.approval(ApprovalRequest.CANCELLED))
        self.listing(owner)  # what the approved submission published
        counts = self.row(prospect)["pipeline"]["listings"]
        self.assertEqual(counts, {"drafts": 3, "awaiting_owner": 0, "lapsed": 0, "pending_approval": 1, "live": 1})

    def test_sub_counts_account_for_every_non_withdrawn_draft(self):
        prospect, owner = self.registered(confirmation="confirmed")
        statuses = [
            ListingDraft.DRAFT, ListingDraft.OWNER_CONFIRMED, ListingDraft.OWNER_DECLINED, ListingDraft.WITHDRAWN,
            ListingDraft.AWAITING_OWNER,
        ]
        for status in statuses:
            kwargs = {}
            if status == ListingDraft.AWAITING_OWNER:
                kwargs["confirmation"] = self.confirmation(owner, "open", scope="listings")
            self.draft(owner, status=status, **kwargs)
        for approval_status in (ApprovalRequest.PENDING, ApprovalRequest.APPROVED, ApprovalRequest.REJECTED):
            self.draft(owner, status=ListingDraft.SUBMITTED, approval=self.approval(approval_status))
        self.draft(owner, status=ListingDraft.SUBMITTED)  # approval gone
        self.listing(owner)
        self.listing(owner, status=Listing.PENDING_REVIEW)
        self.event(owner)
        self.event(owner, status=Event.PENDING)
        self.listing(owner, scout=self.efua)
        counts = self.row(prospect)["pipeline"]["listings"]
        not_yet_published = ListingDraft.objects.filter(business_owner=owner, created_by=self.kwame).exclude(
            status=ListingDraft.WITHDRAWN).exclude(approval__status=ApprovalRequest.APPROVED).count()
        self.assertEqual(
            counts["drafts"] + counts["awaiting_owner"] + counts["lapsed"] + counts["pending_approval"], not_yet_published,
        )
        self.assertEqual(counts["live"], 2)

    def test_listings_live_this_month_counts_approved_this_month_only(self):
        _, owner = self.registered()
        self.listing(owner)
        self.event(owner)
        self.listing(owner, status=Listing.PENDING_REVIEW)
        self.listing(owner, reviewed_at=timezone.now() - timedelta(days=45))
        self.listing(owner, scout=self.efua)
        body = self.get()
        self.assertEqual(body["listings_live_this_month"], 2)
        self.assertEqual(self.get(self.efua)["listings_live_this_month"], 1)

    def test_registration_confirmed_bulk_agrees_with_the_per_owner_function(self):
        owners = []
        for state in (None, "open", "expired", "declined", "revoked", "confirmed"):
            _, owner = self.registered(confirmation=state)
            owners.append(owner)
        _, mixed = self.registered(confirmation="declined")
        self.confirmation(mixed, "confirmed")
        owners.append(mixed)
        bulk = confirmations.registration_states([o.pk for o in owners])
        for owner in owners:
            self.assertEqual(
                bulk[owner.pk] == confirmations.CONFIRMED, confirmations.registration_confirmed(owner), owner.pk,
            )
        self.assertEqual(bulk[owners[1].pk], confirmations.WAITING)
        self.assertEqual(bulk[owners[2].pk], confirmations.UNCONFIRMED)


class PipelineQueryTests(PipelineBase):
    def build(self, n):
        for i in range(n):
            _, owner = self.registered(confirmation="open" if i % 2 else None)
            self.draft(owner)
            self.listing(owner)
            self.event(owner)

    def queries(self):
        self.as_staff(self.kwame)
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(self.client.get(PROSPECTS + "?status=registered").status_code, 200)
        return len(ctx)

    def test_no_queries_explosion(self):
        self.build(2)
        small = self.queries()
        self.build(18)
        self.assertEqual(self.queries(), small)
