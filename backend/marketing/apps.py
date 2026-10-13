from django.apps import AppConfig


class MarketingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "marketing"

    def ready(self):
        from approvals import registry

        from . import approval_kinds

        # ready() may run twice in one process; register once.
        for kind in approval_kinds.KINDS:
            if registry.get_kind(kind.key) is None:
                registry.register(kind)

        from reports import providers

        from .report_provider import marketing_sections

        if marketing_sections not in providers._ROLE_PROVIDERS.get("marketing", []):
            providers.register_provider("marketing", marketing_sections)
