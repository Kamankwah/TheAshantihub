from django.urls import path

from . import views_banners as v

urlpatterns = [
    # Staff (site_promo.manage)
    path("site-banners/", v.BannerListCreateView.as_view(), name="marketing-site-banners"),
    path("site-banners/<int:pk>/", v.BannerDetailView.as_view(), name="marketing-site-banner"),
    path("site-banners/<int:pk>/submit/", v.BannerActionView.as_view(action="submit"), name="marketing-banner-submit"),
    path("site-banners/<int:pk>/publish/", v.BannerActionView.as_view(action="publish"), name="marketing-banner-publish"),
    path("site-banners/<int:pk>/withdraw/", v.BannerActionView.as_view(action="withdraw"), name="marketing-banner-withdraw"),
    path("site-banners/<int:pk>/take-down/", v.BannerActionView.as_view(action="take-down"), name="marketing-banner-take-down"),
    path("site-banners/<int:pk>/reschedule/", v.BannerActionView.as_view(action="reschedule"), name="marketing-banner-reschedule"),
    path("featured/grid/", v.FeaturedGridView.as_view(), name="marketing-featured-grid"),
    path("featured/candidates/", v.FeaturedCandidatesView.as_view(), name="marketing-featured-candidates"),
    path("featured/bookings/", v.FeaturedBookView.as_view(), name="marketing-featured-book"),
    path("featured/bookings/<int:pk>/release/", v.FeaturedReleaseView.as_view(), name="marketing-featured-release"),
    # Public (no sign-in, no personal data)
    path("banners/", v.PublicBannersView.as_view(), name="marketing-public-banners"),
    path("banners/<int:pk>/view/", v.BannerBeaconView.as_view(kind="view"), name="marketing-banner-view"),
    path("banners/<int:pk>/click/", v.BannerBeaconView.as_view(kind="click"), name="marketing-banner-click"),
    path("featured/home/", v.PublicFeaturedView.as_view(), name="marketing-public-featured"),
]
