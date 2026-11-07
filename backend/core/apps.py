from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self):
        from . import checks, jobs  # noqa: F401  (jobs connects the Celery heartbeat signals; checks registers the deploy checks)
