import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdate, ensureStaffHead, isStaffPathname, promptInstall, reloadPage, resetStaffPwaForTests, startStaffPwa, useStaffPwa,
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

// A Workbox-like stand-in: records listeners so a test can fire waiting /
// controlling the way workbox-window would.
function fakeWorkbox({ register } = {}) {
  const handlers = {}
  const registration = { update: vi.fn() }
  return {
    registration,
    addEventListener: vi.fn((type, handler) => { (handlers[type] ||= []).push(handler) }),
    register: vi.fn(register ?? (() => Promise.resolve(registration))),
    messageSkipWaiting: vi.fn(),
    emit(type, data = {}) { (handlers[type] || []).forEach((handler) => handler({ type, ...data })) },
  }
}

function stubReload() {
  const reload = vi.fn()
  const spy = vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
  return { reload, restore: () => spy.mockRestore() }
}

describe('service worker updates', () => {
  it('creates the staff-scoped Workbox, flags a waiting worker, and reloads only after this tab asked', async () => {
    const wb = fakeWorkbox()
    const createWorkbox = vi.fn(() => wb)
    const { reload, restore } = stubReload()
    try {
      await startStaffPwa({ createWorkbox, enableServiceWorker: true })
      expect(createWorkbox).toHaveBeenCalledWith('/sw.js', { scope: '/staff' })
      expect(wb.register).toHaveBeenCalledTimes(1)
      const { result } = renderHook(() => useStaffPwa())
      expect(result.current.needRefresh).toBe(false)
      expect(result.current.updatedElsewhere).toBe(false)
      act(() => wb.emit('waiting'))
      expect(result.current.needRefresh).toBe(true)
      applyUpdate()
      expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
      expect(reload).not.toHaveBeenCalled()
      act(() => wb.emit('controlling', { isUpdate: true }))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('does not reload when another tab activated the update; it flags updatedElsewhere instead', async () => {
    const wb = fakeWorkbox()
    const { reload, restore } = stubReload()
    try {
      await startStaffPwa({ createWorkbox: () => wb, enableServiceWorker: true })
      const { result } = renderHook(() => useStaffPwa())
      act(() => wb.emit('waiting'))
      act(() => wb.emit('controlling', { isUpdate: true }))
      expect(reload).not.toHaveBeenCalled()
      expect(result.current.needRefresh).toBe(false)
      expect(result.current.updatedElsewhere).toBe(true)
    } finally {
      restore()
    }
  })

  it('ignores a first-install controlling event (isUpdate false)', async () => {
    const wb = fakeWorkbox()
    const { reload, restore } = stubReload()
    try {
      await startStaffPwa({ createWorkbox: () => wb, enableServiceWorker: true })
      const { result } = renderHook(() => useStaffPwa())
      act(() => wb.emit('controlling', { isUpdate: false }))
      expect(reload).not.toHaveBeenCalled()
      expect(result.current.updatedElsewhere).toBe(false)
    } finally {
      restore()
    }
  })

  it('reloadPage reloads the window', () => {
    const { reload, restore } = stubReload()
    try {
      reloadPage()
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('logs a registration rejection instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const error = new Error('boom')
      const wb = fakeWorkbox({ register: () => Promise.reject(error) })
      await expect(startStaffPwa({ createWorkbox: () => wb, enableServiceWorker: true })).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith('AshantiHub Staff: service worker registration failed', error)
    } finally {
      warn.mockRestore()
    }
  })

  it('polls for updates hourly once registered, swallowing a failed check', async () => {
    vi.useFakeTimers()
    try {
      const wb = fakeWorkbox()
      wb.registration.update.mockRejectedValue(new Error('offline'))
      await startStaffPwa({ createWorkbox: () => wb, enableServiceWorker: true })
      expect(wb.registration.update).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(wb.registration.update).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(wb.registration.update).toHaveBeenCalledTimes(2)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('is idempotent and never creates a Workbox when disabled', async () => {
    const createWorkbox = vi.fn(() => fakeWorkbox())
    await startStaffPwa({ createWorkbox, enableServiceWorker: false })
    await startStaffPwa({ createWorkbox, enableServiceWorker: true })
    expect(createWorkbox).not.toHaveBeenCalled()
  })

  it('registers at most once per page', async () => {
    const createWorkbox = vi.fn(() => fakeWorkbox())
    await startStaffPwa({ createWorkbox, enableServiceWorker: true })
    await startStaffPwa({ createWorkbox, enableServiceWorker: true })
    expect(createWorkbox).toHaveBeenCalledTimes(1)
  })
})
