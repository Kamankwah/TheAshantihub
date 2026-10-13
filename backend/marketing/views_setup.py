"""Templates and Sender IDs & providers (staff; campaigns.manage). Statuses from Meta and the networks are recorded by hand."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission

from . import setup_registers as reg
from .models_campaigns import ProviderStep, SenderId, Template
from .providers import provider_status


class _Base(APIView):
    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def guard(self, fn):
        try:
            return fn()
        except reg.RegisterError as exc:
            return Response({"detail": exc.message}, status=exc.status)


def _template(pk):
    return Template.objects.filter(pk=pk, archived_at__isnull=True).select_related("meta_recorded_by", "updated_by").first()


class TemplatesView(_Base):
    """GET templates/ — SMS and WhatsApp templates. POST — a new one."""

    def get(self, request):
        rows = [reg.template_body(t) for t in Template.objects.filter(archived_at__isnull=True).select_related("meta_recorded_by", "updated_by")]
        wa = [r for r in rows if r["channel"] == "whatsapp"]
        counts = {k: sum(1 for r in wa if r["meta_status"] == k) for k in ("approved", "waiting", "rejected", "not_submitted")}
        return Response({"sms": [r for r in rows if r["channel"] == "sms"], "whatsapp": wa, "whatsapp_counts": counts, "whatsapp_provider": provider_status("whatsapp"),
                         "sms_provider": provider_status("sms"), "stop_footer_length": __import__("marketing.messages", fromlist=["x"]).sample_footer_length()})

    def post(self, request):
        def go():
            t = reg.save_template(request.user, request.data if isinstance(request.data, dict) else {})
            return Response(reg.template_body(t), status=status.HTTP_201_CREATED)
        return self.guard(go)


class TemplateDetailView(_Base):
    def patch(self, request, pk):
        t = _template(pk)
        if t is None:
            return Response({"detail": "Not found."}, status=404)
        return self.guard(lambda: Response(reg.template_body(reg.save_template(request.user, request.data if isinstance(request.data, dict) else {}, t))))

    def delete(self, request, pk):
        t = _template(pk)
        if t is None:
            return Response({"detail": "Not found."}, status=404)

        def go():
            reg.archive_template(t)
            return Response(status=204)
        return self.guard(go)


class TemplateMetaView(_Base):
    """POST templates/<id>/meta/ {status, note} — what Meta answered, as a person records it."""

    def post(self, request, pk):
        t = _template(pk)
        if t is None:
            return Response({"detail": "Not found."}, status=404)
        data = request.data if isinstance(request.data, dict) else {}
        return self.guard(lambda: Response(reg.template_body(reg.record_meta(request.user, t, data.get("status"), data.get("note")))))


class ProvidersView(_Base):
    """GET providers/ — the screen: SMS, WhatsApp checklist, email, in-app, and the sender-ID register."""

    def get(self, request):
        return Response(reg.overview())


class SenderIdsView(_Base):
    def post(self, request):
        def go():
            s = reg.save_sender(request.user, request.data if isinstance(request.data, dict) else {})
            return Response(reg.sender_body(s), status=status.HTTP_201_CREATED)
        return self.guard(go)


class SenderIdDetailView(_Base):
    def patch(self, request, pk):
        s = SenderId.objects.filter(pk=pk).first()
        if s is None:
            return Response({"detail": "Not found."}, status=404)
        return self.guard(lambda: Response(reg.sender_body(reg.save_sender(request.user, request.data if isinstance(request.data, dict) else {}, s))))

    def delete(self, request, pk):
        s = SenderId.objects.filter(pk=pk).first()
        if s is None:
            return Response({"detail": "Not found."}, status=404)
        s.delete()
        return Response(status=204)


class ProviderStepView(_Base):
    """POST provider-steps/<id>/ {status, note} — tick a WhatsApp setup step. Only a person ticks one."""

    def post(self, request, pk):
        step = ProviderStep.objects.filter(pk=pk).first()
        if step is None:
            return Response({"detail": "Not found."}, status=404)
        data = request.data if isinstance(request.data, dict) else {}
        return self.guard(lambda: Response(reg.step_body(reg.record_step(request.user, step, data.get("status"), data.get("note")))))
