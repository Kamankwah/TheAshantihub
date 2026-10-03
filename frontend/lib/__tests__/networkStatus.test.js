import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getNetworkStatus, reportApiNetworkFailure, reportApiResponse, resetNetworkStatusForTests,
  subscribeNetworkStatus, useNetworkStatus,
} from '../networkStatus.js'

afterEach(() => {
  delete navigator.onLine
  resetNetworkStatusForTests()
})

function stubOnline(initial) {
  let online = initial
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
  return (value) => { online = value }
}

describe('networkStatus', () => {
  it('starts online when the browser reports online', () => {
    stubOnline(true)
    expect(getNetworkStatus()).toEqual({ offline: false })
  })

  it('starts offline when the browser reports offline', () => {
    stubOnline(false)
    expect(getNetworkStatus()).toEqual({ offline: true })
  })

  it('an API network failure marks offline even while navigator.onLine is true', () => {
    stubOnline(true)
    reportApiNetworkFailure()
    expect(getNetworkStatus().offline).toBe(true)
  })

  it('any API response clears the API failure', () => {
    stubOnline(true)
    reportApiNetworkFailure()
    reportApiResponse()
    expect(getNetworkStatus().offline).toBe(false)
  })

  it('the window online event clears the API failure', () => {
    stubOnline(true)
    reportApiNetworkFailure()
    window.dispatchEvent(new Event('online'))
    expect(getNetworkStatus().offline).toBe(false)
  })

  it('the window offline event marks offline, and an API response alone does not clear it', () => {
    const setOnline = stubOnline(true)
    subscribeNetworkStatus(() => {})
    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    expect(getNetworkStatus().offline).toBe(true)
    reportApiResponse()
    expect(getNetworkStatus().offline).toBe(true)
    setOnline(true)
    window.dispatchEvent(new Event('online'))
    expect(getNetworkStatus().offline).toBe(false)
  })

  it('keeps a stable snapshot until the state changes, and notifies only on change', () => {
    stubOnline(true)
    const listener = vi.fn()
    const unsubscribe = subscribeNetworkStatus(listener)
    const first = getNetworkStatus()
    reportApiResponse()
    expect(getNetworkStatus()).toBe(first)
    expect(listener).not.toHaveBeenCalled()
    reportApiNetworkFailure()
    expect(getNetworkStatus()).not.toBe(first)
    expect(listener).toHaveBeenCalledTimes(1)
    reportApiNetworkFailure()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    reportApiResponse()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('useNetworkStatus re-renders on transitions', () => {
    stubOnline(true)
    const { result } = renderHook(() => useNetworkStatus())
    expect(result.current.offline).toBe(false)
    act(() => reportApiNetworkFailure())
    expect(result.current.offline).toBe(true)
    act(() => reportApiResponse())
    expect(result.current.offline).toBe(false)
  })
})
