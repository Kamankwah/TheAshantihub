from django.urls import path

from . import views_setup as v

from .views_hubtel import HubtelSmsCallbackView

urlpatterns = [
    path("sms/hubtel/callback/<str:token>/", HubtelSmsCallbackView.as_view(), name="marketing-hubtel-sms-callback"),
    path("templates/", v.TemplatesView.as_view(), name="marketing-templates"),
    path("templates/<int:pk>/", v.TemplateDetailView.as_view(), name="marketing-template"),
    path("templates/<int:pk>/meta/", v.TemplateMetaView.as_view(), name="marketing-template-meta"),
    path("providers/", v.ProvidersView.as_view(), name="marketing-providers"),
    path("sender-ids/", v.SenderIdsView.as_view(), name="marketing-sender-ids"),
    path("sender-ids/<int:pk>/", v.SenderIdDetailView.as_view(), name="marketing-sender-id"),
    path("provider-steps/<int:pk>/", v.ProviderStepView.as_view(), name="marketing-provider-step"),
]
