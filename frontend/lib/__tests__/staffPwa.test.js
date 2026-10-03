import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdate, ensureStaffHead, isStaffPathname, promptInstall, resetStaffPwaForTests, startStaffPwa, useStaffPwa,
} from '../staffPwa.js'

afterEach(() => {
  resetStaffPwaForTests()
  ensureStaffHead(false)
})

describe('isStaffPathname', () => {
  it.each([
    ['/staff', true], ['/staff/', true], ['/staff/kyc', true], ['/staff/activate', true],
    ['/', false], ['/staffing', false], ['/business', false],
  ])('%s → %s', (path, expected) => expect(isStaffPathname(path)).toBe(expected))
})

describe('ensureStaffHead', () => {
  it('adds the staff manifest + apple tags once, and removes them', () => {
    ensureStaffHead(true)
    ensureStaffHead(true)
    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(1)
    expect(document.head.querySelector('link[rel="manifest"]')).toHaveAttribute('href', '/staff.webmanifest')
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon-180x180.png')
    expect(document.head.querySelector('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'AH Staff')
    ensureStaffHead(false)
    expect(document.head.querySelector('[data-staff-pwa]')).toBeNull()
  })

  it('adds viewport-fit=cover to the existing viewport meta on staff paths and restores it exactly', () => {
    const original = 'width=device-width, initial-scale=1.0'
    let viewport = document.head.querySelector('meta[name="viewport"]')
    const created = !viewport
    if (created) {
      viewport = document.createElement('meta')
      viewport.setAttribute('name', 'viewport')
      document.head.appendChild(viewport)
    }
    viewport.setAttribute('content', original)
    try {
      ensureStaffHead(true)
      ensureStaffHead(true)
      expect(document.head.querySelectorAll('meta[name="viewport"]')).toHaveLength(1)
      expect(viewport.getAttribute('content')).toBe(`${original}, viewport-fit=cover`)
      ensureStaffHead(false)
      expect(viewport.getAttribute('content')).toBe(original)
      ensureStaffHead(false)
      expect(viewport.getAttribute('content')).toBe(original)
    } finally {
      if (created) viewport.remove()
    }
  })
})

describe('install prompt', () => {
  it('captures beforeinstallprompt, exposes it, and consumes it on promptInstall', async () => {
    await startStaffPwa({ enableServiceWorker: false })
    const { result } = renderHook(() => useStaffPwa())
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = vi.fn().mockResolvedValue(undefined)
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    act(() => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(result.current.installPrompt).toBe(event)
    await act(() => promptInstall())
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(result.current.installPrompt).toBeNull()
  })

  it('marks the app standalone after appinstalled', async () => {
    await startStaffPwa({ enableServiceWorker: false })
    const { result } = renderHook(() => useStaffPwa())
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(result.current.isStandalone).toBe(true)
  })
})

describe('service worker updates', () => {
  it('registers through the injected register fn and reloads into the waiting worker on applyUpdate', async () => {
    let needRefresh
    const updateSW = vi.fn()
    const register = vi.fn(({ onNeedRefresh }) => { needRefresh = onNeedRefresh; return updateSW })
    await startStaffPwa({ register, enableServiceWorker: true })
    expect(register).toHaveBeenCalledTimes(1)
    const { result } = renderHook(() => useStaffPwa())
    expect(result.current.needRefresh).toBe(false)
    act(() => needRefresh())
    expect(result.current.needRefresh).toBe(true)
    applyUpdate()
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('is idempotent and never registers when disabled', async () => {
    const register = vi.fn(() => vi.fn())
    await startStaffPwa({ register, enableServiceWorker: false })
    await startStaffPwa({ register, enableServiceWorker: true })
    expect(register).not.toHaveBeenCalled()
  })
})
