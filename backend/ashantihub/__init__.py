# Load Celery with Django so @shared_task binds to this project's app.
from .celery import app as celery_app

__all__ = ("celery_app",)
