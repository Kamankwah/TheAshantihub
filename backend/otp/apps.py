from django.apps import AppConfig


class OtpConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "otp"
    verbose_name = "One-time codes"

    def ready(self):
        from approvals import registry

        from .approval_kinds import RECOVERY_KIND

        if registry.get_kind(RECOVERY_KIND.key) is None:
            registry.register(RECOVERY_KIND)
