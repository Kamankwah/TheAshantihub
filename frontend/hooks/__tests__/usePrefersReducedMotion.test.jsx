import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import usePrefersReducedMotion from '../usePrefersReducedMotion.js'

function mockMatchMedia(initialMatches) {
  const listeners = []
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: initialMatches,
    media: query,
    addEventListener: (_event, cb) => listeners.push(cb),
    removeEventListener: vi.fn(),
    addListener: (cb) => listeners.push(cb),
    removeListener: vi.fn(),
  }))
  return {
    fire: (newMatches) => act(() => listeners.forEach((cb) => cb({ matches: newMatches }))),
  }
}

describe('usePrefersReducedMotion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when the media query initially matches', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(true)
  })

  it('returns false when the media query does not match', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
  })

  it('updates when the media query change event fires', () => {
    const { fire } = mockMatchMedia(false)
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
    fire(true)
    expect(result.current).toBe(true)
  })
})
