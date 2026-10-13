from django.apps import AppConfig


class InsightsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "insights"

    def ready(self):
        from reports import providers

        from .report_provider import accountant_sections

        # ready() may run twice in one process; register once.
        if accountant_sections not in providers._ROLE_PROVIDERS.get("accountant", []):
            providers.register_provider("accountant", accountant_sections)
