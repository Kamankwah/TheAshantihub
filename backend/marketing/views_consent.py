"""Consent ledger (staff), consent capture (customers and businesses) and the unsubscribe link."""
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.permissions import HasRolePermission, RequiresSudo
from accounts.phones import mask_phone, phone_key
from activity.services import record
from marketplace.common import csv_export

from . import consent
from .models_consent import BUSINESS, CHANNEL_LABELS, CUSTOMER, ConsentRecord, ConsentWording

RETENTION_YEARS = 2


class LedgerPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


def mask_email(value):
    if not value or "@" not in value:
        return ""
    name, domain = value.split("@", 1)
    return f"{name[:1]}***@{domain}"


def device_of(agent):
    agent = agent or ""
    if not agent:
        return "Not recorded"
    if "okhttp" in agent.lower() or "AshantiHub" in agent:
        return "App"
    if "Mobile" in agent or "Android" in agent or "iPhone" in agent:
        return "Phone browser"
    return "Computer browser"


def subject_phone(row):
    return row.customer.phone if row.customer_id else row.business_owner.login_phone


def subject_email(row):
    return row.customer.email if row.customer_id else row.business_owner.email


def subject_name(row):
    return row.customer.full_name if row.customer_id else row.business_owner.display_name


def line(row):
    return {
        "id": row.pk, "subject_kind": row.subject_kind, "subject_id": row.customer_id or row.business_owner_id,
        "who": subject_name(row), "kind_label": "Customer" if row.customer_id else "Business owner",
        "phone": mask_phone(subject_phone(row)) if subject_phone(row) else "", "email": mask_email(subject_email(row)),
        "channel": row.channel, "channel_label": CHANNEL_LABELS[row.channel], "status": row.status,
        "source": row.source, "source_label": row.get_source_display(), "source_detail": row.source_detail,
        "wording": row.wording.label if row.wording_id else "", "wording_text": row.wording_text,
        "at": row.at, "device": device_of(row.user_agent),
        "recorded_by": row.recorded_by.full_name if row.recorded_by_id else None,
    }


def ledger_queryset(params):
    qs = ConsentRecord.objects.select_related("customer", "business_owner__profile", "wording", "recorded_by")
    if params.get("channel") in CHANNEL_LABELS:
        qs = qs.filter(channel=params["channel"])
    if params.get("status") in (ConsentRecord.OPTED_IN, ConsentRecord.OPTED_OUT):
        qs = qs.filter(status=params["status"])
    if params.get("source") in dict(ConsentRecord.SOURCE_CHOICES):
        qs = qs.filter(source=params["source"])
    contact = (params.get("contact") or "").strip()
    if contact:
        digits = "".join(ch for ch in contact if ch.isdigit())
        match = Q(customer__full_name__icontains=contact) | Q(business_owner__full_name__icontains=contact) | Q(business_owner__profile__business_name__icontains=contact)
        # Only the digits the screen shows (the last 4 of a masked number) can be searched: a longer
        # string would let a searcher learn the hidden digits without the password-protected reveal.
        if 3 <= len(digits) <= 4:
            match |= Q(customer__phone__endswith=digits) | Q(business_owner__login_phone__endswith=digits)
        qs = qs.filter(match)
    return qs.order_by("-at", "-id")


class ConsentSummaryView(APIView):
    """GET consent/summary/ — per channel: people opted in now, opted out now, and this week's movement. Real counts of the ledger only."""

    def get_permissions(self):
        return [HasRolePermission("consent.view")]

    def get(self, request):
        week = timezone.now() - timedelta(days=7)
        channels = []
        for channel, label in CHANNEL_LABELS.items():
            ins = outs = 0
            for model, field in ((Customer, "customer"), (BusinessOwner, "business_owner")):
                state = model.objects.annotate(_s=consent.latest_status_subquery(field, channel))
                ins += state.filter(_s=ConsentRecord.OPTED_IN).count()
                outs += state.filter(_s=ConsentRecord.OPTED_OUT).count()
            this_week = ConsentRecord.objects.filter(channel=channel, at__gte=week)
            channels.append({
                "channel": channel, "label": label, "opted_in": ins, "opted_out": outs,
                "joined_this_week": this_week.filter(status=ConsentRecord.OPTED_IN).count(),
                "left_this_week": this_week.filter(status=ConsentRecord.OPTED_OUT).count(),
            })
        outs_by_source = [
            {"source": value, "label": label, "count": ConsentRecord.objects.filter(status=ConsentRecord.OPTED_OUT, at__gte=week, source=value).count()}
            for value, label in ConsentRecord.SOURCE_CHOICES
        ]
        outs_by_source = [row for row in outs_by_source if row["count"]]
        cutoff = timezone.now() - timedelta(days=365 * RETENTION_YEARS)
        first = ConsentRecord.objects.order_by("at").values_list("at", flat=True).first()
        return Response({
            "channels": channels, "total_records": ConsentRecord.objects.count(), "first_record_at": first,
            "opt_outs_7d": {"total": sum(r["count"] for r in outs_by_source), "by_source": outs_by_source},
            "retention": {"years": RETENTION_YEARS, "records_due": ConsentRecord.objects.filter(at__lt=cutoff).count()},
        })


