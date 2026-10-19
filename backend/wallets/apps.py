from django.apps import AppConfig


class WalletsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "wallets"
    verbose_name = "Wallets"

    def ready(self):
        from approvals import registry

        from .approval_kinds import WITHDRAWAL_RESOLUTION
        from .holder_details import HOLDER_DETAILS_EDIT

        for kind in (WITHDRAWAL_RESOLUTION, HOLDER_DETAILS_EDIT):
            if registry.get_kind(kind.key) is None:
                registry.register(kind)
