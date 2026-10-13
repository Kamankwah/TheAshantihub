"""Campaigns, calendar and results (staff; campaigns.manage) plus the public tracked-link endpoint."""
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from activity.models import ActivityEvent
from approvals.models import ApprovalRequest

from . import audience as audience_rules
from . import campaigns, dispatch, messages, policy
from .calendar_sources import banner_entries, flash_sale_entries
from .models import SendPolicy
from .models_campaigns import Campaign, CampaignRecipient
from .models_consent import CHANNEL_LABELS, ConsentRecord
from .providers import provider_status

STATUS_TABS = ["draft", "waiting_approval", "scheduled", "sent"]


def money(value):
    return str((value or Decimal("0")).quantize(Decimal("0.01")))


def results_line(c, counts):
    sent = counts.get("sent", 0) + counts.get("delivered", 0) + counts.get("simulated", 0)
    if c.status not in (Campaign.SENT, Campaign.SENDING) or not sent:
        return None
    parts = []
    if counts.get("delivered"):
        parts.append(f"{counts['delivered']:,} delivered")
    if counts.get("simulated"):
        parts.append(f"{counts['simulated']:,} simulated (nothing sent)")
    if counts.get("sent"):
        parts.append(f"{counts['sent']:,} sent")
    if counts.get("failed"):
        parts.append(f"{counts['failed']:,} failed")
    return " · ".join(parts)


def counts_for(ids):
    out = {pk: {} for pk in ids}
    rows = CampaignRecipient.objects.filter(campaign_id__in=ids).values("campaign_id", "status").annotate(n=Count("id"))
    for row in rows:
        out[row["campaign_id"]][row["status"]] = row["n"]
    return out


def campaign_body(c, counts=None, detail=False):
    counts = counts or {}
    data = {
        "id": c.pk, "name": c.name, "channel": c.channel, "channel_label": CHANNEL_LABELS.get(c.channel, c.channel), "status": c.status,
        "status_label": c.get_status_display(), "segment": c.segment_id, "segment_name": c.segment.name if c.segment_id else None,
        "audience": c.audience, "est_recipients": c.est_recipients, "est_cost": money(c.est_cost) if c.cost_known else None,
        "cost_known": c.cost_known, "actual_cost": money(c.actual_cost) if c.actual_cost is not None else None, "send_at": c.send_at, "sent_at": c.sent_at,
        "note": c.note, "created_at": c.created_at, "provider_state": c.provider_state, "results": results_line(c, counts),
        "free_channel": c.channel in ("email", "inapp"),
    }
    if detail:
        data.update({
            "subject": c.subject, "body": c.body, "link_path": c.link_path, "template": c.template_id, "approval": c.approval_id,
            "preview": messages.render(c, example=True), "sms_segments": messages.sms_segments(messages.render(c, example=True)) if c.channel == "sms" else None,
            "length": messages.total_length(c), "editable": c.status in Campaign.EDITABLE, "checks": campaigns.checks(c), "needs_approval": campaigns.needs_approval(c),
            "threshold": money(policy.approval_threshold()), "provider": provider_status(c.channel) if c.channel in CHANNEL_LABELS else None,
            "trail": trail(c),
        })
    return data


def trail(c):
    """The campaign's history from the activity log and its approval request. Real events only."""
    rows = [{"at": c.created_at, "text": "Created", "who": c.created_by.full_name if c.created_by_id else ""}]
    for event in ActivityEvent.objects.filter(target_type="marketing.campaign", target_id=str(c.pk)).order_by("occurred_at")[:30]:
        rows.append({"at": event.occurred_at, "text": event.summary or event.verb, "who": event.actor_label})
    if c.approval_id:
        approval = ApprovalRequest.objects.filter(pk=c.approval_id).select_related("maker", "decided_by").first()
        if approval:
            rows.append({"at": approval.created_at, "text": f"Sent for approval: estimated cost GH₵ {money(c.est_cost)}, above GH₵ {money(policy.approval_threshold())}", "who": approval.maker.full_name})
            if approval.status != ApprovalRequest.PENDING and approval.decided_at:
                rows.append({"at": approval.decided_at, "text": {"approved": "Approved", "rejected": "Returned", "cancelled": "Request ended"}.get(approval.status, approval.status), "who": approval.decided_by.full_name if approval.decided_by_id else "System"})
    seen, out = set(), []
    for r in sorted(rows, key=lambda r: r["at"]):
        key = (r["text"], r["who"], r["at"].replace(microsecond=0))
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


