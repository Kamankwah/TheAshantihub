import { afterEach, describe, expect, it, vi } from 'vitest'
import { newSecureUuid, newUuid } from '../uuid.js'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newUuid', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses crypto.randomUUID when present', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-id' })
    expect(newUuid()).toBe('native-id')
  })

  it('falls back to getRandomValues on browsers without randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: (b) => b.fill(7) })
    expect(newUuid()).toMatch(V4)
  })

  it('falls back to Math.random with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined)
    expect(newUuid()).toMatch(V4)
  })
})

describe('newSecureUuid', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses getRandomValues when randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: (b) => b.fill(7) })
    expect(newSecureUuid()).toMatch(V4)
  })

  it('returns null rather than falling back to Math.random', () => {
    vi.stubGlobal('crypto', undefined)
    expect(newSecureUuid()).toBeNull()
  })
})
