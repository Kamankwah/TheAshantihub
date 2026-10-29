// Ghana Post GPS address checks, mirroring backend/accounts/gps.py. The server
// stays the authority (it re-validates every save); this only saves a round
// trip. COPY of GPS_FORMAT, not an import: lib/ghanaPost.test.js reads gps.py
// and fails if the two ever differ.
export const GHANA_POST_PATTERN = '^[A-Z]{2}-\\d{3,4}-\\d{4}$'
const FORMAT = new RegExp(GHANA_POST_PATTERN)
const ASHANTI_LETTER = 'A'

export const GHANA_POST_REQUIRED = 'A Ghana Post GPS address is required.'
export const GHANA_POST_FORMAT = 'Enter a valid Ghana Post GPS address, e.g. AK-039-5028.'
// The backend's region wording talks about admitting businesses; a shopper needs the delivery version.
export const GHANA_POST_REGION =
  'We deliver only in the Ashanti Region for now. Your Ghana Post address must begin with “A”, e.g. AK-039-5028.'

export function normalizeGhanaPost(raw) {
  return String(raw ?? '').trim().toUpperCase()
}

export function ghanaPostError(raw) {
  const code = normalizeGhanaPost(raw)
  if (!code) return GHANA_POST_REQUIRED
  if (!FORMAT.test(code)) return GHANA_POST_FORMAT
  if (code[0] !== ASHANTI_LETTER) return GHANA_POST_REGION
  return null
}

// Auto-hyphenates while typing: AK039 -> AK-039-, AK0395028 -> AK-039-5028,
// and eight digits re-split as a four-digit district (AK-0395-0285).
// `deleting` (the new text is shorter than the old) stops the trailing hyphen
// from being put straight back, so Backspace works.
export function formatGhanaPostInput(raw, { deleting = false } = {}) {
  const clean = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const letters = clean.slice(0, 2).replace(/[^A-Z]/g, '')
  if (letters.length < 2) return letters
  const digits = clean.slice(2).replace(/[^0-9]/g, '').slice(0, 8)
  if (!digits) return letters
  const split = digits.length === 8 ? 4 : 3
  const district = digits.slice(0, split)
  const unique = digits.slice(split)
  if (unique) return `${letters}-${district}-${unique}`
  if (district.length === 3 && !deleting) return `${letters}-${district}-`
  return `${letters}-${district}`
}
