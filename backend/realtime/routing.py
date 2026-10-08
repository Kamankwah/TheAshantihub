from channels.routing import URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.urls import path

from .consumers import StaffConsumer

websocket_urlpatterns = [path("ws/staff/", StaffConsumer.as_asgi())]


def allowed_origins():
    # Same origins the REST API allows (CORS); "*" where CORS allows all.
    if settings.CORS_ALLOW_ALL_ORIGINS:
        return ["*"]
    return list(settings.CORS_ALLOWED_ORIGINS)


def build_websocket_app(origins=None):
    return OriginValidator(URLRouter(websocket_urlpatterns), origins if origins is not None else allowed_origins())
