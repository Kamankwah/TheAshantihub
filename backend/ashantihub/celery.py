import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ashantihub.settings")

# Worker: celery -A ashantihub worker   ·   Scheduler: celery -A ashantihub beat
# Settings prefixed CELERY_ in ashantihub/settings.py configure it; tasks are
# @shared_task functions in each app's tasks.py.
app = Celery("ashantihub")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
