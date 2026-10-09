from django.apps import AppConfig


class TargetsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "targets"

    def ready(self):
        from approvals import registry

        from .approval_kinds import TARGETS_CUT

        if registry.get_kind(TARGETS_CUT.key) is None:
            registry.register(TARGETS_CUT)

        from reports import providers

        from .report_provider import scout_sections

        # ready() may run twice in one process; register once.
        if scout_sections not in providers._ROLE_PROVIDERS.get("scout", []):
            providers.register_provider("scout", scout_sections)
