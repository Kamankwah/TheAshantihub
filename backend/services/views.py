from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner, IsCustomer
from notifications.services import notify_business_owner, notify_customer
from payments.models import CheckoutSession
from payments.services import process_payment

from .models import ServiceRequest
from .serializers import ServiceRequestCreateSerializer, ServiceRequestSerializer


class ServiceRequestCreateView(generics.CreateAPIView):
    """POST /api/services/requests/ — a customer opens a request against a
    published service listing.
    """

    serializer_class = ServiceRequestCreateSerializer
    permission_classes = [IsAuthenticated, IsCustomer]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        listing = serializer.validated_data["listing"]
        service_request = ServiceRequest.objects.create(
            customer=request.user,
            listing=listing,
            business_owner=listing.business_owner,
            message=serializer.validated_data["message"],
            budget=serializer.validated_data.get("budget"),
        )
        notify_business_owner(
            listing.business_owner, "service_request", "New service request",
            body=f"A customer requested “{listing.name}”.",
            link="/business-dashboard", icon="🛠️",
        )
        return Response(ServiceRequestSerializer(service_request).data, status=201)


class MyServiceRequestsView(generics.ListAPIView):
    """GET /api/services/requests/mine/ — the customer's own requests."""

    serializer_class = ServiceRequestSerializer
    permission_classes = [IsAuthenticated, IsCustomer]

    def get_queryset(self):
        return ServiceRequest.objects.filter(customer=self.request.user).select_related(
            "listing", "business_owner"
        )


class IncomingServiceRequestsView(generics.ListAPIView):
    """GET /api/services/requests/incoming/ — the owner's incoming queue."""

    serializer_class = ServiceRequestSerializer
    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get_queryset(self):
        return ServiceRequest.objects.filter(business_owner=self.request.user).select_related(
            "listing", "customer"
        )


class ServiceRequestRespondView(APIView):
    """POST /api/services/requests/{id}/respond/ — the owner accepts (with an
    agreed price) or declines a requested job. Body: {action: "accept"|
    "decline", price?, reason?}.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk):
        sr = generics.get_object_or_404(ServiceRequest, pk=pk, business_owner=request.user)
        if sr.status != ServiceRequest.REQUESTED:
            return Response({"detail": "This request has already been responded to."}, status=400)

        action = request.data.get("action")
        if action == "accept":
            price = request.data.get("price")
            if price in (None, ""):
                return Response({"price": "A price is required to accept."}, status=400)
            sr.status = ServiceRequest.ACCEPTED
            sr.agreed_price = price
            sr.responded_at = timezone.now()
            sr.save(update_fields=["status", "agreed_price", "responded_at"])
            notify_customer(
                sr.customer, "service_request", "Your request was accepted",
                body=f"“{sr.listing.name}” was accepted for GHS {price}. Pay to get started.",
                link="/my-account", icon="✅",
            )
        elif action == "decline":
            sr.status = ServiceRequest.DECLINED
            sr.decline_reason = (request.data.get("reason") or "").strip()
            sr.responded_at = timezone.now()
            sr.save(update_fields=["status", "decline_reason", "responded_at"])
            notify_customer(
                sr.customer, "service_request", "Your request was declined",
                body=f"“{sr.listing.name}” was declined.",
                link="/my-account", icon="⚠️",
            )
        else:
            return Response({"action": "Must be 'accept' or 'decline'."}, status=400)
        return Response(ServiceRequestSerializer(sr).data)


class ServiceRequestPayView(APIView):
    """POST /api/services/requests/{id}/pay/ — the customer pays for an
    accepted request, which moves it to in_progress. Routes through
    process_payment (simulated mode finalizes synchronously).
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request, pk):
        sr = generics.get_object_or_404(ServiceRequest, pk=pk, customer=request.user)
        if sr.status != ServiceRequest.ACCEPTED:
            return Response({"detail": "Only an accepted request can be paid for."}, status=400)

        result = process_payment(
            kind=CheckoutSession.SERVICE_REQUEST,
            amount=sr.agreed_price,
            purpose=f"Service: {sr.listing.name}",
            customer=request.user,
            metadata={"service_request_id": sr.id},
        )
        if result["mode"] == "redirect":
            return Response(
                {"mode": "redirect", "checkout_url": result["checkout_url"], "reference": result["reference"]},
                status=status.HTTP_200_OK,
            )
        sr.refresh_from_db()
        return Response(ServiceRequestSerializer(sr).data)


class ServiceRequestProgressView(APIView):
    """POST /api/services/requests/{id}/progress/ — the owner updates the
    progress note on an in-progress job. Body: {note}.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk):
        sr = generics.get_object_or_404(ServiceRequest, pk=pk, business_owner=request.user)
        if sr.status != ServiceRequest.IN_PROGRESS:
            return Response({"detail": "Progress can only be updated on an in-progress job."}, status=400)
        sr.progress_note = (request.data.get("note") or "").strip()
        sr.save(update_fields=["progress_note"])
        notify_customer(
            sr.customer, "service_request", "Service progress update",
            body=f"Update on “{sr.listing.name}”: {sr.progress_note[:80]}",
            link="/my-account", icon="🛠️",
        )
        return Response(ServiceRequestSerializer(sr).data)


class ServiceRequestCompleteView(APIView):
    """POST /api/services/requests/{id}/complete/ — the owner marks an
    in-progress job done.
    """

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk):
        sr = generics.get_object_or_404(ServiceRequest, pk=pk, business_owner=request.user)
        if sr.status != ServiceRequest.IN_PROGRESS:
            return Response({"detail": "Only an in-progress job can be completed."}, status=400)
        sr.status = ServiceRequest.COMPLETED
        sr.completed_at = timezone.now()
        sr.save(update_fields=["status", "completed_at"])
        notify_customer(
            sr.customer, "service_request", "Service completed",
            body=f"“{sr.listing.name}” has been marked complete.",
            link="/my-account", icon="🎉",
        )
        return Response(ServiceRequestSerializer(sr).data)
