from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

CONNECTED, SIMULATED, NOT_CONNECTED = "connected", "simulated", "not_connected"


class NotConnected(Exception):
    """Raised when a send is attempted on a channel with no provider."""

    def __init__(self, channel, why=""):
        super().__init__(why or f"{channel} is not connected")
        self.channel = channel
        self.message = why or f"{channel} is not connected, so nothing can be sent."


@dataclass
class Message:
    channel: str
    address: str                      # phone or email; "" for in-app
    body: str
    subject: str = ""
    link_title: str = ""
    unsubscribe_url: str = ""
    recipient: object = None          # the Customer or BusinessOwner (in-app delivery needs it)
    campaign_id: Optional[int] = None


@dataclass
class SendResult:
    state: str                        # "sent" (accepted by the mail server / app), "simulated", "failed"
    ref: str = ""
    error: str = ""
    cost: Optional[Decimal] = None    # only a provider that reports a price fills it
    provider_status: str = ""         # the provider's own word for the state, kept as reported
    delivered: bool = False           # only a provider that reports delivery may set this


class Provider:
    channel = ""
    label = ""
    delivery_reports = False

    def status(self):
        return NOT_CONNECTED

    def can_send(self):
        return self.status() in (CONNECTED, SIMULATED)

    def send(self, message):          # pragma: no cover - interface
        raise NotImplementedError
