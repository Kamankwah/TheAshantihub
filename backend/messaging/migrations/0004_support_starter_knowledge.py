from django.db import migrations

SIGN = "{agent_first_name}, AshantiHub Support"

# Starter copy only: uses=0, no author ("AshantiHub default"), safe to edit or
# retire. No phone numbers or WhatsApp links (the same rule the API enforces).
REPLIES = [
    ("Welcome, how can we help?", "/hi", "anyone",
     "Hi {customer_first_name}, thanks for contacting AshantiHub Support. How can we help you today? " + SIGN),
    ("Order out for delivery", "/out", "customers",
     "Hi {customer_first_name}, order {order_number} from {business_name} is on its way to you. " + SIGN),
    ("We can't share the business's number", "/no-number", "customers",
     "Hi {customer_first_name}, for everyone's safety AshantiHub does not share a business's phone number, and "
     "businesses cannot contact you directly. Tell us what you need and we will take it up with {business_name} "
     "for you. " + SIGN),
    ("Rider running late", "/late", "customers",
     "Hi {customer_first_name}, {rider_first_name} is running a little late with order {order_number} from "
     "{business_name} and now expects to reach you by {eta}. Sorry for the wait. " + SIGN),
    ("Refund is with Accounting", "/refund", "customers",
     "Hi {customer_first_name}, your refund request for order {order_number} is with our Accounting team. "
     "We will update you here as soon as there is a decision. " + SIGN),
    ("Return booked", "/return", "customers",
     "Hi {customer_first_name}, we have booked the return for order {order_number}. We will tell you here what "
     "happens next. " + SIGN),
    ("Pay your subscription in the app", "/renew", "owners",
     "Hi {customer_first_name}, you can renew your AshantiHub subscription from your business dashboard. "
     "If the payment does not go through, tell us here and we will help. " + SIGN),
    ("Late delivery apology", "/sorry-late", "customers",
     "Hi {customer_first_name}, we are sorry order {order_number} from {business_name} reached you late. "
     "We have noted it. " + SIGN),
]

TAGS = [
    ("delivery", "Any delivery question or problem"),
    ("business-owner", "A business owner wrote in"),
    ("late-rider", "Rider running late"),
    ("refund-request", "Customer asks for money back"),
    ("return", "Returns and wrong sizes"),
    ("subscription", "Business subscription and invoices"),
    ("listing-report", "Someone reports a listing"),
    ("account-access", "Sign-in and password help"),
    ("missing-item", "Item missing from an order"),
    ("payment", "Payment problems and questions"),
]


def seed(apps, schema_editor):
    CannedReply = apps.get_model("messaging", "CannedReply")
    ConversationTag = apps.get_model("messaging", "ConversationTag")
    for title, shortcut, audience, body in REPLIES:
        CannedReply.objects.get_or_create(
            shortcut=shortcut, defaults={"title": title, "audience": audience, "body": body, "uses": 0}
        )
    for name, description in TAGS:
        ConversationTag.objects.get_or_create(name=name, defaults={"description": description})


class Migration(migrations.Migration):
    dependencies = [("messaging", "0003_support_desk")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
