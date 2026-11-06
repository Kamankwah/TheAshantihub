import { ghanaPostError, normalizeGhanaPost } from "../src/lib/ghanaPost";

const FORMAT = "Enter a valid Ghana Post GPS address, like AK-039-5028.";
const ASHANTI_ONLY = "AshantiHub only admits businesses in the Ashanti Region. Your address must begin with “A”.";

// One table, copied verbatim into backend/accounts/tests/test_gps_normalize.py and frontend/lib/ghanaPost.test.js:
// the three normalisers must answer identically. [typed, normalised]; a text that stays as typed (upper-cased and
// trimmed) is refused with the format message.
const NORMALISE_CASES: [string, string][] = [
  ["AK-039-5028", "AK-039-5028"],
  ["AK-0395-0285", "AK-0395-0285"],
  ["AO-T010-3560", "AO-T010-3560"],
  ["ak 039 5028", "AK-039-5028"],
  ["AK0395028", "AK-039-5028"],
  ["ak03950285", "AK-0395-0285"],
  ["AOT0103560", "AO-T010-3560"],
  ["ao t010 3560", "AO-T010-3560"],
  ["AK\u2013039\u20135028", "AK-039-5028"],
  ["ak_039.5028", "AK-039-5028"],
  ["ak/039/5028", "AK-039-5028"],
  ["  ak-039-5028 ", "AK-039-5028"],
  ["ak -- 039 .. 5028", "AK-039-5028"],
  ["AKK0395028", "AK-K039-5028"],
  ["AK 0395028", "AK-039-5028"],
  ["AK 039 50 28", "AK-039-5028"],
  ["AK-039-50288", "AK-039-50288"],
  ["AK-0395-028", "AK-0395-028"],
  ["AKK-039-5028", "AKK-039-5028"],
  ["AK-03-50288", "AK-03-50288"],
  ["A1K0395028", "A1K0395028"],
  ["  not a code ", "NOT A CODE"],
  ["", ""],
];

describe("ghanaPost", () => {
  it("accepts_AK_039_5028_and_four_character_district_codes", () => {
    expect(ghanaPostError("AK-039-5028")).toBeNull();
    expect(ghanaPostError("AK-0395-0285")).toBeNull();
  });

  it("rejects_wrong_shapes_with_the_format_message", () => {
    for (const bad of ["", "   ", "AK039502", "AK039502851", "A1K0395028", "A-039-5028", "AK-39-5028", "AK-039-502", "AK-03#-5028"]) {
      expect(ghanaPostError(bad)).toBe(FORMAT);
    }
  });

  it("accepts_the_real_app_code_and_loose_typing", () => {
    for (const ok of ["AO-T010-3560", "ao t010 3560", "AOT0103560", "AK0395028", "ak 039 5028", "AK–039–5028", "ak03950285", "AK-03A-5028"]) {
      expect(ghanaPostError(ok)).toBeNull();
    }
    expect(normalizeGhanaPost("ao t010 3560")).toBe("AO-T010-3560");
    expect(normalizeGhanaPost("ak 039 5028")).toBe("AK-039-5028");
    expect(normalizeGhanaPost("AK–039–5028")).toBe("AK-039-5028");
    expect(normalizeGhanaPost("ak_039.5028")).toBe("AK-039-5028");
    expect(normalizeGhanaPost("ak/039/5028")).toBe("AK-039-5028");
    expect(normalizeGhanaPost("ak\t039− 5028")).toBe("AK-039-5028");
    expect(normalizeGhanaPost("ak03950285")).toBe("AK-0395-0285");
  });

  it("the_shared_table_of_cases", () => {
    for (const [typed, expected] of NORMALISE_CASES) {
      expect(normalizeGhanaPost(typed)).toBe(expected);
    }
  });

  it("never_re_groups_what_was_typed_a_typo_is_refused", () => {
    for (const typo of ["AK-039-50288", "AK-0395-028", "AKK-039-5028", "ak 039 50288", "AK-03-50288"]) {
      expect(ghanaPostError(typo)).toBe(FORMAT);
    }
    for (const ok of ["AK-039-5028", "AK-0395-0285", "AO-T010-3560"]) {
      expect(ghanaPostError(ok)).toBeNull();
    }
  });

  it("never_rewrites_a_character", () => {
    expect(normalizeGhanaPost("AKK0395028")).toBe("AK-K039-5028");
    expect(ghanaPostError("AKK0395028")).toBeNull();
    expect(normalizeGhanaPost("A1K0395028")).toBe("A1K0395028");
  });

  it("rejects_a_non_ashanti_prefix_with_the_region_message", () => {
    expect(ghanaPostError("GA-039-5028")).toBe(ASHANTI_ONLY);
    expect(ghanaPostError("ga 039 5028")).toBe(ASHANTI_ONLY);
  });

  it("normalises_case_and_whitespace", () => {
    expect(normalizeGhanaPost("  ak-039-5028 ")).toBe("AK-039-5028");
    expect(ghanaPostError(" ak-039-5028 ")).toBeNull();
  });
});
