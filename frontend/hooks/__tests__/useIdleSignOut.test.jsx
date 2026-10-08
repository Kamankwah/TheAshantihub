import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIdleSignOut } from '../useIdleSignOut.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useIdleSignOut', () => {
  it('signs out after 30 minutes without input, once', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleSignOut(onIdle))
    act(() => { vi.advanceTimersByTime(29 * 60 * 1000) })
    act(() => { window.dispatchEvent(new Event('keydown')) })
    act(() => { vi.advanceTimersByTime(29 * 60 * 1000) })
    expect(onIdle).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(2 * 60 * 1000) })
    expect(onIdle).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(60 * 60 * 1000) })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('checks straight away when a sleeping tab comes back', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleSignOut(onIdle))
    act(() => {
      vi.setSystemTime(Date.now() + 31 * 60 * 1000)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })
})