class CampaignsView(APIView):
    """GET campaigns/?status=&channel= — the list. POST — start a draft."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def get(self, request):
        base = Campaign.objects.select_related("segment")
        tabs_counts = {key: base.filter(status=key).count() for key in STATUS_TABS}
        qs = base
        wanted = request.query_params.get("status")
        if wanted in dict(Campaign.STATUS_CHOICES):
            qs = qs.filter(status=wanted)
        if request.query_params.get("channel") in CHANNEL_LABELS:
            qs = qs.filter(channel=request.query_params["channel"])
        rows = list(qs[:200])
        counts = counts_for([c.pk for c in rows])
        month = timezone.localtime().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        spent = sum((c.est_cost for c in Campaign.objects.filter(channel="sms", status__in=[Campaign.SENT, Campaign.SENDING], sent_at__gte=month)), Decimal("0"))
        return Response({
            "results": [campaign_body(c, counts[c.pk]) for c in rows], "total": base.count(), "tabs": tabs_counts,
            "sms_month_estimate": money(spent), "sms_balance": None,
            "sms_note": "Estimated from message counts at the planning price. No SMS provider is connected, so there is no real balance or bill to show.",
        })

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            c = campaigns.save(Campaign(), request.user, data)
        except campaigns.CampaignError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        return Response(campaign_body(c, detail=True), status=status.HTTP_201_CREATED)


class CampaignDetailView(APIView):
    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def get(self, request, pk):
        c = Campaign.objects.select_related("segment", "created_by").filter(pk=pk).first()
        if c is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(campaign_body(c, counts_for([c.pk])[c.pk], detail=True))

    def patch(self, request, pk):
        c = Campaign.objects.select_related("segment").filter(pk=pk).first()
        if c is None:
            return Response({"detail": "Not found."}, status=404)
        try:
            campaigns.save(c, request.user, request.data if isinstance(request.data, dict) else {})
        except campaigns.CampaignError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        return Response(campaign_body(c, detail=True))

    def delete(self, request, pk):
        c = Campaign.objects.filter(pk=pk).first()
        if c is None:
            return Response({"detail": "Not found."}, status=404)
        if c.status != Campaign.DRAFT or c.recipients.exists():
            return Response({"detail": "Only a draft that was never sent can be deleted."}, status=409)
        c.delete()
        return Response(status=204)


class _Action(APIView):
    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def campaign(self, pk):
        return Campaign.objects.select_related("segment").filter(pk=pk).first()

    def run(self, request, pk, fn):
        c = self.campaign(pk)
        if c is None:
            return Response({"detail": "Not found."}, status=404)
        try:
            result = fn(c)
        except campaigns.CampaignError as exc:
            return Response({"detail": exc.message}, status=exc.status)
        return result if isinstance(result, Response) else Response(campaign_body(result or c, detail=True))


class CampaignSendView(_Action):
    """POST campaigns/<id>/send/ — Schedule it, or send it to Super Admin when it costs more than the limit."""

    def post(self, request, pk):
        return self.run(request, pk, lambda c: campaigns.send_for_go(c, request.user, request))


class CampaignWithdrawView(_Action):
    def post(self, request, pk):
        return self.run(request, pk, lambda c: campaigns.withdraw(c, request.user, request))


class CampaignDuplicateView(_Action):
    def post(self, request, pk):
        c = self.campaign(pk)
        if c is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(campaign_body(campaigns.duplicate(c, request.user), detail=True), status=201)


class CampaignRemindView(_Action):
    def post(self, request, pk):
        def go(c):
            campaigns.remind(c, request.user)
            return Response({"reminded": True})
        return self.run(request, pk, go)


class CampaignTestView(_Action):
    """POST campaigns/<id>/test/ — to the caller's own address only."""

    def post(self, request, pk):
        def go(c):
            state = campaigns.send_test(c, request.user)
            return Response({"state": state})
        return self.run(request, pk, go)


