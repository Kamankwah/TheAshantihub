import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import useBreakpoint from '../useBreakpoint.js'
import { installMatchMedia } from '../../test/matchMedia.js'

let mm
afterEach(() => mm?.restore())

describe('useBreakpoint', () => {
  it('falls back to desktop under the global jsdom stub (matches nothing)', () => {
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it.each([
    [320, 'phone'], [760, 'phone'], [761, 'tablet'], [1199, 'tablet'], [1200, 'desktop'], [1920, 'desktop'],
  ])('width %i → %s', (width, expected) => {
    mm = installMatchMedia(width)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe(expected)
  })

  it('updates when the viewport crosses a breakpoint', () => {
    mm = installMatchMedia(375)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('phone')
    act(() => mm.resize(1024))
    expect(result.current).toBe('tablet')
    act(() => mm.resize(1440))
    expect(result.current).toBe('desktop')
  })
})
