from django.urls import path

from . import views_insights

urlpatterns = [
    path("analytics/", views_insights.PeriodAnalyticsView.as_view(), name="marketing-analytics"),
]
