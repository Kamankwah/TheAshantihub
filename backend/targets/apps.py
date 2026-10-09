from django.apps import AppConfig


class TargetsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "targets"

    def ready(self):
        from approvals import registry

        from .approval_kinds import TARGETS_CUT

        if registry.get_kind(TARGETS_CUT.key) is None:
            registry.register(TARGETS_CUT)
