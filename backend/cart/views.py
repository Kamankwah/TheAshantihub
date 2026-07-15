from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer

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


class CartItemCreateView(APIView):
    """POST /api/cart/items/ — add a listing to the caller's cart. If the
    listing is already in the cart, increments quantity on the existing row
    rather than creating a duplicate line.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request):
        serializer = CartItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        listing = serializer.validated_data["listing"]
        quantity = serializer.validated_data["quantity"]

        if listing.price_amount is None:
            return Response(
                {"listing": "This listing has no price set and cannot be added to cart."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cart, _ = Cart.objects.get_or_create(customer=request.user)
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
