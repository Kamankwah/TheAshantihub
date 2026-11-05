// Ghana Post GPS address checks, mirroring backend/accounts/gps.py and frontend/lib/ghanaPost.js. The server stays
// the authority (it re-validates every save); this only saves a round trip and tidies what was typed.
const FORMAT = /^[A-Z]{2}-[A-Z0-9]{3,4}-[A-Z0-9]{4}$/;
const ASHANTI_LETTER = "A";

export const GHANA_POST_FORMAT = "Enter a valid Ghana Post GPS address, like AK-039-5028.";
export const GHANA_POST_ASHANTI_ONLY = "AshantiHub only admits businesses in the Ashanti Region. Your address must begin with “A”.";

// Separators people type between the groups (the same set as backend normalize_gps): whitespace, hyphens (plain,
// hyphen, en and em dash, minus), underscore, dot and slash.
const SEPARATORS = /[\s\-‐–—−_./]/g;
const SEPARATOR_RUN = /[\s\-‐–—−_./]+/;
const LOOSE_CODE = /^([A-Z]{2})([A-Z0-9]{7,8})$/;
const AREA = /^[A-Z]{2}$/;
const DISTRICT = /^[A-Z0-9]{3,4}$/;
const UNIQUE = /^[A-Z0-9]{4}$/;

/**
 * The canonical code (AK-039-5028, AK-0395-0285, AO-T010-3560) when `raw` is a code typed loosely, else the trimmed
 * upper-case text so the format check rejects it. Only separators and case change: no character is ever replaced
 * (letters are legitimate in the number groups, so reading O as 0 would corrupt real codes). A grouping the person
 * typed is never re-cut: text that splits on separator runs into exactly three groups must already be 2 letters,
 * 3-4 letters-or-digits and 4 letters-or-digits, or it is returned as typed (AK-039-50288 is a typo, not
 * AK-0395-0288). With no separators, or another number of groups, separators are dropped and the text re-split by
 * length (7 -> 3-4, 8 -> 4-4). Same rules as backend normalize_gps and web normalizeGhanaPost.
 */
export function normalizeGhanaPost(raw: string): string {
  const text = String(raw ?? "").trim().toUpperCase();
  const groups = text.split(SEPARATOR_RUN).filter(Boolean);
  if (groups.length === 3) {
    const [area, district, unique] = groups;
    return AREA.test(area) && DISTRICT.test(district) && UNIQUE.test(unique) ? `${area}-${district}-${unique}` : text;
  }
  const match = LOOSE_CODE.exec(text.replace(SEPARATORS, ""));
  if (!match) return text;
  const [, area, rest] = match;
  const cut = rest.length === 7 ? 3 : 4;
  return `${area}-${rest.slice(0, cut)}-${rest.slice(cut)}`;
}

/** The message to show under the field, or null when the code is a well-formed Ashanti Region address. */
export function ghanaPostError(raw: string): string | null {
  const code = normalizeGhanaPost(raw);
  if (!FORMAT.test(code)) return GHANA_POST_FORMAT;
  if (code[0] !== ASHANTI_LETTER) return GHANA_POST_ASHANTI_ONLY;
  return null;
}
