from django.db import transaction
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer
from listings.models import Listing
from listings.visibility import hidden_business_q

from . import guard
from .models import Cart, CartItem
from .permissions import IsCartItemOwner
from .serializers import (
    CartItemCreateSerializer,
    CartItemSerializer,
    CartItemUpdateSerializer,
    CartSerializer,
)


class CartMeView(APIView):
    """GET /api/cart/ — get-or-create the caller's own cart, with items."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request):
        cart, _ = Cart.objects.get_or_create(customer=request.user)
        return Response(CartSerializer(cart).data)


def _guard_lines(cart):
    """The cart's lines as the guard reads them (business, pin and category with each line)."""
    if cart is None:
        return []
    return list(cart.items.select_related("listing__business_owner__profile", "listing__category"))


class CartItemCreateView(APIView):
    """POST /api/cart/items/ — add a listing to the caller's cart. If the
    listing is already in the cart, increments quantity on the existing row
    rather than creating a duplicate line.

    The cart guard (cart.guard) refuses, with 400 {"detail", "code"} and
    nothing written, a service, stay or event listing and anything that would
    take the cart past the delivery limits in force. It runs once before the
    write (a quick refusal, and it measures any distances outside a database
    transaction) and again under a row lock on the cart, so two adds at the
    same moment cannot both pass on the same old cart.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request):
        serializer = CartItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        listing = serializer.validated_data["listing"]
        quantity = serializer.validated_data["quantity"]

        try:
            guard.check_add(_guard_lines(Cart.objects.filter(customer=request.user).first()), listing)
        except guard.GuardError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)

        if listing.price_amount is None:
            return Response(
                {"listing": "This listing has no price set and cannot be added to cart."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            cart, _ = Cart.objects.select_for_update().get_or_create(customer=request.user)
            try:
                guard.check_add(_guard_lines(cart), listing)  # the same check on the locked cart (the near-shop map is cached)
            except guard.GuardError as exc:
                transaction.set_rollback(True)  # nothing written, not even a new empty cart
                return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
            item = CartItem.objects.filter(cart=cart, listing=listing).first()
            if item is not None:
                item.quantity += quantity
                item.save(update_fields=["quantity"])
                created = False
            else:
                item = CartItem.objects.create(
                    cart=cart, listing=listing, quantity=quantity,
                    unit_price_snapshot=listing.price_amount,
                )
                created = True

        return Response(
            CartItemSerializer(item).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CartGuardView(APIView):
    """GET /api/cart/guard/?listing=<id> — the delivery limits for the caller's cart (and whether they are a live rate
    card's or the built-in defaults), its shops, whether checkout is blocked and why, and with ?listing= whether that
    listing may be added now. Writes nothing."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request):
        lines = _guard_lines(Cart.objects.filter(customer=request.user).first())
        listing = None
        raw = request.query_params.get("listing")
        if raw:
            if not str(raw).isdigit():
                return Response({"detail": "Name a listing by its number."}, status=status.HTTP_400_BAD_REQUEST)
            listing = generics.get_object_or_404(
                Listing.objects.filter(status=Listing.PUBLISHED).exclude(hidden_business_q())
                .select_related("category", "business_owner__profile"),
                pk=raw,
            )
        return Response(guard.summary(lines, listing))


class CartItemUpdateDeleteView(APIView):
    """PATCH /api/cart/items/{id}/ — update quantity.
    DELETE /api/cart/items/{id}/ — remove.

    Both enforce the item belongs to the caller's own cart via
    IsCartItemOwner (403 for another customer's item, 404 for a nonexistent
    one).
    """

    permission_classes = [IsAuthenticated, IsCustomer, IsCartItemOwner]

    def get_item(self, request, pk):
        item = generics.get_object_or_404(CartItem, pk=pk)
        self.check_object_permissions(request, item)
        return item

    def patch(self, request, pk):
        item = self.get_item(request, pk)
        serializer = CartItemUpdateSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(CartItemSerializer(item).data)

    def delete(self, request, pk):
        item = self.get_item(request, pk)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
