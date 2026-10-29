"""Fixtures for the wallets tests (not test cases themselves)."""
from datetime import timedelta

from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts.authentication import issue_token
from accounts.models import BusinessOwnerProfile
from ledger import posting
from ledger.models import Account
from otp import step_up
from otp.identity import ref
from wallets.models import PayoutDestination

MOMO_NUMBER = "+233241234567"


class Holder:
    """A signed-in customer or business owner: an API client, and step-up tokens minted for that sign-in (the code
    exchange itself is tested in otp and in test_guards)."""

    def __init__(self, account, kind):
        self.account = account
        self.access = issue_token(account, kind)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access}")

    def step_up(self, action):
        request = RequestFactory().post("/")
        request.auth = AccessToken(self.access)
        return step_up.issue(self.account, action, request)

    def post(self, url, body=None, *, action=None, token=None):
        headers = {}
        if token is None and action is not None:
            token = self.step_up(action)
        if token is not None:
            headers["HTTP_X_STEP_UP_TOKEN"] = token
        return self.client.post(url, body or {}, format="json", **headers)

    def get(self, url, params=None):
        return self.client.get(url, params or {})


def verify_identity(owner, **profile_fields):
    """Staff have approved this business owner's identity documents (BusinessOwnerProfile.identity_status), which is
    what lets a payout destination match the owner's name or business name. Creates the profile if there is none."""
    profile, _ = BusinessOwnerProfile.objects.get_or_create(business_owner=owner, defaults=profile_fields)
    profile.identity_status = BusinessOwnerProfile.IDENTITY_VERIFIED
    profile.save(update_fields=["identity_status"])
    return owner


def fund(kind, owner, pesewas, key):
    """Money in a holder's balance through provider clearing, as a top-up (customer) or a release (vendor) leaves it."""
    posting.post(key=key, kind="test_fund", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas), posting.credit(posting.account_for(kind, owner), pesewas),
    ])


def destination(holder, *, number=MOMO_NUMBER, usable=True, name="Ama Owusu", rail=PayoutDestination.MOMO, institution="MTN"):
    """A payout destination made directly (adding one through the API is tested in test_destinations)."""
    holder_type, holder_id = ref(holder)
    return PayoutDestination.objects.create(
        holder_type=holder_type, holder_id=holder_id, rail=rail, institution=institution, account_number=number,
        account_name=name, matched_name=name, name_source="simulated",
        usable_from=timezone.now() + (timedelta(hours=-1) if usable else timedelta(hours=24)),
    )
