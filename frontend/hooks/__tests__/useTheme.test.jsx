import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTheme } from '../useTheme.js'

const originalMatchMedia = window.matchMedia

function mockMatchMedia(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

// A device whose colour-scheme preference can change while the page is open.
function liveMatchMedia(initial) {
  const listeners = new Set()
  const mql = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  }
  window.matchMedia = vi.fn().mockReturnValue(mql)
  return {
    set(matches) {
      mql.matches = matches
      listeners.forEach((fn) => fn({ matches }))
    },
  }
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    window.matchMedia = originalMatchMedia
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.theme
  })

  it('defaults to dark when the OS prefers dark and nothing is stored', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('defaults to light when the OS prefers light and nothing is stored', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })

  it('reads a previously stored theme over the OS preference', () => {
    mockMatchMedia(true)
    localStorage.setItem('ashantihub.theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })

  it('toggleTheme flips the theme and persists it', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('dark')
    expect(localStorage.getItem('ashantihub.theme')).toBe('dark')
  })

  it('follows_device_on_first_visit and keeps following it until the user toggles', () => {
    const device = liveMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    act(() => device.set(true))
    expect(result.current.theme).toBe('dark')
    // Following the device never writes a choice down.
    expect(localStorage.getItem('ashantihub.theme')).toBeNull()
  })

  it('toggle_persists_and_overrides_device', () => {
    const device = liveMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('light')
    expect(localStorage.getItem('ashantihub.theme')).toBe('light')
    act(() => device.set(false))
    act(() => device.set(true))
    expect(result.current.theme).toBe('light')
  })

  it('toggle_updates_html_class_and_data_theme', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    const html = document.documentElement
    expect(html.dataset.theme).toBe('light')
    expect(html.classList.contains('dark')).toBe(false)
    act(() => result.current.toggleTheme())
    expect(html.dataset.theme).toBe('dark')
    expect(html.classList.contains('dark')).toBe(true)
    act(() => result.current.toggleTheme())
    expect(html.dataset.theme).toBe('light')
    expect(html.classList.contains('dark')).toBe(false)
  })
})
