from django.apps import AppConfig


class MessagingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "messaging"

    def ready(self):
        from reports import providers

        from .report_provider import support_sections

        # ready() may run twice in one process; register once.
        if support_sections not in providers._ROLE_PROVIDERS.get("support", []):
            providers.register_provider("support", support_sections)
