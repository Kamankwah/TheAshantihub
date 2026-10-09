from django.apps import AppConfig


class CommissionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "commission"

    def ready(self):
        from approvals import registry
        from fraud import services as fraud_services

        from . import services
        from .approval_kinds import COMMISSION_POLICY

        if registry.get_kind(COMMISSION_POLICY.key) is None:
            registry.register(COMMISSION_POLICY)
        # A confirmed duplicate / fake case reverses unreleased commission.
        if services.reverse_for_flag not in fraud_services.ON_CONFIRMED:
            fraud_services.ON_CONFIRMED.append(services.reverse_for_flag)
