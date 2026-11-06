// Ghana Post GPS address checks, mirroring backend/accounts/gps.py. The server
// stays the authority (it re-validates every save); this only saves a round
// trip. COPY of GPS_FORMAT, not an import: lib/ghanaPost.test.js reads gps.py
// and fails if the two ever differ.
export const GHANA_POST_PATTERN = '^[A-Z]{2}-[A-Z0-9]{3,4}-[A-Z0-9]{4}$'
const FORMAT = new RegExp(GHANA_POST_PATTERN)
const ASHANTI_LETTER = 'A'

export const GHANA_POST_REQUIRED = 'A Ghana Post GPS address is required.'
export const GHANA_POST_FORMAT = 'Enter a valid Ghana Post GPS address, e.g. AK-039-5028.'
// The backend's region wording talks about admitting businesses; a shopper needs the delivery version.
export const GHANA_POST_REGION =
  'We deliver only in the Ashanti Region for now. Your Ghana Post address must begin with “A”, e.g. AK-039-5028.'

// Separators people type between the groups (the same set as backend normalize_gps): whitespace, hyphens (plain,
// hyphen, en and em dash, minus), underscore, dot and slash.
const SEPARATORS = /[\s\-\u2010\u2013\u2014\u2212_./]/g
const SEPARATOR_RUN = /[\s\-\u2010\u2013\u2014\u2212_./]+/
const LOOSE_CODE = /^([A-Z]{2})([A-Z0-9]{7,8})$/
const AREA = /^[A-Z]{2}$/
const DISTRICT = /^[A-Z0-9]{3,4}$/
const UNIQUE = /^[A-Z0-9]{4}$/

// The canonical code (AK-039-5028, AK-0395-0285, AO-T010-3560) when `raw` is a code typed loosely, else the trimmed
// upper-case text so the format check rejects it. Only separators and case change: no character is ever replaced
// (letters are legitimate in the number groups, so reading O as 0 would corrupt real codes). A grouping the person
// typed is never re-cut: text that splits on separator runs into exactly three groups must already be 2 letters,
// 3-4 letters-or-digits and 4 letters-or-digits, or it is returned as typed (AK-039-50288 is a typo, not
// AK-0395-0288). With no separators, or another number of groups, separators are dropped and the text re-split by
// length (7 -> 3-4, 8 -> 4-4). Same rules as backend normalize_gps and mobile normalizeGhanaPost.
export function normalizeGhanaPost(raw) {
  const text = String(raw ?? '').trim().toUpperCase()
  const groups = text.split(SEPARATOR_RUN).filter(Boolean)
  if (groups.length === 3) {
    const [area, district, unique] = groups
    return AREA.test(area) && DISTRICT.test(district) && UNIQUE.test(unique) ? `${area}-${district}-${unique}` : text
  }
  const match = LOOSE_CODE.exec(text.replace(SEPARATORS, ''))
  if (!match) return text
  const [, area, rest] = match
  const cut = rest.length === 7 ? 3 : 4
  return `${area}-${rest.slice(0, cut)}-${rest.slice(cut)}`
}

export function ghanaPostError(raw) {
  const code = normalizeGhanaPost(raw)
  if (!code) return GHANA_POST_REQUIRED
  if (!FORMAT.test(code)) return GHANA_POST_FORMAT
  if (code[0] !== ASHANTI_LETTER) return GHANA_POST_REGION
  return null
}

// Auto-hyphenates while typing: AK039 -> AK-039-, AK0395028 -> AK-039-5028, AOT0103560 -> AO-T010-3560.
// Letters and digits are both kept after the two prefix letters (up to 8). Eight characters re-split as a
// four-character district (AK-0395-0285). A four-character district is also kept when the shopper has typed its
// hyphen (AK-0395-) or the four characters hold a letter (AOT010), so the hyphen put in is not undone by the next key.
// `deleting` (the new text is shorter than the old) stops the trailing hyphen
// from being put straight back, so Backspace works.
export function formatGhanaPostInput(raw, { deleting = false } = {}) {
  const upper = String(raw ?? '').trim().toUpperCase()
  const clean = upper.replace(/[^A-Z0-9]/g, '')
  const letters = clean.slice(0, 2).replace(/[^A-Z]/g, '')
  if (letters.length < 2) return letters
  const rest = clean.slice(2, 10)
  if (!rest) return letters
  const fourDistrict =
    rest.length === 8 || (rest.length === 4 && /[A-Z]/.test(rest)) || /^[A-Z]{2}\W?[A-Z0-9]{4}\W/.test(upper)
  const split = fourDistrict ? 4 : 3
  const district = rest.slice(0, split)
  const unique = rest.slice(split)
  if (unique) return `${letters}-${district}-${unique}`
  if (district.length === split && !deleting) return `${letters}-${district}-`
  return `${letters}-${district}`
}
