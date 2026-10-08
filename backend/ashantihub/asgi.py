import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ashantihub.settings")
# Initialise Django before importing anything that touches models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter  # noqa: E402

# HTTP and (from Task 10) WebSockets from one process type — gunicorn with
# uvicorn workers in production, daphne's runserver locally.
application = ProtocolTypeRouter({"http": django_asgi_app})
