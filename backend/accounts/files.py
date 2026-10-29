"""Deleting stored files that a save replaced (KYC photos, Ghana Card photos, the registration certificate).

Uploaded files under /media/ stay on disk (and are served publicly by nginx) until someone deletes them, so a path
that replaces one deletes the old file. Only after commit: a rolled-back request keeps the file its row still names.
A file that can't be deleted is logged, never raised."""
import logging

from django.core.files.storage import default_storage
from django.db import transaction

logger = logging.getLogger(__name__)


def replaced_names(instance, fields, new_values):
    """The stored file names on `instance` that `new_values` (a validated-data dict) replaces or clears."""
    names = []
    for field in fields:
        if field not in new_values:
            continue
        old = getattr(instance, field)
        new = new_values[field]
        if old and getattr(new, "name", new) != old.name:
            names.append(old.name)
    return names


def delete_files(names):
    """Delete these stored files now; a failure is logged and the rest are still tried."""
    for name in names:
        try:
            default_storage.delete(name)
        except Exception:
            logger.exception("Couldn't delete replaced file %s", name)


def delete_after_commit(names):
    """Delete these stored files once the current transaction commits (never on rollback)."""
    names = [name for name in names if name]
    if names:
        transaction.on_commit(lambda: delete_files(names))
