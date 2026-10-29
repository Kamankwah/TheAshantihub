from django.db import transaction
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer
from listings.models import Listing, ListingVariant
from listings.visibility import hidden_business_q

from . import guard
from .models import Cart, CartItem
from .permissions import IsCartItemOwner
from .serializers import (
    BulkAddSerializer,
    CartItemCreateSerializer,
    CartItemSerializer,
    CartItemUpdateSerializer,
    CartSerializer,
    cart_with_lines,
)


class CartMeView(APIView):
    """GET /api/cart/ — get-or-create the caller's own cart, with items."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request):
        cart, _ = Cart.objects.get_or_create(customer=request.user)
        return Response(CartSerializer(cart_with_lines(cart.pk), context={"request": request}).data)


def _guard_lines(cart):
    """The cart's lines as the guard reads them (business, pin and category with each line)."""
    if cart is None:
        return []
    return list(cart.items.select_related("listing__business_owner__profile", "listing__category"))


class CartItemCreateView(APIView):
    """POST /api/cart/items/ — add a listing to the caller's cart. If the
    listing is already in the cart, increments quantity on the existing row
    rather than creating a duplicate line. A listing with variants takes
    `variant` or `lines: [{variant, quantity}]`: one line per variant, all added
    or none, and its price is the variant's.

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
        entries = serializer.validated_data["entries"]  # [(variant or None, quantity)], already checked as a whole

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
            saved, created = [], False
            for variant, quantity in entries:
                price = variant.effective_price if variant is not None else listing.effective_price
                item = CartItem.objects.filter(cart=cart, listing=listing, variant=variant).first()
                if item is not None:
                    # Ruling R33: adding the line again re-reads today's price (a sale that ended, or one just started).
                    item.quantity += quantity
                    item.unit_price_snapshot = price
                    item.save(update_fields=["quantity", "unit_price_snapshot"])
                else:
                    item = CartItem.objects.create(
                        cart=cart, listing=listing, variant=variant, quantity=quantity, unit_price_snapshot=price,
                    )
                    created = True
                saved.append(item)

        data = CartItemSerializer(saved, many=True).data if "lines" in request.data else CartItemSerializer(saved[0]).data
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class CartItemBulkAddView(APIView):
    """POST /api/cart/items/bulk/ {listing, lines: [{variant, quantity}]} - several variants of one listing in one
    atomic write, answering 201 with the whole cart (as GET /api/cart/). All or nothing: a line is refused when its
    variant is not one of this listing's active versions or when it (with what the cart already holds of that variant)
    is more than a counted stock; every failing line is named, by its place in `lines`, in
    400 {"lines": [{"index", "detail"}]}. A variant already in the cart has its quantity added to and its price
    re-read, like CartItemCreateView. The cart guard runs before and again under the cart's row lock; its refusal is the
    same 400 {"detail", "code"}. Lock order: the cart, then the listing row, then its variant rows by pk."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request):
        serializer = BulkAddSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        listing = serializer.validated_data["listing"]
        asked = serializer.validated_data["asked"]  # [(index, variant id, quantity)]
        if serializer.validated_data["line_errors"]:
            return Response({"lines": serializer.validated_data["line_errors"]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            guard.check_add(_guard_lines(Cart.objects.filter(customer=request.user).first()), listing)
        except guard.GuardError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            cart, _ = Cart.objects.select_for_update().get_or_create(customer=request.user)
            try:
                guard.check_add(_guard_lines(cart), listing)
            except guard.GuardError as exc:
                transaction.set_rollback(True)
                return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
            list(Listing.objects.select_for_update().filter(pk=listing.pk))
            rows = {
                row.pk: row for row in ListingVariant.objects.select_for_update()
                .filter(listing=listing, is_active=True).order_by("pk")
            }
            held = dict(CartItem.objects.filter(cart=cart, listing=listing, variant__isnull=False).values_list("variant_id", "quantity"))
            errors = []
            for index, variant_id, quantity in asked:
                row = rows.get(variant_id)
                if row is None:
                    errors.append({"index": index, "detail": "That version is not available for this listing."})
                elif row.stock_quantity is not None and held.get(variant_id, 0) + quantity > row.stock_quantity:
                    in_cart = held.get(variant_id, 0)
                    if row.stock_quantity == 0:
                        detail = f"{row.label}: sold out."
                    elif in_cart:
                        detail = f"{row.label}: only {row.stock_quantity} in stock, {in_cart} already in your cart."
                    else:
                        detail = f"{row.label}: only {row.stock_quantity} in stock."
                    errors.append({"index": index, "detail": detail})
            if errors:
                transaction.set_rollback(True)  # nothing written, not even a new empty cart
                return Response({"lines": errors}, status=status.HTTP_400_BAD_REQUEST)
            for _, variant_id, quantity in asked:
                row = rows[variant_id]
                item = CartItem.objects.filter(cart=cart, listing=listing, variant=row).first()
                if item is not None:
                    item.quantity += quantity
                    item.unit_price_snapshot = row.effective_price
                    item.save(update_fields=["quantity", "unit_price_snapshot"])
                else:
                    CartItem.objects.create(
                        cart=cart, listing=listing, variant=row, quantity=quantity, unit_price_snapshot=row.effective_price,
                    )
        return Response(
            CartSerializer(cart_with_lines(cart.pk), context={"request": request}).data, status=status.HTTP_201_CREATED,
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
        old_quantity = item.quantity
        serializer.save()
        # Ruling R33: a quantity change re-reads the listing's current price (effective_price), so a line added during
        # a sale that has since ended is charged the regular price for the new quantity. A listing whose price was
        # removed keeps the old snapshot (the line cannot be re-added, and checkout prices from the snapshot).
        if item.quantity != old_quantity:
            current = item.variant.effective_price if item.variant_id else item.listing.effective_price
            if current is not None and current != item.unit_price_snapshot:
                item.unit_price_snapshot = current
                item.save(update_fields=["unit_price_snapshot"])
        return Response(CartItemSerializer(item).data)

    def delete(self, request, pk):
        item = self.get_item(request, pk)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