class CampaignPreviewCountView(APIView):
    """POST campaigns/estimate/ {segment, channel, body, send_at?} — the people and cost for a message as drawn; nothing is saved."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            c = Campaign()
            campaigns.apply_fields(c, campaigns.clean_fields(data))
            recipients, segments, amount, known, skipped, matched = campaigns.estimate(c)
            c.est_recipients, c.est_cost, c.cost_known = recipients, amount, known
        except (campaigns.CampaignError, audience_rules.AudienceError) as exc:
            return Response({"detail": exc.message}, status=400)
        return Response({
            "recipients": recipients, "matched": matched, "left_out_cap": skipped, "left_out_no_opt_in": max(0, matched - recipients - skipped),
            "sms_segments": segments, "cost": money(amount) if known else None, "cost_known": known, "threshold": money(policy.approval_threshold()),
            "needs_approval": campaigns.needs_approval(c), "checks": campaigns.checks(c), "length": messages.total_length(c),
            "preview": messages.render(c, example=True), "unit_price": str(__import__("marketing.cost", fromlist=["x"]).unit_price(c.channel)) if c.channel in CHANNEL_LABELS and __import__("marketing.cost", fromlist=["x"]).unit_price(c.channel) is not None else None,
        })


# ─── Calendar ────────────────────────────────────────────────────────────────
def _day(value):
    return value.date() if isinstance(value, datetime) else value


class CalendarView(APIView):
    """GET calendar/?from=YYYY-MM-DD&to= — campaigns, flash sales and banners in the range, quiet days and overlaps."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def get(self, request):
        try:
            start = date.fromisoformat(request.query_params["from"])
            end = date.fromisoformat(request.query_params["to"])
        except (KeyError, ValueError):
            return Response({"detail": "Give from and to as YYYY-MM-DD."}, status=400)
        if end < start or (end - start).days > 62:
            return Response({"detail": "Choose a range of up to two months."}, status=400)
        tz = timezone.get_current_timezone()
        lo, hi = timezone.make_aware(datetime.combine(start, datetime.min.time()), tz), timezone.make_aware(datetime.combine(end + timedelta(days=1), datetime.min.time()), tz)
        entries = []
        for c in Campaign.objects.filter(Q(send_at__gte=lo, send_at__lt=hi) | Q(sent_at__gte=lo, sent_at__lt=hi)).exclude(status=Campaign.WITHDRAWN):
            when = c.sent_at or c.send_at
            entries.append({"id": c.pk, "kind": "message", "channel": c.channel, "title": c.name, "starts_at": when, "ends_at": None, "status": c.status, "status_label": c.get_status_display()})
        entries += banner_entries(lo, hi)
        entries += flash_sale_entries(lo, hi)
        entries.sort(key=lambda e: e["starts_at"])
        sp = SendPolicy.current()
        from targets.models import PublicHoliday

        holidays = {h.date: h.name for h in PublicHoliday.objects.filter(date__gte=start, date__lte=end)}
        quiet = []
        d = start
        while d <= end:
            if d.weekday() not in sp.send_days:
                quiet.append({"date": d, "why": "Quiet day"})
            elif sp.quiet_public_holidays and d in holidays:
                quiet.append({"date": d, "why": holidays[d]})
            d += timedelta(days=1)
        return Response({"from": start, "to": end, "entries": entries, "quiet_days": quiet, "clashes": clashes(sp), "window": policy.serialize(sp)})


