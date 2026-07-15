from django.urls import path

from . import views

# Mounted at /api/hero/ in ashantihub/urls.py — the public/business-facing
# hero-media routes, kept separate from listings/urls.py's /api/listings/hero/
# staff-moderation routes per the roadmap's explicit top-level paths
# (GET /api/hero/active/, POST /api/hero/{id}/extend/).
urlpatterns = [
    path("active/", views.HeroActiveListView.as_view(), name="hero-active-list"),
    path("submit/", views.HeroSubmitView.as_view(), name="hero-submit"),
    path("mine/", views.HeroMineView.as_view(), name="hero-mine"),
    path("<int:pk>/extend/", views.HeroExtendView.as_view(), name="hero-extend"),
]
