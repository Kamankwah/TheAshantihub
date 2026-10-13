"""Read-only status of every outside service, worked out from which settings are
present. Nothing here reaches the provider and no key, secret or address is ever
returned: only whether a setting exists and the names of the ones still missing."""
from django.conf import settings

CONNECTED, SIMULATED, NOT_CONNECTED = "connected", "simulated", "not_connected"

HUBTEL_SETTINGS = [
    ("HUBTEL_CLIENT_ID", "client id"), ("HUBTEL_CLIENT_SECRET", "client secret"), ("HUBTEL_MERCHANT_ACCOUNT", "merchant account"),
    ("HUBTEL_WEBHOOK_SECRET", "webhook secret"), ("HUBTEL_CALLBACK_URL", "callback address"),
]


def _item(key, name, status, provider, summary, missing=(), note=""):
    return {"key": key, "name": name, "status": status, "provider": provider, "summary": summary, "missing": list(missing), "note": note}


def _payments():
    absent = [f"Hubtel {label}" for var, label in HUBTEL_SETTINGS if not getattr(settings, var, "")]
    if settings.PAYMENTS_PROVIDER == "simulated":
        return _item(
            "payments", "Payments", SIMULATED, "Simulated (Hubtel not connected)",
            "Every payment is a simulation: no real money moves and nothing is charged.",
            absent or ["Switch to Hubtel by setting the Hubtel client id on the server"],
            "Keys live in the server's environment. They are never typed into AshantiHub and never shown.",
        )
    return _item(
        "payments", "Payments", CONNECTED, "Hubtel", "Hubtel keys are set on the server.", absent,
        "This shows the keys exist. It does not call Hubtel.",
    )


def _email():
    real = settings.EMAIL_BACKEND.endswith("smtp.EmailBackend") and bool(settings.EMAIL_HOST)
    if real:
        missing = [] if settings.EMAIL_HOST_USER else ["Mail account name (the server may not need one)"]
        return _item("email", "Email", CONNECTED, "Mail server (SMTP)", "Invitations, sign-in links and notices are sent by email.", missing)
    return _item(
        "email", "Email", NOT_CONNECTED, "None (messages are written to the server log)",
        "Email is not being sent: messages are only logged.", ["A mail server and sending backend set on the server"],
    )


def _sms():
    if getattr(settings, "MARKETING_SMS_PROVIDER", "") == "hubtel":
        missing = [label for label, value in (("Hubtel SMS client id", settings.HUBTEL_SMS_CLIENT_ID), ("Hubtel SMS client secret", settings.HUBTEL_SMS_CLIENT_SECRET), ("Sender ID name", settings.HUBTEL_SMS_SENDER_ID)) if not value]
        if missing:
            return _item("sms", "SMS", NOT_CONNECTED, "Hubtel (not fully set up)", "SMS is set to Hubtel but cannot send until the missing values are set.", missing)
        return _item("sms", "SMS", CONNECTED, "Hubtel SMS", "Marketing SMS is sent through Hubtel. Delivery is shown only where Hubtel reports it.")
    if getattr(settings, "MARKETING_SMS_PROVIDER", "") == "simulated":
        return _item("sms", "SMS", SIMULATED, "Simulated (no provider)", "Marketing SMS is simulated: nothing is sent to anyone.", ["An SMS provider and its keys (not built yet)"])
    return _item("sms", "SMS", NOT_CONNECTED, "None", "AshantiHub sends no text messages. There is no SMS balance to show.", ["An SMS provider and its keys (not built yet)"])


def _whatsapp():
    if getattr(settings, "MARKETING_WHATSAPP_PROVIDER", "") == "simulated":
        return _item("whatsapp", "WhatsApp", SIMULATED, "Simulated (no provider)", "Marketing WhatsApp is simulated: nothing is sent to anyone.", ["A WhatsApp Business connection (not built yet)"])
    return _item(
        "whatsapp", "WhatsApp", NOT_CONNECTED, "None (link only)",
        "AshantiHub sends no WhatsApp messages. Visitors can open a chat with the support number through a link.",
        ["A WhatsApp Business connection (not built yet)"],
    )


def _push():
    return _item("push", "Push notifications", NOT_CONNECTED, "None", "Staff and customers get in-app notices only.", ["A push service (not built yet)"])


def _maps():
    return [
        _item("maps", "Maps", CONNECTED, "OpenStreetMap tiles (no key)", "Maps show OpenStreetMap tiles in the browser. No key is needed and none is stored."),
        _item("routing", "Road distance", NOT_CONNECTED, "None", "No route or road-distance service is connected, so nothing is priced by distance.", ["A routing service (arrives with the Delivery phase)"]),
    ]


def _errors():
    if settings.SENTRY_DSN:
        return _item(
            "errors", "Error alerts", CONNECTED, "Sentry", "Errors are sent to Sentry.", [],
            "This shows the connection is set. AshantiHub does not read errors back from Sentry, so look there for recent ones.",
        )
    return _item("errors", "Error alerts", NOT_CONNECTED, "None", "Errors are not being reported anywhere.", ["A Sentry address set on the server"])


def statuses():
    return [_payments(), _sms(), _whatsapp(), _push(), _email(), *_maps(), _errors()]