class ConsentLedgerView(generics.ListAPIView):
    """GET consent/ledger/?contact=&channel=&status=&source=&page= — the lines, newest first; phones and emails masked."""

    pagination_class = LedgerPagination

    def get_permissions(self):
        return [HasRolePermission("consent.view")]

    def get_queryset(self):
        return ledger_queryset(self.request.query_params)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([line(row) for row in page])


class ConsentRevealView(APIView):
    """POST consent/ledger/<id>/reveal/ — the full phone and email, after the password again; recorded (who, whose), never the values."""

    def get_permissions(self):
        return [HasRolePermission("consent.view"), RequiresSudo()]

    def post(self, request, pk):
        row = generics.get_object_or_404(ConsentRecord.objects.select_related("customer", "business_owner"), pk=pk)
        record(request.user, "consent.contact_revealed", target=row, method="POST", summary=f"Showed the contact details of {subject_name(row)} on the consent ledger", request=request)
        return Response({"phone": subject_phone(row), "email": subject_email(row)})


class ConsentExportView(APIView):
    """GET consent/export/?<ledger filters> — consent proof for an audit (names, masked contacts, channel, status, source, wording and time).
    Personal data: the password again; the export is recorded as holding personal data."""

    def get_permissions(self):
        return [HasRolePermission("consent.view"), RequiresSudo()]

    def get(self, request):
        rows = [
            [
                r["id"], r["who"], r["kind_label"], r["phone"], r["email"], r["channel_label"], r["status"], r["source_label"],
                r["source_detail"], r["wording"], r["wording_text"], r["at"].isoformat(), r["recorded_by"] or "",
            ]
            for r in map(line, ledger_queryset(request.query_params))
        ]
        return csv_export(
            request, stem="consent-proof", kind="consent proof", personal_data=True,
            filters={k: v for k, v in request.query_params.items() if v},
            header=["Record", "Name", "Kind", "Phone (masked)", "Email (masked)", "Channel", "Status", "Source", "Source detail", "Wording", "Words agreed to", "When", "Recorded by"],
            rows=rows,
        )


class ConsentWordingsView(APIView):
    """GET consent/wordings/ — every wording and how many records hold it."""

    def get_permissions(self):
        return [HasRolePermission("consent.view")]

    def get(self, request):
        rows = []
        for w in ConsentWording.objects.all().order_by("channel", "audience", "-version"):
            rows.append({
                "id": w.pk, "label": w.label, "channel": w.channel, "channel_label": CHANNEL_LABELS[w.channel], "audience": w.audience,
                "text": w.text, "live_from": w.live_from, "retired_at": w.retired_at, "records": w.records.count(),
            })
        return Response({"wordings": rows})


# ─── The person's own answers ───────────────────────────────────────────────
def _own_subject(request):
    user = request.user
    return user if isinstance(user, (Customer, BusinessOwner)) else None


class ConsentMeView(APIView):
    """GET consent/me/ — a customer's or business owner's own marketing choices, each channel on its own (unticked until they tick it).
    POST consent/me/ {channel, opted_in} — change one; a new line is added to the ledger."""

    permission_classes = [IsAuthenticated]
    throttle_scope = "marketing_consent"

    def get(self, request):
        subject = _own_subject(request)
        if subject is None:
            return Response({"detail": "Marketing choices belong to customer and business accounts."}, status=status.HTTP_403_FORBIDDEN)
        return Response({"channels": consent.state_for(subject)})

    def post(self, request):
        subject = _own_subject(request)
        if subject is None:
            return Response({"detail": "Marketing choices belong to customer and business accounts."}, status=status.HTTP_403_FORBIDDEN)
        channel, opted_in = request.data.get("channel"), request.data.get("opted_in")
        if not isinstance(opted_in, bool):
            return Response({"detail": "Say whether you want these messages."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            consent.record_consent(subject, channel, opted_in, ConsentRecord.SETTINGS, request=request, source_detail="Account settings")
        except consent.ConsentError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"channels": consent.state_for(subject)})


class UnsubscribeView(APIView):
    """GET unsubscribe/<token>/ — what the link is for (reads only). POST — the one-click stop: records an opt-out for that channel
    only. Public; the token is signed, so it names exactly one person and channel."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "marketing_unsubscribe"

    def get(self, request, token):
        try:
            subject, channel, _ = consent.read_unsubscribe_token(token)
        except consent.ConsentError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"channel": channel, "channel_label": CHANNEL_LABELS[channel], "stopped": not consent.is_opted_in(subject, channel)})

    def post(self, request, token):
        try:
            subject, channel, campaign_id = consent.read_unsubscribe_token(token)
            consent.record_consent(subject, channel, False, ConsentRecord.UNSUBSCRIBE_LINK, request=request, source_detail="Stop link", campaign_id=campaign_id)
        except consent.ConsentError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"channel": channel, "channel_label": CHANNEL_LABELS[channel], "stopped": True})
