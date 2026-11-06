"""How much the shop's location can be trusted, as one word the screens turn into a label.

* `none`: no pin yet.
* `located`: the owner shared a pin (a phone fix or placed by hand). Read as "Location shared by the owner", never as checked.
* `verified`: staff verified the address and the business has a pin.
* `wrong`: staff marked the address wrong; the owner is asked to share it again.

The tier is a label, not a gate: nothing here stops a listing. It reads only fields already on the profile."""

NONE, LOCATED, VERIFIED, WRONG = "none", "located", "verified", "wrong"

LABELS = {
    LOCATED: "Location shared by the owner",
    VERIFIED: "Verified location",
    WRONG: "Location needs re-sharing",
    NONE: "",
}


def tier(profile):
    if profile is None:
        return NONE
    if profile.address_verified_at is not None and not profile.address_verified:
        return WRONG
    has_pin = profile.lat is not None and profile.lng is not None
    if profile.address_verified and has_pin:
        return VERIFIED
    return LOCATED if has_pin else NONE


def label(profile):
    return LABELS[tier(profile)]
