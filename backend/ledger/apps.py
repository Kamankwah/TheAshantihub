from django.apps import AppConfig


class LedgerConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ledger"

    def ready(self):
        from approvals import registry

        from .approval_kinds import FEE_RULES, MONEY_SETTING, REDELIVERY_FEE_SETTING

        for kind in (FEE_RULES, MONEY_SETTING, REDELIVERY_FEE_SETTING):
            if registry.get_kind(kind.key) is None:
                registry.register(kind)
