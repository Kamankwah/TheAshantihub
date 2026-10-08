from django.apps import AppConfig


class PortfolioConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "portfolio"

    def ready(self):
        # The portfolio app's approval kinds (business.kyc; Task 9 adds the scout
        # change kinds). ready() runs once per process; the guard keeps a second
        # call harmless.
        from approvals import registry

        from .approval_kinds import KINDS

        for kind in KINDS:
            if registry.get_kind(kind.key) is None:
                registry.register(kind)
