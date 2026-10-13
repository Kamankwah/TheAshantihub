from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from insights.views import _format, send_document
from reports.exports import ExportNegotiation

from . import period_stats


class PeriodAnalyticsView(APIView):
    """GET /api/marketing/analytics/?days=7|30|90[&format=csv|xlsx|pdf] — real counts for the period."""

    content_negotiation_class = ExportNegotiation

    def get_permissions(self):
        return [HasRolePermission("analytics.view")]

    def get(self, request):
        days = period_stats.clean_days(request.query_params.get("days"))
        stats = period_stats.period_stats(days)
        fmt = _format(request.query_params)
        if fmt:
            doc = period_stats.export_tables(stats)
            stem = f"ashantihub-marketing-analytics-{days}d-{timezone.localdate()}"
            return send_document(request, doc, fmt, stem, kind="marketing_analytics", filters={"days": days})
        return Response(stats)
