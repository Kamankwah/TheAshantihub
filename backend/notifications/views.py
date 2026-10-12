from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer, StaffUser

from .models import Notification
from .serializers import NotificationSerializer


def _recipient_filter(user):
    """Filter kwargs scoping notifications to the calling account. Returns
    None for a caller that can't own notifications (an anonymous/guest
    request) — the list view then returns an empty set rather than erroring,
    so the bell works uniformly for signed-out visitors too."""
    if isinstance(user, Customer):
        return {"customer": user}
    if isinstance(user, BusinessOwner):
        return {"business_owner": user}
    if isinstance(user, StaffUser):
        return {"staff": user}
    return None


class NotificationListView(APIView):
    """GET /api/notifications/ — the caller's own notifications, most-recent
    first, with the current unread count. Unpaginated (same convention as
    useMyConversations/useOrders) but wrapped in an envelope carrying
    `unread_count` alongside `results` — the bell badge needs the count
    without walking the whole list client-side."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        scope = _recipient_filter(request.user)
        if scope is None:
            return Response({"unread_count": 0, "results": []})
        qs = Notification.objects.filter(**scope)
        unread_count = qs.filter(is_read=False).count()
        return Response(
            {
                "unread_count": unread_count,
                "results": NotificationSerializer(qs, many=True).data,
            }
        )


class NotificationMarkReadView(APIView):
    """POST /api/notifications/{id}/read/ — mark one of the caller's own
    notifications read. 404s for a notification outside the caller's scope,
    same convention as orders.views.OrderDetailView."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        scope = _recipient_filter(request.user)
        if scope is None:
            raise PermissionDenied("This account cannot own notifications.")
        notification = generics.get_object_or_404(Notification.objects.filter(**scope), pk=pk)
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(NotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    """POST /api/notifications/read-all/ — mark every unread notification of
    the caller read. Returns the new (zero) unread count."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        scope = _recipient_filter(request.user)
        if scope is None:
            return Response({"unread_count": 0})
        Notification.objects.filter(is_read=False, **scope).update(is_read=True)
        return Response({"unread_count": 0})


class StaffBadgesView(APIView):
    """GET /api/notifications/staff-badges/ — per-tab counts of *current
    pending work* for the staff dashboard's nav badges. Deliberately computed
    from the live pending queues (pending KYC submissions, pending listings,
    …), NOT from notification rows — a badge must reflect work still to do,
    not whether a notification was read. Each count is gated behind the same
    permission that gates the tab it belongs to; a staffer without a given
    permission always gets 0 for that badge (so the response shape is stable).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not isinstance(user, StaffUser):
            raise PermissionDenied("Staff badges are staff-only.")

        # Local imports keep this app's import surface small and avoid any
        # load-order coupling to the queue-owning apps.
        from approvals.services import waiting_for
        from billing.models import SubscriptionPlan
        from contact.models import ContactMessage
        from events.models import Event, Ticket
        from listings.models import HeroMediaSubmission, Listing
        from reviews.models import Review
        from staff_tasks.models import Task

        held = user.effective_permission_codenames()

        # Today's day report, while it is not yet submitted: the moment it is due.
        from reports import services as report_services
        from reports.models import StaffReport

        today = timezone.localdate()
        todays = StaffReport.objects.filter(staff=user, period=StaffReport.DAY, period_start=today).first()
        if todays is not None and todays.status in (StaffReport.SUBMITTED, StaffReport.ACKNOWLEDGED):
            report_due_at = None
        else:
            report_due_at = report_services.due_at(
                todays or StaffReport(staff=user, period=StaffReport.DAY, period_start=today, period_end=today)
            ).isoformat()

        def count(codename, queryset):
            return queryset.count() if codename in held else 0

        # Operations' work-queue counts. Each is gated by the permission that
        # opens its screen, and only counts where a real record source exists:
        # Support issues and Deliveries & returns are still being built, so
        # they stay 0 rather than inventing a figure.
        at_risk = subscriptions_due = fraud_open = team_reports_waiting = 0
        if "portfolio.manage" in held:
            from django.db.models import Q

            from portfolio import health
            from portfolio.views import portfolio_queryset

            now = timezone.now()
            team = portfolio_queryset(user, "team")
            at_risk = sum(1 for row in health.rate_all(team, now) if row.rating == health.AT_RISK)
            lapsed = team.filter(
                Q(subscription__current_period_end__lt=now)
                | Q(subscription__overdue_since__isnull=False)
                | Q(subscription__paused_at__isnull=False)
            )
            subscriptions_due = sum(1 for row in health.rate_all(lapsed, now) if row.subscription["state"] == "overdue")
        if "fraud.manage" in held:
            from fraud.models import FraudFlag
            from fraud.views import visible_flags

            fraud_open = visible_flags(user).filter(status=FraudFlag.OPEN).count()
        if "staff.invite_team" in held:
            team_reports_waiting = StaffReport.objects.filter(
                staff__manager=user, status=StaffReport.SUBMITTED
            ).count()

        # Escrow tab is gated by any of view/release/refund (see
        # AdminCommandCenter's nav), so its badge is too.
        can_escrow = held & {"escrow.view", "escrow.release", "escrow.refund"}
        escrow_count = (
            Ticket.objects.filter(escrow_status=Ticket.HELD, refunded_at__isnull=True).count()
            if can_escrow
            else 0
        )

        return Response(
            {
                "kyc": count(
                    "kyc.approve",
                    BusinessOwner.objects.filter(kyc_status=BusinessOwner.PENDING),
                ),
                "listings": count(
                    "listings.moderate",
                    Listing.objects.filter(status=Listing.PENDING_REVIEW),
                ),
                "events": count(
                    "event.approve",
                    Event.objects.filter(status=Event.PENDING),
                ),
                "hero": count(
                    "hero_media.approve",
                    HeroMediaSubmission.objects.filter(status=HeroMediaSubmission.PENDING),
                ),
                # Reviews are pre-moderated now (punch-list item 5), so this is
                # a real pending queue like the others above. It used to count
                # every published review — everything a moderator could still
                # reactively hide — which meant the badge never reached zero.
                "reviews": count(
                    "reviews.moderate",
                    Review.objects.filter(status=Review.PENDING),
                ),
                "plan_approvals": count(
                    "subscription_plans.approve",
                    SubscriptionPlan.objects.filter(status=SubscriptionPlan.PENDING_APPROVAL),
                ),
                "contact_messages": count(
                    "contact_messages.manage",
                    ContactMessage.objects.filter(status=ContactMessage.NEW),
                ),
                # Escrow "needs attention" = tickets still held (a release/
                # refund decision outstanding) and not already refunded.
                "escrow": escrow_count,
                "tasks_overdue": Task.objects.filter(
                    owner=user, status=Task.OPEN, due_at__lt=timezone.now()
                ).count(),
                "approvals_waiting": waiting_for(user).count(),
                "at_risk": at_risk,
                "subscriptions_due": subscriptions_due,
                "fraud_open": fraud_open,
                "team_reports_waiting": team_reports_waiting,
                "support_issues": 0,
                "deliveries_open": 0,
                "report_due_at": report_due_at,
            }
        )
