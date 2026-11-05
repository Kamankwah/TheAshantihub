// Ghana Post GPS address checks, mirroring backend/accounts/gps.py and frontend/lib/ghanaPost.js. The server stays
// the authority (it re-validates every save); this only saves a round trip and tidies what was typed.
const FORMAT = /^[A-Z]{2}-[A-Z0-9]{3,4}-[A-Z0-9]{4}$/;
const ASHANTI_LETTER = "A";

export const GHANA_POST_FORMAT = "Enter a valid Ghana Post GPS address, like AK-039-5028.";
export const GHANA_POST_ASHANTI_ONLY = "AshantiHub only admits businesses in the Ashanti Region. Your address must begin with “A”.";

// Separators people type between the groups (the same set as backend normalize_gps): whitespace, hyphens (plain,
// hyphen, en and em dash, minus), underscore, dot and slash.
const SEPARATORS = /[\s\-‐–—−_./]/g;
const LOOSE_CODE = /^([A-Z]{2})([A-Z0-9]{7,8})$/;

/**
 * The canonical code (AK-039-5028, AK-0395-0285, AO-T010-3560) when `raw` is a code typed loosely, else the trimmed
 * upper-case text so the format check rejects it. Only separators and case change: no character is ever replaced
 * (letters are legitimate in the number groups, so reading O as 0 would corrupt real codes).
 */
export function normalizeGhanaPost(raw: string): string {
  const text = String(raw ?? "").trim().toUpperCase();
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
