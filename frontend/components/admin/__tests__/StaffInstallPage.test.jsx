import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StaffInstallPage from '../StaffInstallPage.jsx'
import { resetStaffPwaForTests, startStaffPwa } from '../../../lib/staffPwa.js'

// /staff/install — the link staff are sent to install the AshantiHub Staff
// app. No browser lets a link install an app by itself, so the page leads
// with whatever the phone in hand allows: Chrome's own install dialog,
// Safari's Add to Home Screen steps, or a way out of an app's built-in
// browser, where nothing can be installed.

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 336.0.3.18.99 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 614207424)',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 13; SM-A515F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.40.103;]',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

// jsdom's default origin.
const INSTALL_URL = 'http://localhost:3000/staff/install'

const NAVIGATOR_STUBS = ['userAgent', 'platform', 'maxTouchPoints', 'clipboard']
let originalMatchMedia

function stubNavigator(userAgent, extra = {}) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent })
  Object.defineProperty(navigator, 'platform', { configurable: true, get: () => extra.platform ?? '' })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => extra.maxTouchPoints ?? 0 })
}

function stubStandalone() {
  originalMatchMedia = window.matchMedia
  window.matchMedia = (query) => ({
    media: query,
    matches: query === '(display-mode: standalone)',
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  })
}

afterEach(() => {
  NAVIGATOR_STUBS.forEach((name) => { delete navigator[name] })
  if (originalMatchMedia) window.matchMedia = originalMatchMedia
  originalMatchMedia = undefined
  resetStaffPwaForTests()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/staff/install']}>
      <Routes>
        <Route path="/staff/install" element={<StaffInstallPage />} />
        <Route path="/staff" element={<div>Staff sign-in page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fireInstallPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome: 'accepted' })
  act(() => { window.dispatchEvent(event) })
  return event
}

const stepsFor = (name) => screen.getByRole('button', { name, pressed: true })

describe('StaffInstallPage', () => {
  it('walks an iPhone in Safari through Share → Add to Home Screen', () => {
    stubNavigator(UA.iphoneSafari)
    renderPage()
    expect(screen.getByRole('heading', { name: 'Install the AshantiHub Staff app' })).toBeInTheDocument()
    expect(stepsFor('iPhone / iPad')).toBeInTheDocument()
    expect(screen.getByText('Add to Home Screen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Install AshantiHub Staff/ })).not.toBeInTheDocument()
  })

  it('sends an iPhone in another browser to Safari, with the link to copy', () => {
    stubNavigator(UA.iphoneChrome)
    renderPage()
    expect(screen.getByText(/Open this page in Safari/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
  })

  it("offers Android Chrome's own install dialog once Chrome provides it", async () => {
    stubNavigator(UA.androidChrome)
    await startStaffPwa({ enableServiceWorker: false })
    renderPage()
    expect(stepsFor('Android')).toBeInTheDocument()
    const event = fireInstallPrompt()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '⬇ Install AshantiHub Staff' })) })
    expect(event.prompt).toHaveBeenCalledTimes(1)
  })

  it("gives Android the browser-menu steps while Chrome hasn't offered its dialog yet", () => {
    stubNavigator(UA.androidChrome)
    renderPage()
    expect(stepsFor('Android')).toBeInTheDocument()
    expect(screen.getByText('Install app')).toBeInTheDocument()
    expect(screen.getByText(/An Install button may appear/)).toBeInTheDocument()
  })

  it("hands an Android app's built-in browser over to Chrome", () => {
    stubNavigator(UA.androidFacebook)
    renderPage()
    expect(screen.getByText(/can't be installed from inside another app/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Chrome' }))
      .toHaveAttribute('href', 'intent://localhost:3000/staff/install#Intent;scheme=http;package=com.android.chrome;end')
  })

  it("tells an iPhone app's built-in browser to open the link in Safari", () => {
    stubNavigator(UA.iphoneInstagram)
    renderPage()
    expect(screen.getByText(/can't be installed from inside another app/)).toBeInTheDocument()
    expect(screen.getByText(/Open in Safari/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open in Chrome' })).not.toBeInTheDocument()
  })

  it('asks a computer to open the link on the phone', () => {
    stubNavigator(UA.windowsChrome)
    renderPage()
    expect(stepsFor('Computer')).toBeInTheDocument()
    expect(screen.getByText(/Open this link on your phone/)).toBeInTheDocument()
    expect(screen.getAllByText('localhost:3000/staff/install').length).toBeGreaterThan(0)
  })

  it('lets the staffer switch to the steps for another phone', () => {
    stubNavigator(UA.iphoneSafari)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Android' }))
    expect(stepsFor('Android')).toBeInTheDocument()
    expect(screen.getByText('Install app')).toBeInTheDocument()
  })

  it('confirms once the app has been installed', async () => {
    stubNavigator(UA.androidChrome)
    await startStaffPwa({ enableServiceWorker: false })
    renderPage()
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(screen.getByText(/AshantiHub Staff is installed/)).toBeInTheDocument()
    expect(screen.queryByText('Staff sign-in page')).not.toBeInTheDocument()
  })

  it('opened from the home screen, goes straight to the staff sign-in', () => {
    stubNavigator(UA.iphoneSafari)
    stubStandalone()
    renderPage()
    expect(screen.getByText('Staff sign-in page')).toBeInTheDocument()
  })

  it('copies the install link', async () => {
    stubNavigator(UA.iphoneChrome)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })) })
    expect(writeText).toHaveBeenCalledWith(INSTALL_URL)
    expect(screen.getByRole('button', { name: '✓ Copied' })).toBeInTheDocument()
  })

  it('says how to copy by hand when the clipboard is blocked', async () => {
    stubNavigator(UA.iphoneInstagram)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    renderPage()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })) })
    expect(screen.getByText(/press and hold the link/)).toBeInTheDocument()
  })
})
