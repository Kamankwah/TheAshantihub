"""The Business Agreement summary every business owner accepts, served to the apps (review MOB-17).

One text, one place: the mobile app fetches it from `GET /api/accounts/business-terms/` instead of carrying its own copy, and a
test (`accounts/tests/test_business_terms.py`) keeps the web copy in `frontend/components/businessTerms.js` identical.
The version is `settings.OWNER_TERMS_VERSION`, the same string recorded with each acceptance. Change the text and the version together.
"""
from django.conf import settings

TEXT = """AshantiHub Business Agreement (summary)

1. Listing Accuracy — Every listing you publish must accurately represent a real, operating business you own or are authorized to represent. Misleading names, prices, or photos may result in listing removal.

2. Customer Contact — For customer safety, all enquiries are routed through AshantiHub Support rather than direct to your phone or WhatsApp. You may discuss and resolve enquiries with AshantiHub Support, but must not attempt to contact customers directly outside the platform, and must not use contact details obtained through AshantiHub for unrelated marketing.

3. Payout Terms — Payouts are made to the bank or mobile money account you provide. You are responsible for keeping these details accurate and up to date; AshantiHub is not liable for payouts sent to details you failed to update. A service fee may apply to processed payouts.

4. KYC Accuracy — The Ghana Card and business details you provide must be accurate and current. Misrepresentation is grounds for account suspension.

5. Suspension & Termination — AshantiHub may suspend or terminate a business account for fraudulent listings, repeated customer complaints, or violation of these terms."""


def current():
    return {"version": settings.OWNER_TERMS_VERSION, "text": TEXT}
