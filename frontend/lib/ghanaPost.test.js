import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GHANA_POST_PATTERN, formatGhanaPostInput, ghanaPostError, normalizeGhanaPost } from './ghanaPost.js'

const FORMAT = 'Enter a valid Ghana Post GPS address, e.g. AK-039-5028.'

describe('ghanaPost', () => {
  it('test_accepts_AK_039_5028_and_four_digit_district_codes', () => {
    expect(ghanaPostError('AK-039-5028')).toBeNull()
    expect(ghanaPostError('AK-0395-0285')).toBeNull()
  })

  it('test_rejects_wrong_shapes', () => {
    expect(ghanaPostError('')).toBe('A Ghana Post GPS address is required.')
    expect(ghanaPostError('   ')).toBe('A Ghana Post GPS address is required.')
    for (const bad of ['AK0395028', 'A-039-5028', 'AK-39-5028', 'AK-039-502', 'AK-039-50288', 'AK-03A-5028', 'AKK-039-5028']) {
      expect(ghanaPostError(bad)).toBe(FORMAT)
    }
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
  })

  it('copy-check: the regex is the one in backend/accounts/gps.py', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const py = readFileSync(resolve(here, '../../backend/accounts/gps.py'), 'utf8')
    const m = py.match(/GPS_FORMAT = re\.compile\(r"([^"]+)"\)/)
    expect(m).not.toBeNull()
    expect(GHANA_POST_PATTERN).toBe(m[1])
  })
})
