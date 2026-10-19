from django.apps import AppConfig


class WalletsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wallets"
    verbose_name = "Wallets"

    def ready(self):
        from approvals import registry

        from .approval_kinds import WITHDRAWAL_RESOLUTION

        if registry.get_kind(WITHDRAWAL_RESOLUTION.key) is None:
            registry.register(WITHDRAWAL_RESOLUTION)
