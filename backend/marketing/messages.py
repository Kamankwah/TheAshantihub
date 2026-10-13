"""The text of a message: what a person wrote, the stop link, the tracked link, and how many SMS it takes."""
import re

from django.conf import settings

from . import consent

GSM7 = set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà")
GSM7_EXT = set("^{}\\[~]|€")
LINK = "{link}"
PHONE_RE = re.compile(r"(?:\+?233|\b0)[\s-]?[235]\d[\s-]?\d{3}[\s-]?\d{4}\b")
CONTACT_WORDS = re.compile(r"whatsapp|wa\.me|call me|dial \d", re.I)


def base_url():
    return settings.FRONTEND_BASE_URL.rstrip("/")


def stop_url(token):
    return f"{base_url()}/unsubscribe/{token}"


def link_url(click_token):
    return f"{base_url()}/r/{click_token}"


def stop_footer(token):
    return f"Stop: {stop_url(token)}"


def sample_footer_length():
    return len(stop_footer("r-" + "x" * 12)) + 1     # the footer and the space before it


def sms_encoding(text):
    """('gsm7'|'ucs2', length) - characters outside the GSM set (such as the cedi sign) make an SMS 70 characters, not 160."""
    length = 0
    for ch in text:
        if ch in GSM7:
            length += 1
        elif ch in GSM7_EXT:
            length += 2
        else:
            return "ucs2", len(text)
    return "gsm7", length


def sms_segments(text):
    encoding, length = sms_encoding(text)
    if length == 0:
        return 1
    single, multi = (160, 153) if encoding == "gsm7" else (70, 67)
    return 1 if length <= single else -(-length // multi)


def contact_problem(body):
    """A message from AshantiHub never carries a business's phone number or WhatsApp invitation."""
    if PHONE_RE.search(body or "") or CONTACT_WORDS.search(body or ""):
        return "The message contains a phone number or a WhatsApp or call invitation. Marketing messages never carry a business's contact details: customers reach businesses only through AshantiHub."
    return None


def render(campaign, recipient=None, example=False):
    """The text one person receives. The stop link is always added (it cannot be removed)."""
    click = recipient.click_token if recipient else ("x" * 12 if example else "")
    body = (campaign.body or "").replace(LINK, link_url(click) if (campaign.link_path and click) else base_url() + (campaign.link_path or ""))
    token = consent.short_stop_token(recipient) if recipient else "r-" + "x" * 12
    if campaign.channel == "sms":
        return f"{body.strip()} {stop_footer(token)}"
    if campaign.channel == "whatsapp":
        return body.strip()          # WhatsApp templates carry a "Stop offers" button instead
    return body.strip()


def total_length(campaign):
    return len(render(campaign, example=True))
