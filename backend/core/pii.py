"""Personal data encrypted at rest (review DB-03).

``EncryptedCharField`` / ``EncryptedDateField`` store ``enc1:<Fernet token>`` in a ``text`` column and hand the application the
plain value, so serializers, masking and views are unchanged. A dump, a backup or a read-only SQL account shows ciphertext only.

* **Mixed state is tolerated on read**: a value without the ``enc1:`` prefix is a legacy plaintext row and is returned as it is, so
  the deploy that ships this does not have to rewrite the table first. ``manage.py encrypt_pii`` (run by ``deploy.sh``) encrypts the
  rest; it is idempotent.
* **A wrong or missing key fails loudly** (``PIIKeyError``) instead of returning ciphertext to a user.
* **Ciphertext cannot be searched**, so an exact/IN/CONTAINS lookup on an encrypted field raises. Where the product must find or
  de-duplicate a value (a Ghana Card, a mobile-money number, a payout account) the model keeps a *blind index*: an HMAC of the
  normalised value under ``PII_INDEX_KEY`` in a sibling ``*_idx`` column, maintained by ``sync_indexes`` on save and queried with
  ``blind_index``. The index reveals only "same as another value", never the value.
* Rotation: ``PII_ENCRYPTION_KEYS`` is newest-first; ``encrypt_pii --reencrypt`` rewrites every value under the first key."""
import datetime
import functools
import hashlib
import hmac
import re

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.db import models
from django.db.models import lookups
from django.utils.dateparse import parse_date

PREFIX = "enc1:"


class PIIKeyError(Exception):
    """A stored value could not be decrypted with any configured key."""


@functools.lru_cache(maxsize=8)
def _ring(keys):
    return MultiFernet([Fernet(key.encode()) for key in keys])


def encrypt(plain):
    return PREFIX + _ring(tuple(settings.PII_ENCRYPTION_KEYS)).encrypt(plain.encode()).decode()


def is_encrypted(stored):
    return isinstance(stored, str) and stored.startswith(PREFIX)


def decrypt(stored):
    """The plain value of ``stored``; a legacy plaintext value (no prefix) comes back unchanged."""
    if not is_encrypted(stored):
        return stored
    try:
        return _ring(tuple(settings.PII_ENCRYPTION_KEYS)).decrypt(stored[len(PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise PIIKeyError("A stored personal value could not be decrypted: PII_ENCRYPTION_KEYS does not hold the key it was written with.") from exc


def reencrypt(stored):
    """``stored`` under the newest key (legacy plaintext is encrypted)."""
    return encrypt(decrypt(stored))


# ── Blind indexes ───────────────────────────────────────────────────────────
_WHITESPACE = re.compile(r"\s+")


def _normalise(purpose, value):
    text = "" if value is None else str(value)
    if purpose == "momo":  # a phone however it was typed: the last nine digits (accounts.phones.phone_key)
        from accounts.phones import phone_key

        return phone_key(text)
    return _WHITESPACE.sub("", text).upper()


def blind_index(purpose, value):
    """HMAC-SHA256 of the normalised value, or None when there is nothing to index. ``purpose`` separates the indexes, so the same
    digits in a Ghana Card and an account number do not collide."""
    normalised = _normalise(purpose, value)
    if not normalised:
        return None
    key = settings.PII_INDEX_KEY.encode()
    return hmac.new(key, f"{purpose}\0{normalised}".encode(), hashlib.sha256).hexdigest()


def sync_indexes(instance, indexes, kwargs):
    """Called from ``save()``: recompute each ``{field: (purpose, index_field)}`` and, for a save limited to ``update_fields``, add
    the index fields that go with the fields being saved. Mutates ``kwargs`` in place."""
    update_fields = kwargs.get("update_fields")
    extra = set()
    for field, (purpose, index_field) in indexes.items():
        if update_fields is not None and field not in update_fields:
            continue
        setattr(instance, index_field, blind_index(purpose, getattr(instance, field)))
        extra.add(index_field)
    if update_fields is not None:
        kwargs["update_fields"] = set(update_fields) | extra


# ── Fields ──────────────────────────────────────────────────────────────────
class _Unsearchable:
    """Lookups that would compare plaintext with ciphertext and silently match nothing. Fail loudly instead."""

    def as_sql(self, compiler, connection):
        raise TypeError(
            f"{self.lhs.output_field.name} is encrypted: it cannot be searched. Use its blind index (core.pii.blind_index) "
            "and the *_idx column."
        )


class _NoExact(_Unsearchable, lookups.Exact):
    pass


class _NoIExact(_Unsearchable, lookups.IExact):
    pass


class _NoIn(_Unsearchable, lookups.In):
    pass


class _NoContains(_Unsearchable, lookups.Contains):
    pass


class _NoIContains(_Unsearchable, lookups.IContains):
    pass


class _EncryptedMixin:
    def db_type(self, connection):
        return "text"

    def get_db_prep_save(self, value, connection):
        value = self._plain(value)
        return encrypt(value) if value not in (None, "") else value


def _register_guards(field_class):
    for guard in (_NoExact, _NoIExact, _NoIn, _NoContains, _NoIContains):
        field_class.register_lookup(guard)


class EncryptedCharField(_EncryptedMixin, models.CharField):
    """A CharField whose column holds ciphertext. ``max_length`` still limits the *plain* value (validation, serializers)."""

    def _plain(self, value):
        return None if value is None else str(value)

    def from_db_value(self, value, expression, connection):
        return None if value is None else decrypt(value)


class EncryptedDateField(_EncryptedMixin, models.DateField):
    """A DateField stored as encrypted ISO text. A legacy ``date`` column converted to text reads back as its ISO string."""

    def _plain(self, value):
        if value is None or value == "":
            return None
        if isinstance(value, datetime.datetime):
            value = value.date()
        return value.isoformat() if isinstance(value, datetime.date) else str(value)

    def from_db_value(self, value, expression, connection):
        if value is None or value == "":
            return None
        return parse_date(decrypt(value))


_register_guards(EncryptedCharField)
_register_guards(EncryptedDateField)
