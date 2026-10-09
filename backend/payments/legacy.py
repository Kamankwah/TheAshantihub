"""One-off helpers for data written before a field existed."""

# Mirrors billing.Subscription.CYCLE_CHOICES (frozen here so a migration never depends on live code).
_CYCLES = (1, 3, 6, 12)


def stamp_legacy_paid_months(checkout_session_model):
    """Stamp `metadata["paid_months"]` on every successful subscription session
    that has none: the client's own cycle when it is one we sell, else 0.
    Over-counting a legacy month can only prevent a commission bonus, never
    create one. Returns how many sessions were stamped."""
    stamped = 0
    rows = checkout_session_model.objects.filter(kind="subscription", status="success")
    for session in rows.iterator():
        meta = session.metadata if isinstance(session.metadata, dict) else {}
        if "paid_months" in meta:
            continue
        try:
            months = int(meta.get("cycle_months"))
        except (TypeError, ValueError):
            months = 0
        if months not in _CYCLES:
            months = 0
        session.metadata = {**meta, "paid_months": months}
        session.save(update_fields=["metadata"])
        stamped += 1
    return stamped
