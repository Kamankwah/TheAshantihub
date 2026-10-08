import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCATION_BLOCKED, POSITION_OPTIONS, useDevicePosition } from '../useDevicePosition.js'

function stubGeolocation(getCurrentPosition) {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: getCurrentPosition ? { getCurrentPosition } : undefined })
}
const fix = (accuracy) => ({ coords: { latitude: 6.6885, longitude: -1.6244, accuracy }, timestamp: Date.parse('2026-10-08T10:21:00Z') })

afterEach(() => { delete navigator.geolocation })

describe('useDevicePosition', () => {
  it('reads one high-accuracy fix, only when asked', () => {
    const getCurrentPosition = vi.fn((ok) => ok(fix(11.6)))
    stubGeolocation(getCurrentPosition)
    const { result } = renderHook(() => useDevicePosition())
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(result.current.position).toBeNull()
    act(() => result.current.locate())
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
    expect(POSITION_OPTIONS).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
    expect(result.current.position).toEqual({ lat: 6.6885, lng: -1.6244, accuracy: 12, at: '2026-10-08T10:21:00.000Z' })
    expect(result.current.error).toBeNull()
    expect(result.current.locating).toBe(false)
  })

  it('is locating until the phone answers', () => {
    let answer
    stubGeolocation(vi.fn((ok) => { answer = ok }))
    const { result } = renderHook(() => useDevicePosition())
    act(() => result.current.locate())
    expect(result.current.locating).toBe(true)
    act(() => answer(fix(8)))
    expect(result.current.locating).toBe(false)
    expect(result.current.position.accuracy).toBe(8)
  })

  it('tells the scout how to allow location when permission is denied', () => {
    stubGeolocation(vi.fn((_ok, fail) => fail({ code: 1, message: 'User denied Geolocation' })))
    const { result } = renderHook(() => useDevicePosition())
    act(() => result.current.locate())
    expect(result.current.error).toBe(LOCATION_BLOCKED)
    expect(result.current.error).toMatch(/set Location to Allow/)
    expect(result.current.position).toBeNull()
    expect(result.current.locating).toBe(false)
  })

  it('explains a timeout and a phone without a fix differently', () => {
    stubGeolocation(vi.fn((_ok, fail) => fail({ code: 3 })))
    const slow = renderHook(() => useDevicePosition())
    act(() => slow.result.current.locate())
    expect(slow.result.current.error).toMatch(/Step outside, away from walls/)
    stubGeolocation(vi.fn((_ok, fail) => fail({ code: 2 })))
    const blind = renderHook(() => useDevicePosition())
    act(() => blind.result.current.locate())
    expect(blind.result.current.error).toMatch(/Turn on Location \(GPS\)/)
  })

  it('says so when the browser cannot share a location at all', () => {
    stubGeolocation(null)
    const { result } = renderHook(() => useDevicePosition())
    act(() => result.current.locate())
    expect(result.current.error).toMatch(/can't share its location\. Place the pin by hand instead\./)
  })
})
