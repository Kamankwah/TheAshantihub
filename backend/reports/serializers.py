from accounts.serializers import staff_brief

from . import providers, services
from .models import StaffReport


def report_payload(report, viewer, *, include_system=True, view_all=None):
    """One report as the API shows it to `viewer`. A draft or returned report
    shows live system numbers; a submitted one shows the frozen snapshot."""
    live = report.status in (StaffReport.DRAFT, StaffReport.RETURNED) or report.system_snapshot is None
    data = {
        "id": report.pk,
        "staff": staff_brief(report.staff),
        "period": report.period,
        "period_start": report.period_start,
        "period_end": report.period_end,
        "status": report.status,
        "submitted_at": report.submitted_at,
        "snapshot_at": report.snapshot_at or (report.submitted_at if report.system_snapshot is not None else None),
        "is_late": report.is_late,
        "due_at": services.due_at(report),
        "achievements": report.achievements,
        "blockers": report.blockers,
        "plan_next": report.plan_next,
        "plan_results": report.plan_results,
        "linked_targets": report.linked_targets,
        "reviewer": staff_brief(report.reviewer),
        "reviewed_at": report.reviewed_at,
        "review_note": report.review_note,
        "similarity": report.similarity,
        "similar_warning": report.similarity >= services.SIMILARITY_FLAG,
        "can_edit": viewer.pk == report.staff_id and report.status in (StaffReport.DRAFT, StaffReport.RETURNED),
        "can_review": report.status == StaffReport.SUBMITTED and services.can_review(report, viewer, view_all=view_all),
        "system_is_live": live,
    }
    if include_system:
        data["system"] = (
            providers.system_sections(report.staff, report.period_start, report.period_end)
            if live else report.system_snapshot
        )
    return data
