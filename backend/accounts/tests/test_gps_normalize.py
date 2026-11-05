from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from accounts.gps import GPS_FORMAT, normalize_gps, validate_ashanti_gps

FORMAT_MESSAGE = "Enter a valid Ghana Post GPS address, e.g. AK-039-5028."
REGION_MESSAGE_START = "AshantiHub currently only admits businesses in the Ashanti Region"
REQUIRED_MESSAGE = "A Ghana Post GPS address is required."

# One table, copied verbatim into frontend/lib/ghanaPost.test.js and mobile/__tests__/ghanaPost.test.ts: the three
# normalisers must answer identically. (typed, normalised). A text that stays as typed (upper-cased and trimmed) is
# refused with the format message.
NORMALISE_CASES = [
    ("AK-039-5028", "AK-039-5028"),
    ("AK-0395-0285", "AK-0395-0285"),
    ("AO-T010-3560", "AO-T010-3560"),
    ("ak 039 5028", "AK-039-5028"),
    ("AK0395028", "AK-039-5028"),
    ("ak03950285", "AK-0395-0285"),
    ("AOT0103560", "AO-T010-3560"),
    ("ao t010 3560", "AO-T010-3560"),
    ("AK\u2013039\u20135028", "AK-039-5028"),
    ("ak_039.5028", "AK-039-5028"),
    ("ak/039/5028", "AK-039-5028"),
    ("  ak-039-5028 ", "AK-039-5028"),
    ("ak -- 039 .. 5028", "AK-039-5028"),
    ("AKK0395028", "AK-K039-5028"),
    ("AK 0395028", "AK-039-5028"),
    ("AK 039 50 28", "AK-039-5028"),
    ("AK-039-50288", "AK-039-50288"),
    ("AK-0395-028", "AK-0395-028"),
    ("AKK-039-5028", "AKK-039-5028"),
    ("AK-03-50288", "AK-03-50288"),
    ("A1K0395028", "A1K0395028"),
    ("  not a code ", "NOT A CODE"),
    ("", ""),
]


class GpsNormalizeTests(SimpleTestCase):
    def assertRefused(self, raw, message=FORMAT_MESSAGE):
        with self.assertRaises(ValidationError) as caught:
            validate_ashanti_gps(raw)
        detail = caught.exception.detail
        self.assertEqual(len(detail), 1)
        self.assertTrue(str(detail[0]).startswith(message), f"{raw!r} gave {detail!r}")

    def test_format_pattern_is_the_real_code_shape(self):
        self.assertEqual(GPS_FORMAT.pattern, r"^[A-Z]{2}-[A-Z0-9]{3,4}-[A-Z0-9]{4}$")

    def test_real_code_from_the_ghanapost_app(self):
        # The owner's screenshot of the GhanaPostGPS app: a real Obuasi code with a letter in the middle group.
        self.assertEqual(validate_ashanti_gps("AO-T010-3560"), "AO-T010-3560")

    def test_accepts_any_spacing_dashes_and_case(self):
        for typed in ("AK0395028", "ak 039 5028", " AK-039-5028 ", "ak_039.5028", "AK\u2013039\u20135028", "AK/039/5028",
                      "ak\t039\u20105028", "AK\u2014039\u22125028"):
            with self.subTest(typed=typed):
                self.assertEqual(validate_ashanti_gps(typed), "AK-039-5028")
        for typed in ("ao t010 3560", "AOT0103560", "ao-t010-3560"):
            with self.subTest(typed=typed):
                self.assertEqual(validate_ashanti_gps(typed), "AO-T010-3560")

    def test_letters_are_kept_not_converted(self):
        self.assertEqual(validate_ashanti_gps("AK-O39-5028"), "AK-O39-5028")
        self.assertEqual(validate_ashanti_gps("AK-039-502B"), "AK-039-502B")

    def test_a_third_letter_is_a_district_letter_like_the_real_code(self):
        # AKK0395028 is AK + K0395028: the same shape as the real AO-T010-3560, so it is kept, not refused.
        self.assertEqual(validate_ashanti_gps("AKK0395028"), "AK-K039-5028")

    def test_the_shared_table_of_cases(self):
        for typed, expected in NORMALISE_CASES:
            with self.subTest(typed=typed):
                self.assertEqual(normalize_gps(typed), expected)

    def test_a_typed_grouping_is_never_re_grouped(self):
        # A typo must not become a different plausible code: three typed groups must already be 2, 3-4 and 4 characters.
        for typed in ("AK-039-50288", "AK-0395-028", "AKK-039-5028", "ak 039 50288", "AK-03-50288"):
            with self.subTest(typed=typed):
                self.assertRefused(typed)

    def test_a_well_grouped_code_is_accepted_as_typed(self):
        for typed, expected in (("AK-039-5028", "AK-039-5028"), ("AK-0395-0285", "AK-0395-0285"), ("AO-T010-3560", "AO-T010-3560")):
            with self.subTest(typed=typed):
                self.assertEqual(validate_ashanti_gps(typed), expected)

    def test_eight_characters_split_four_four(self):
        self.assertEqual(validate_ashanti_gps("ak03950285"), "AK-0395-0285")

    def test_wrong_lengths_and_shapes_are_refused(self):
        for typed in ("AK039502", "AK039502851", "A1K0395028", "A0395028", "AK-03#-5028", "AK--5028"):
            with self.subTest(typed=typed):
                self.assertRefused(typed)

    def test_non_ashanti_and_non_string_keep_their_messages(self):
        self.assertRefused("GA0395028", REGION_MESSAGE_START)
        for raw in (5028, ["AK"], {}):
            with self.subTest(raw=raw):
                self.assertRefused(raw)
        for raw in (None, "  "):
            with self.subTest(raw=raw):
                self.assertRefused(raw, REQUIRED_MESSAGE)

    def test_normalize_leaves_unrecognised_text_for_the_format_check(self):
        self.assertEqual(normalize_gps("  not a code "), "NOT A CODE")
        self.assertEqual(normalize_gps(None), "")
        self.assertEqual(normalize_gps("ak 039 5028"), "AK-039-5028")
