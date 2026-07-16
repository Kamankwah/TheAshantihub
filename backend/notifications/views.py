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
        from billing.models import SubscriptionPlan
        from contact.models import ContactMessage
        from events.models import Event, Ticket
        from listings.models import HeroMediaSubmission, Listing
        from reviews.models import Review

        held = set(user.role.permissions.values_list("codename", flat=True))

        def count(codename, queryset):
            return queryset.count() if codename in held else 0

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
                # Reviews are moderated reactively (published on creation, no
                # "pending" subset), so the actionable queue = every currently
                # published review a moderator could still hide.
                "reviews": count(
                    "reviews.moderate",
                    Review.objects.filter(status=Review.PUBLISHED),
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
            }
        )
