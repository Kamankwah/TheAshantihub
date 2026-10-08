import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ashantihub.settings")
# Initialise Django before importing anything that touches models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter  # noqa: E402

from realtime.routing import build_websocket_app  # noqa: E402

# This app serves /ws/staff/ (and HTTP) for the `realtime` service in
# production (gunicorn with uvicorn workers) and for daphne's runserver
# locally. Production HTTP stays on sync gunicorn WSGI (ashantihub.wsgi).
application = ProtocolTypeRouter({"http": django_asgi_app, "websocket": build_websocket_app()})
