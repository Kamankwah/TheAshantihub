from django.apps import AppConfig


class DeliveryConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "delivery"

    def ready(self):
        from approvals import registry

        from . import signals  # noqa: F401
        from .config import KINDS
        from .employment import EMPLOYMENT_KIND

        from reports import providers

        from .report_provider import delivery_manager_sections, dispatch_sections

        for role, fn in (("delivery_manager", delivery_manager_sections), ("dispatch", dispatch_sections)):
            if fn not in providers._ROLE_PROVIDERS.get(role, []):
                providers.register_provider(role, fn)
        for kind in (*KINDS, EMPLOYMENT_KIND):
            if registry.get_kind(kind.key) is None:
                registry.register(kind)
