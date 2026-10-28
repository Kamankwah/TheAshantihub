from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Customer
from accounts.permissions import HasRolePermission, RequiresSudo

from . import feeds, notify, opening, search
from .models import TestAccount

MANAGE = "opening.manage"


class OpeningView(APIView):
    """GET: the opening time and the server's clock (the countdown never trusts the device clock)."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        response = Response(opening.snapshot())
        response["Cache-Control"] = "no-store"
        return response


class DelayOpeningView(APIView):
    def get_permissions(self):
        return [HasRolePermission(MANAGE), RequiresSudo()]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        new_time = parse_datetime(str(data.get("opens_at") or ""))
        if new_time is None or new_time.tzinfo is None:
            return Response({"opens_at": "Give the new opening time with a time zone."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            row = opening.delay(request.user, new_time, data.get("reason"))
        except opening.OpeningError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"opens_at": row.opens_at.isoformat().replace("+00:00", "Z"), "reason": row.reason}, status=status.HTTP_201_CREATED)


class TestAccountsView(APIView):
    """The customers allowed to buy before opening."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def get(self, request):
        rows = TestAccount.objects.select_related("customer")
        return Response([
            {"customer": row.customer_id, "customer_name": row.customer.full_name, "added_at": row.created_at.isoformat()}
            for row in rows
        ])

    def _customer(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            return Customer.objects.filter(pk=int(data.get("customer"))).first()
        except (TypeError, ValueError):
            return None

    def post(self, request):
        customer = self._customer(request)
        if customer is None:
            return Response({"customer": "No such customer."}, status=status.HTTP_400_BAD_REQUEST)
        _, created = TestAccount.objects.get_or_create(customer=customer, defaults={"added_by": request.user})
        return Response({"customer": customer.pk}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def delete(self, request):
        customer = self._customer(request)
        if customer is None:
            return Response({"customer": "No such customer."}, status=status.HTTP_400_BAD_REQUEST)
        get_object_or_404(TestAccount, customer=customer).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotifyMeView(APIView):
    """Public: ask to be told when the marketplace opens. Answers the same for a new and a repeated request."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "notify_me"

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            notify.subscribe(phone=data.get("phone"), email=data.get("email"))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"status": "saved"})


class NotifyStopView(APIView):
    """Public: the stop link. The same answer whether or not the token exists, so it cannot be used to probe."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "notify_me_stop"

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        notify.opt_out(data.get("token"))
        return Response({"status": "stopped"})


class SearchView(APIView):
    """Public search across products, services, stays and events. ?q= (2+ characters), ?category=<slug|id> (the node and
    its descendants), ?kind=products|services|stays|events (singular accepted; anything else is a 400), ?limit= (per
    group, at most 20)."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "storefront_search"

    def get(self, request):
        params = request.query_params
        raw_kind = (params.get("kind") or "").strip().lower()
        kind = search.KINDS.get(raw_kind) if raw_kind else None
        if raw_kind and kind is None:
            return Response({"kind": "Use products, services, stays or events."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            limit = int(params.get("limit", search.MAX_LIMIT))
        except (TypeError, ValueError):
            limit = search.MAX_LIMIT
        body = search.run(params.get("q"), department=params.get("category") or None, kind=kind, limit=limit, request=request)
        return Response(body)


class DealsView(APIView):
    """Public Deals feed: live product listings with a real discount, plus sponsored ones. ?limit= (1-48, default 24)."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "storefront_deals"

    def get(self, request):
        try:
            limit = int(request.query_params.get("limit", feeds.DEFAULT_LIMIT))
        except (TypeError, ValueError):
            limit = feeds.DEFAULT_LIMIT
        return Response(feeds.deals(limit=limit, request=request))


class HomeFeedView(APIView):
    """Public feed for the marketplace home. `most_visited`: up to 8 product departments, most visited over the last
    30 days first (listings.visits; seed order until there is enough data), keeping only departments a shopper can
    open (something live in them or below them), so the home never shows an empty department. `ranked`: true only
    when the order really comes from visits; false when it fell back to the seed order, so the home does not call a
    seed-ordered list "most visited"."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "storefront_home"

    def get(self, request):
        from listings.category_tree import shopper_ids
        from listings.visits import most_visited_ranking

        open_ids = shopper_ids()
        ordered, ranked = most_visited_ranking(limit=1000)
        departments = [c for c in ordered if c.pk in open_ids][:8]
        rows = [{"id": c.pk, "slug": c.slug, "label": c.label, "icon": c.icon} for c in departments]
        return Response({"most_visited": rows, "ranked": ranked})
