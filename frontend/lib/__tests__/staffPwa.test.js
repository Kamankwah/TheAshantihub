import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdate, chromeIntentUrl, detectInstallPlatform, ensureStaffHead, isStaffPathname, promptInstall, reloadPage, resetStaffPwaForTests,
  startStaffPwa, useStaffPwa,
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

  it('marks the app standalone and installed after appinstalled', async () => {
    await startStaffPwa({ enableServiceWorker: false })
    const { result } = renderHook(() => useStaffPwa())
    expect(result.current.installed).toBe(false)
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(result.current.isStandalone).toBe(true)
    expect(result.current.installed).toBe(true)
  })
})

// Real user-agent strings for the phones and in-app browsers staff are likely
// to open the /staff/install link in.
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 336.0.3.18.99 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 614207424)',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.103;FBBV/621045032;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/80]',
  iphoneWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 13; SM-A515F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 13; SM-A515F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.40.103;]',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
}

describe('detectInstallPlatform', () => {
  it.each([
    ['iPhone Safari', { userAgent: UA.iphoneSafari }, { os: 'ios', inApp: false, iosSafari: true }],
    ['iPad Safari (desktop UA, touch)', { userAgent: UA.ipadDesktopSafari, platform: 'MacIntel', maxTouchPoints: 5 }, { os: 'ios', inApp: false, iosSafari: true }],
    ['iPhone Chrome', { userAgent: UA.iphoneChrome }, { os: 'ios', inApp: false, iosSafari: false }],
    ['iPhone Instagram', { userAgent: UA.iphoneInstagram }, { os: 'ios', inApp: true, iosSafari: false }],
    ['iPhone Facebook', { userAgent: UA.iphoneFacebook }, { os: 'ios', inApp: true, iosSafari: false }],
    ['iPhone app web view', { userAgent: UA.iphoneWebView }, { os: 'ios', inApp: true, iosSafari: false }],
    ['Android Chrome', { userAgent: UA.androidChrome }, { os: 'android', inApp: false, iosSafari: false }],
    ['Android Samsung Internet', { userAgent: UA.androidSamsung }, { os: 'android', inApp: false, iosSafari: false }],
    ['Android app web view', { userAgent: UA.androidWebView }, { os: 'android', inApp: true, iosSafari: false }],
    ['Android Facebook', { userAgent: UA.androidFacebook }, { os: 'android', inApp: true, iosSafari: false }],
    ['Windows Chrome', { userAgent: UA.windowsChrome }, { os: 'desktop', inApp: false, iosSafari: false }],
    ['Mac Safari (no touch)', { userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 }, { os: 'desktop', inApp: false, iosSafari: false }],
  ])('%s', (_name, input, expected) => expect(detectInstallPlatform(input)).toEqual(expected))
})

describe('chromeIntentUrl', () => {
  it('hands the same https URL to Chrome on Android', () => {
    expect(chromeIntentUrl('https://theashantihub.com/staff/install'))
      .toBe('intent://theashantihub.com/staff/install#Intent;scheme=https;package=com.android.chrome;end')
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

// jsdom has no navigator.serviceWorker; a controlled page is the normal case.
function stubController(controller = {}) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller } })
  return () => { delete navigator.serviceWorker }
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
    const restoreController = stubController()
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
      restoreController()
    }
  })

  it('reloads straight away on an uncontrolled page (after a hard reload no controllerchange ever arrives)', async () => {
    const wb = fakeWorkbox()
    const { reload, restore } = stubReload()
    const restoreController = stubController(null)
    try {
      await startStaffPwa({ createWorkbox: () => wb, enableServiceWorker: true })
      act(() => wb.emit('waiting'))
      applyUpdate()
      expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      restore()
      restoreController()
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
