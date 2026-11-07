"""The personal data AshantiHub holds about the signed-in customer or business owner (review DB-04; Ghana Data Protection Act
2012: a person may ask what is held about them). One JSON document, built from the person's own rows only.

What is left out on purpose: the password hash and verification codes (secrets, not information about the person); other people's
data (a business owner's export does not list the customers who ordered from them); internal staff notes; fraud and risk flags.
Identity and payout numbers are masked to their last digits, as everywhere else in the app: the export travels over the same
short-lived token as the rest of the session, so it must not be the way to lift a full Ghana Card number from a stolen phone."""
from django.utils import timezone

from .serializers import mask_but_last

SCHEMA = 1


def _iso(value):
    return value.isoformat() if value else None


def _common(account, account_type):
    from marketing.models_consent import ConsentRecord
    from messaging.models import Conversation, Message
    from notifications.models import Notification
    from wallets.models import PayoutDestination

    owner_filter = {"customer": account} if account_type == "customer" else {"business_owner": account}
    conversations = []
    for conversation in Conversation.objects.filter(**owner_filter).order_by("created_at"):
        messages = [
            {"at": _iso(m.created_at), "from": m.sender_type, "text": m.body}
            for m in Message.objects.filter(conversation=conversation, kind=Message.MESSAGE, is_internal=False).order_by("created_at")
        ]
        conversations.append({"subject": conversation.subject, "status": conversation.status, "messages": messages})
    return {
        "payout_destinations": [
            {
                "kind": d.rail, "institution": d.institution, "number": mask_but_last(d.account_number, keep=3),
                "name": d.account_name, "added_at": _iso(d.created_at), "removed_at": _iso(d.removed_at),
            }
            for d in PayoutDestination.objects.filter(holder_type=account_type, holder_id=account.pk).order_by("created_at")
        ],
        "marketing_consent": [
            {"channel": r.channel, "status": r.status, "source": r.source, "at": _iso(r.at)}
            for r in ConsentRecord.objects.filter(**owner_filter).order_by("at")
        ],
        "support_conversations": conversations,
        "notifications": [
            {"at": _iso(n.created_at), "title": n.title, "body": n.body}
            for n in Notification.objects.filter(**owner_filter).order_by("created_at")
        ],
    }


def _customer(customer):
    from orders.models import Order

    orders = []
    for order in Order.objects.filter(customer=customer).prefetch_related("items__listing").order_by("placed_at"):
        orders.append({
            "id": order.pk, "placed_at": _iso(order.placed_at), "status": order.status,
            "delivery_status": order.delivery_status, "delivery_method": order.delivery_method,
            "total_amount": str(order.total_amount),
            "delivery": {
                "address": order.delivery_address, "phone": order.delivery_phone, "gps_address": order.delivery_gps_address,
                "landmark": order.delivery_landmark,
            },
            "items": [{"name": i.line_name, "quantity": i.quantity, "line_total": str(i.line_total)} for i in order.items.all()],
        })
    return {
        "profile": {
            "full_name": customer.full_name, "phone": customer.phone, "email": customer.email, "address": customer.address,
            "gender": customer.gender, "date_of_birth": _iso(customer.date_of_birth),
            "secondary_email": customer.secondary_email, "secondary_phone": customer.secondary_phone,
            "email_notifications": customer.email_notifications_enabled, "sms_notifications": customer.sms_notifications_enabled,
            "joined_at": _iso(customer.created_at),
        },
        "addresses": [
            {
                "label": a.label, "recipient_name": a.recipient_name, "phone": a.phone, "gps_address": a.gps_address,
                "landmark": a.landmark, "address_text": a.address_text, "is_default": a.is_default,
            }
            for a in customer.addresses.all()
        ],
        "orders": orders,
    }


def _business_owner(owner):
    from listings.models import Listing

    profile = getattr(owner, "profile", None)
    business = {}
    if profile is not None:
        business = {
            "business_name": profile.business_name, "business_contact_phone": profile.business_contact_phone,
            "gps_address": profile.gps_address, "landmark": profile.landmark, "business_kind": profile.business_kind,
            "business_description": profile.business_description,
            "ghana_card_number": mask_but_last(profile.ghana_card_number, keep=3), "tin": mask_but_last(profile.tin, keep=3),
            "identity_status": profile.identity_status,
            "payout_bank_name": profile.payout_bank_name,
            "payout_bank_account_number": mask_but_last(profile.payout_bank_account_number, keep=3),
            "payout_bank_account_name": profile.payout_bank_account_name,
            "payout_momo_network": profile.payout_momo_network,
            "payout_momo_number": mask_but_last(profile.payout_momo_number, keep=3), "payout_momo_name": profile.payout_momo_name,
            "documents_on_file": {
                "ghana_card_front": bool(profile.ghana_card_front_image), "ghana_card_back": bool(profile.ghana_card_back_image),
                "business_registration": bool(profile.business_reg_certificate), "signboard_photo": bool(profile.signboard_photo),
            },
        }
    return {
        "profile": {
            "full_name": owner.full_name, "login_phone": owner.login_phone, "email": owner.email, "joined_at": _iso(owner.created_at),
        },
        "business": business,
        "listings": [
            {"id": l.pk, "name": l.name, "status": l.status, "created_at": _iso(l.created_at)}
            for l in Listing.objects.filter(business_owner=owner).order_by("created_at")
        ],
    }


def build(account, account_type):
    body = _customer(account) if account_type == "customer" else _business_owner(account)
    body.update(_common(account, account_type))
    return {"schema": SCHEMA, "generated_at": timezone.now().isoformat(), "account_type": account_type, **body}
