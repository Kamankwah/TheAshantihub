from django.apps import AppConfig


class OperationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "operations"

    def ready(self):
        from reports import providers

        from .report_provider import operations_sections

        # ready() may run twice in one process; register once.
        if operations_sections not in providers._ROLE_PROVIDERS.get("operations", []):
            providers.register_provider("operations", operations_sections)
