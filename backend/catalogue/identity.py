"""What makes two listings the same product (catalogue plan 6; spec §1 row 8, §10).

* A barcode is kept as its 14-digit GTIN: digits only, zero-padded on the left, so the UPC-A 036000291452 and the
  EAN-13 0036000291452 are one key. An 8-digit code starting 0 or 1 that checks as a UPC-E (printed on small packs and
  cans) is read as the UPC-A it stands for. Spaces and hyphens may be typed. The check digit must be right (a mistyped digit
  must never group two different goods) and an all-zero code is refused.
* A store's own code (a GS1 restricted-circulation number: a GTIN-13 prefix 020-029, 040-049 or 200-299, or a GTIN-8
  starting 0 or 2) is accepted on a listing but never groups anything: two shops may print the same in-store number on
  different goods. A key starting with six zeros is read as a padded GTIN-8 (GS1 keeps that GTIN-13 range for them).
  Coupon and refund-receipt prefixes (GS1 050-059, 980-984, 99x) are not special-cased, and typed GS1-128 strings
  (`(01)...`) and EAN add-ons (15 or 18 digits) are refused as malformed.
* A name is compared by its normalised form: accents dropped, lower case, and every run of anything but a letter or a
  digit (any script, so the Akan and Ewe letters ɛ ɔ ŋ stay) turned into one space. Only exact normalised names are offered as matches; nothing is fuzzy."""
import re
import unicodedata

GTIN_LENGTHS = (8, 12, 13, 14)
BARCODE_MESSAGE = "Enter the barcode's 8, 12, 13 or 14 digits exactly as printed."
CHECK_DIGIT_MESSAGE = "This barcode's last digit does not match the others. Check it against the pack."


class BarcodeError(ValueError):
    pass


def _check_digit(body):
    total = sum(int(digit) * (3 if i % 2 == 0 else 1) for i, digit in enumerate(reversed(body)))
    return (10 - total % 10) % 10


def _upc_e_to_a(code):
    """The 12-digit UPC-A an 8-digit UPC-E (number system 0 or 1) stands for, or None."""
    system, d, check = code[0], code[1:7], code[7]
    if system not in "01":
        return None
    if d[5] in "012":
        body = d[0:2] + d[5] + "0000" + d[2:5]
    elif d[5] == "3":
        body = d[0:3] + "00000" + d[3:5]
    elif d[5] == "4":
        body = d[0:4] + "00000" + d[4]
    else:
        body = d[0:5] + "0000" + d[5]
    return system + body + check


def clean_barcode(raw):
    """The 14-digit GTIN key for `raw`, or "" for a blank one. Raises BarcodeError."""
    text = re.sub(r"[\s-]", "", str(raw or ""))
    if not text:
        return ""
    if not re.fullmatch(r"[0-9]+", text) or len(text) not in GTIN_LENGTHS:
        raise BarcodeError(BARCODE_MESSAGE)
    if len(text) == 8:
        upc_a = _upc_e_to_a(text)
        if upc_a is not None and _check_digit(upc_a[:-1]) == int(upc_a[-1]):
            text = upc_a  # a UPC-E printed on small packs: the same product as its UPC-A
    if _check_digit(text[:-1]) != int(text[-1]):
        raise BarcodeError(CHECK_DIGIT_MESSAGE)
    key = text.zfill(14)
    if int(key) == 0:
        raise BarcodeError(BARCODE_MESSAGE)
    return key


def is_store_code(key):
    """True for a store's own code (see the module text). `key` is a clean_barcode result; "" is not one."""
    if not key:
        return False
    if key.startswith("000000"):
        return key[6] in "02"
    prefix = int(key[1:4])
    return 20 <= prefix <= 29 or 40 <= prefix <= 49 or 200 <= prefix <= 299


def normalise_name(*parts):
    """The comparable form of a product's words (brand first, then name)."""
    text = unicodedata.normalize("NFKD", " ".join(str(part) for part in parts if part))
    text = "".join(char for char in text if not unicodedata.combining(char)).lower()
    return " ".join(re.sub(r"[\W_]+", " ", text).split())[:300]
