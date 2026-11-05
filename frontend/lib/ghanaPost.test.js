import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GHANA_POST_PATTERN, formatGhanaPostInput, ghanaPostError, normalizeGhanaPost } from './ghanaPost.js'

const FORMAT = 'Enter a valid Ghana Post GPS address, e.g. AK-039-5028.'

// One table, copied verbatim into backend/accounts/tests/test_gps_normalize.py and mobile/__tests__/ghanaPost.test.ts:
// the three normalisers must answer identically. [typed, normalised]; a text that stays as typed (upper-cased and
// trimmed) is refused with the format message.
const NORMALISE_CASES = [
  ['AK-039-5028', 'AK-039-5028'],
  ['AK-0395-0285', 'AK-0395-0285'],
  ['AO-T010-3560', 'AO-T010-3560'],
  ['ak 039 5028', 'AK-039-5028'],
  ['AK0395028', 'AK-039-5028'],
  ['ak03950285', 'AK-0395-0285'],
  ['AOT0103560', 'AO-T010-3560'],
  ['ao t010 3560', 'AO-T010-3560'],
  ['AK\u2013039\u20135028', 'AK-039-5028'],
  ['ak_039.5028', 'AK-039-5028'],
  ['ak/039/5028', 'AK-039-5028'],
  ['  ak-039-5028 ', 'AK-039-5028'],
  ['ak -- 039 .. 5028', 'AK-039-5028'],
  ['AKK0395028', 'AK-K039-5028'],
  ['AK 0395028', 'AK-039-5028'],
  ['AK 039 50 28', 'AK-039-5028'],
  ['AK-039-50288', 'AK-039-50288'],
  ['AK-0395-028', 'AK-0395-028'],
  ['AKK-039-5028', 'AKK-039-5028'],
  ['AK-03-50288', 'AK-03-50288'],
  ['A1K0395028', 'A1K0395028'],
  ['  not a code ', 'NOT A CODE'],
  ['', ''],
]

describe('ghanaPost', () => {
  it('test_accepts_AK_039_5028_and_four_digit_district_codes', () => {
    expect(ghanaPostError('AK-039-5028')).toBeNull()
    expect(ghanaPostError('AK-0395-0285')).toBeNull()
  })

  it('test_rejects_wrong_shapes', () => {
    expect(ghanaPostError('')).toBe('A Ghana Post GPS address is required.')
    expect(ghanaPostError('   ')).toBe('A Ghana Post GPS address is required.')
    for (const bad of ['AK039502', 'AK039502851', 'A1K0395028', 'A-039-5028', 'AK-39-5028', 'AK-039-502', 'AK-03#-5028']) {
      expect(ghanaPostError(bad)).toBe(FORMAT)
    }
  })

  it('test_accepts_the_real_app_code_and_loose_typing', () => {
    for (const ok of ['AO-T010-3560', 'ao t010 3560', 'AOT0103560', 'AK0395028', 'ak 039 5028', 'AK\u2013039\u20135028', 'ak03950285', 'AK-03A-5028']) {
      expect(ghanaPostError(ok)).toBeNull()
    }
    expect(normalizeGhanaPost('ao t010 3560')).toBe('AO-T010-3560')
    expect(normalizeGhanaPost('ak 039 5028')).toBe('AK-039-5028')
    expect(normalizeGhanaPost('AK\u2013039\u20135028')).toBe('AK-039-5028')
    expect(normalizeGhanaPost('ak_039.5028')).toBe('AK-039-5028')
    expect(normalizeGhanaPost('ak03950285')).toBe('AK-0395-0285')
  })

  it('the shared table of cases', () => {
    for (const [typed, expected] of NORMALISE_CASES) {
      expect(normalizeGhanaPost(typed), typed).toBe(expected)
    }
  })

  it('never re-groups what was typed: a typo is refused, not saved as a different code', () => {
    for (const typo of ['AK-039-50288', 'AK-0395-028', 'AKK-039-5028', 'ak 039 50288', 'AK-03-50288']) {
      expect(ghanaPostError(typo), typo).toBe(FORMAT)
    }
    for (const ok of ['AK-039-5028', 'AK-0395-0285', 'AO-T010-3560']) {
      expect(ghanaPostError(ok), ok).toBeNull()
    }
  })

  it('never rewrites a character: AKK0395028 is a well-formed code, not a typo of AK0395028', () => {
    expect(normalizeGhanaPost('AKK0395028')).toBe('AK-K039-5028')
    expect(ghanaPostError('AKK0395028')).toBeNull()
    expect(normalizeGhanaPost('A1K0395028')).toBe('A1K0395028')
  })

  it('test_rejects_non_ashanti_prefix_with_the_region_message', () => {
    expect(ghanaPostError('GA-039-5028')).toBe(
      'We deliver only in the Ashanti Region for now. Your Ghana Post address must begin with “A”, e.g. AK-039-5028.',
    )
  })

  it('test_normalises_case_and_whitespace', () => {
    expect(normalizeGhanaPost('  ak-039-5028 ')).toBe('AK-039-5028')
    expect(normalizeGhanaPost(null)).toBe('')
    expect(ghanaPostError(' ak-039-5028 ')).toBeNull()
  })

  it('formats as typed, and lets a hyphen be deleted', () => {
    expect(formatGhanaPostInput('ak')).toBe('AK')
    expect(formatGhanaPostInput('AK039')).toBe('AK-039-')
    expect(formatGhanaPostInput('AK-0395')).toBe('AK-039-5')
    expect(formatGhanaPostInput('AK0395028')).toBe('AK-039-5028')
    expect(formatGhanaPostInput('AK03950285')).toBe('AK-0395-0285')
    expect(formatGhanaPostInput('AK-039-', { deleting: true })).toBe('AK-039')
    expect(formatGhanaPostInput('AOT010')).toBe('AO-T010-')
    expect(formatGhanaPostInput('AOT0103560')).toBe('AO-T010-3560')
    expect(formatGhanaPostInput('AK0395028')).toBe('AK-039-5028')
    expect(formatGhanaPostInput('AK03950285')).toBe('AK-0395-0285')
    expect(formatGhanaPostInput('AO-T010-', { deleting: true })).toBe('AO-T010')
    // a typed four-character district keeps its hyphen when the next key comes
    expect(formatGhanaPostInput('AO-T010-3')).toBe('AO-T010-3')
    expect(formatGhanaPostInput('AK-0395-')).toBe('AK-0395-')
  })

  it('copy-check: the regex is the one in backend/accounts/gps.py', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const py = readFileSync(resolve(here, '../../backend/accounts/gps.py'), 'utf8')
    const m = py.match(/GPS_FORMAT = re\.compile\(r"([^"]+)"\)/)
    expect(m).not.toBeNull()
    expect(GHANA_POST_PATTERN).toBe(m[1])
  })
})
