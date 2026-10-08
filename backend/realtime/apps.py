from django.apps import AppConfig


class RealtimeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "realtime"

    def ready(self):
        # Every activity event is published after its transaction commits.
        from activity import services

        from .publish import publish_activity

        if publish_activity not in services.on_recorded:
            services.on_recorded.append(publish_activity)