def clashes(sp):
    """Real overlaps only: two upcoming messages to the same people inside the per-person cap, and approvals that may not land in time."""
    out = []
    upcoming = list(Campaign.objects.filter(status__in=[Campaign.WAITING, Campaign.SCHEDULED, Campaign.DRAFT], send_at__gte=timezone.now() - timedelta(hours=1)).exclude(segment=None).order_by("send_at")[:12])
    cap = timedelta(days=sp.per_person_cap_days)
    people = {}
    for c in upcoming:
        field = "pk"
        people[c.pk] = set(audience_rules.reachable(c.audience, c.filters, c.channel).values_list(field, flat=True)) if c.audience else set()
    for i, a in enumerate(upcoming):
        for b in upcoming[i + 1:]:
            if a.audience != b.audience or abs(b.send_at - a.send_at) >= cap:
                continue
            shared = len(people[a.pk] & people[b.pk])
            if shared:
                out.append({"when": f"{timezone.localtime(b.send_at):%a %d %b}", "text": f"{b.name} ({b.est_recipients:,} people): {shared:,} of them are also in {a.name}. Sent within {sp.per_person_cap_days} days of it, the per-person limit would skip them."})
    soon = timezone.now() + timedelta(hours=24)
    for c in Campaign.objects.filter(status=Campaign.WAITING, send_at__lte=soon, send_at__gt=timezone.now()):
        out.append({"when": f"{timezone.localtime(c.send_at):%a %d %b}", "text": f"{c.name} is still waiting for Super Admin and goes out within 24 hours. If it is not approved by then, nothing is sent and it goes back to Draft."})
    return out


# ─── Results ─────────────────────────────────────────────────────────────────
ATTRIBUTION_DAYS = 7


def attributed_orders(recipient_rows, window_end=None):
    """Orders placed by a person within 7 days of their click, each counted for their latest click. Returns a list of (order, click_campaign_id).
    Only customers can order; only PAID orders count."""
    from orders.models import Order

    clicks = {}
    for r in CampaignRecipient.objects.filter(customer_id__in={r.customer_id for r in recipient_rows if r.customer_id}, first_click_at__isnull=False).values("customer_id", "campaign_id", "first_click_at"):
        clicks.setdefault(r["customer_id"], []).append((r["first_click_at"], r["campaign_id"]))
    out = []
    if not clicks:
        return out
    earliest = min(t for rows in clicks.values() for t, _ in rows)
    for order in Order.objects.filter(customer_id__in=clicks.keys(), status=Order.PAID, placed_at__gte=earliest).prefetch_related("items__listing__business_owner__profile"):
        eligible = [(t, cid) for t, cid in clicks[order.customer_id] if t <= order.placed_at <= t + timedelta(days=ATTRIBUTION_DAYS)]
        if eligible:
            out.append((order, max(eligible)[1]))
    return out


def network_label(key):
    return dict(__import__("marketing.models_campaigns", fromlist=["SenderId"]).SenderId.NETWORK_CHOICES).get(key, "Unknown")


