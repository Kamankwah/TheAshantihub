from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import business_terms


class BusinessTermsView(APIView):
    """The current Business Agreement summary and its version. Public: it is read before an account exists."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "business_terms"

    def get(self, request):
        return Response(business_terms.current())
