from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from accounts.permissions import HasRolePermission

from .models import SiteSettings
from .serializers import SiteSettingsSerializer


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok"})


class SiteSettingsView(generics.RetrieveUpdateAPIView):
    """GET is public; PATCH (partial update) requires site_settings.manage.

    Always operates on the singleton row via SiteSettings.load(), which
    self-heals (get_or_create) if the row doesn't exist yet rather than
    ever 404ing.
    """

    serializer_class = SiteSettingsSerializer

    def get_permissions(self):
        if self.request.method in ("PATCH", "PUT"):
            return [HasRolePermission("site_settings.manage")]
        return [AllowAny()]

    def get_object(self):
        return SiteSettings.load()
