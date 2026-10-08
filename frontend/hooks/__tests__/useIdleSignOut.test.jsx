import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIdleSignOut } from '../useIdleSignOut.js'

beforeEach(() => { vi.useFakeTimers(); localStorage.removeItem('ashantihub.staffLastInput') })
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

describe('useIdleSignOut across tabs', () => {
  beforeEach(() => localStorage.removeItem('ashantihub.staffLastInput'))

  it('stays signed in while another tab is active', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleSignOut(onIdle))
    act(() => { vi.advanceTimersByTime(29 * 60 * 1000) })
    act(() => {
      localStorage.setItem('ashantihub.staffLastInput', String(Date.now()))
      window.dispatchEvent(new StorageEvent('storage', { key: 'ashantihub.staffLastInput', newValue: String(Date.now()) }))
    })
    act(() => { vi.advanceTimersByTime(29 * 60 * 1000) })
    expect(onIdle).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(2 * 60 * 1000) })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('shares its own input with other tabs, at most every 10 seconds', () => {
    renderHook(() => useIdleSignOut(vi.fn()))
    act(() => { window.dispatchEvent(new Event('keydown')) })
    const first = localStorage.getItem('ashantihub.staffLastInput')
    expect(first).not.toBeNull()
    act(() => { vi.advanceTimersByTime(3000); window.dispatchEvent(new Event('keydown')) })
    expect(localStorage.getItem('ashantihub.staffLastInput')).toBe(first)
    act(() => { vi.advanceTimersByTime(8000); window.dispatchEvent(new Event('keydown')) })
    expect(localStorage.getItem('ashantihub.staffLastInput')).not.toBe(first)
  })

  it('still signs out an idle session on the first keypress after waking from sleep', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleSignOut(onIdle))
    act(() => {
      vi.setSystemTime(Date.now() + 31 * 60 * 1000)
      window.dispatchEvent(new Event('keydown'))
    })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })
})