class CampaignResultsView(APIView):
    """GET campaigns/<id>/results/ — one campaign end to end. Anything the provider does not report is said to be unreported, never filled in."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def get(self, request, pk):
        c = Campaign.objects.select_related("segment", "created_by").filter(pk=pk).first()
        if c is None:
            return Response({"detail": "Not found."}, status=404)
        rows = list(c.recipients.select_related("customer", "business_owner"))
        by = {}
        for r in rows:
            by[r.status] = by.get(r.status, 0) + 1
        sent = by.get("sent", 0) + by.get("delivered", 0) + by.get("simulated", 0) + by.get("failed", 0)
        delivered = by.get("delivered", 0)
        provider = provider_status(c.channel) if c.channel in CHANNEL_LABELS else {"delivery_reports": False}
        reports = bool(provider.get("delivery_reports")) or c.channel == "inapp"
        clicked = [r for r in rows if r.first_click_at]
        orders = [(o, cid) for o, cid in attributed_orders(rows) if cid == c.pk]
        value = sum((o.total_amount for o, _ in orders), Decimal("0"))
        by_biz = {}
        for order, _ in orders:
            for line in order.items.all():
                name = line.listing.business_owner.display_name
                row = by_biz.setdefault(name, {"name": name, "orders": set(), "value": Decimal("0")})
                row["orders"].add(order.pk)
                row["value"] += line.line_total
        outs = ConsentRecord.objects.filter(campaign_id=c.pk, status=ConsentRecord.OPTED_OUT).count()
        skipped = {}
        for r in rows:
            if r.status == CampaignRecipient.SKIPPED:
                skipped[r.skip_reason] = skipped.get(r.skip_reason, 0) + 1
        nets = {}
        for r in rows:
            if r.network and r.status != CampaignRecipient.SKIPPED:
                n = nets.setdefault(r.network, {"name": network_label(r.network), "sent": 0, "delivered": 0, "failed": 0})
                n["sent"] += 1
                n["delivered"] += r.status == CampaignRecipient.DELIVERED
                n["failed"] += r.status == CampaignRecipient.FAILED
        errors = {}
        for r in rows:
            if r.status == CampaignRecipient.FAILED and r.error:
                errors[r.error] = errors.get(r.error, 0) + 1
        buckets = [("First hour", 0, 1), ("1 to 3 hours", 1, 3), ("Rest of the first day", 3, 24), ("Later", 24, 10**6)]
        timing = []
        for label, lo, hi in buckets:
            n = sum(1 for r in clicked if r.sent_at and lo <= (r.first_click_at - r.sent_at).total_seconds() / 3600 < hi)
            timing.append({"when": label, "n": n})
        cost = c.actual_cost
        data = {
            "campaign": campaign_body(c, by, detail=False),
            "counts": {"sent": sent, "delivered": delivered if reports else None, "failed": by.get("failed", 0), "simulated": by.get("simulated", 0), "left_out": by.get("skipped", 0), "queued": by.get("queued", 0),
                       "awaiting_report": by.get("sent", 0) if reports and c.channel != "inapp" else None},
            "delivery_reported": reports, "left_out_reasons": skipped,
            "clicks": len(clicked), "click_rate": round(100 * len(clicked) / sent, 1) if sent else None,
            "signups": None, "signups_note": "Not tracked: AshantiHub does not link a new account to the message that brought it.",
            "orders": len(orders), "order_value": money(value), "orders_note": "Orders by people who clicked, within 7 days of the click, counted for their latest click. Order value is what customers paid businesses, not AshantiHub's income, and is simulated until Hubtel payments are connected.",
            "cost": money(cost) if cost is not None else None, "cost_estimate": money(c.est_cost) if c.cost_known else None,
            "cost_note": "Reported by the provider." if cost is not None else "The provider reports no cost, so only the estimate at the planning price is shown.",
            "cost_per_order": money(cost / len(orders)) if cost is not None and orders else None,
            "opt_outs": outs, "opt_out_rate": round(100 * outs / sent, 1) if sent else None,
            "networks": sorted(nets.values(), key=lambda n: n["name"]), "failure_reasons": [{"reason": k, "n": v} for k, v in errors.items()],
            "by_business": sorted(({"name": b["name"], "orders": len(b["orders"]), "value": money(b["value"])} for b in by_biz.values()), key=lambda b: -Decimal(b["value"])),
            "click_timing": timing, "message": messages.render(c, example=True),
            "audience_text": f"{c.segment.name if c.segment_id else 'Audience'}" + (f" ({c.est_recipients:,} reached, {by.get('skipped', 0):,} left out)"),
            "approval": {"needed": bool(c.approval_id), "text": "Approved by Super Admin" if c.approval_id else "No approval needed: within the limit"},
        }
        return Response(data)


class CampaignResultsListView(APIView):
    """GET results/campaigns/ — campaigns that have results, newest first, for the picker."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def get(self, request):
        rows = Campaign.objects.filter(status__in=[Campaign.SENT, Campaign.SENDING]).order_by("-sent_at", "-id")[:50]
        return Response({"results": [{"id": c.pk, "name": c.name, "channel": c.channel, "sent_at": c.sent_at, "send_at": c.send_at} for c in rows]})


class TrackedLinkView(APIView):
    """POST r/<token>/ — a person opened the tracked link in a message. Records the click once per person and answers the page to open.
    Public. A POST on purpose: link scanners that only fetch the address don't count as clicks."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "marketing_unsubscribe"

    def post(self, request, token):
        row = CampaignRecipient.objects.select_related("campaign").filter(click_token=token).first()
        if row is None:
            return Response({"detail": "This link is not valid."}, status=404)
        now = timezone.now()
        CampaignRecipient.objects.filter(pk=row.pk).update(click_count=row.click_count + 1, first_click_at=row.first_click_at or now)
        return Response({"path": row.campaign.link_path or "/"})
