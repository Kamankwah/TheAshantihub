"""The Plus Code (Open Location Code) of a shop pin. Computed on read from the stored coordinates, never stored, so it
can never disagree with the pin."""
from openlocationcode import openlocationcode


def encode(lat, lng):
    """The 10-digit global code, e.g. `6CRWM9QG+C6` (11 characters including the `+`)."""
    return openlocationcode.encode(float(lat), float(lng))
