import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InstallAppButton from '../InstallAppButton.jsx'
import UpdateToast from '../UpdateToast.jsx'
import OfflineBanner from '../OfflineBanner.jsx'
import { resetStaffPwaForTests, startStaffPwa } from '../../../../lib/staffPwa.js'
import { reportApiNetworkFailure, reportApiResponse, resetNetworkStatusForTests } from '../../../../lib/networkStatus.js'

afterEach(() => {
  resetStaffPwaForTests()
  try { localStorage.clear() } catch { /* ignore */ }
})

function fireInstallPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome: 'accepted' })
  act(() => { window.dispatchEvent(event) })
  return event
}

describe('InstallAppButton', () => {
  it('renders nothing without a prompt on a non-iOS browser', () => {
    resetStaffPwaForTests({ isIOS: false })
    const { container } = render(<InstallAppButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers the deferred install prompt and hides after use', async () => {
    resetStaffPwaForTests({ isIOS: false })
    await startStaffPwa({ enableServiceWorker: false })
    render(<InstallAppButton />)
    const event = fireInstallPrompt()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '⬇ Install app' })) })
    expect(event.prompt).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '⬇ Install app' })).not.toBeInTheDocument()
  })

  it('is hidden when already running as an installed app', async () => {
    resetStaffPwaForTests({ isStandalone: true, isIOS: true })
    const { container } = render(<InstallAppButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the Add to Home Screen hint on iOS and remembers dismissal', () => {
    resetStaffPwaForTests({ isIOS: true, isStandalone: false })
    const { unmount } = render(<InstallAppButton variant="drawer" />)
    fireEvent.click(screen.getByRole('button', { name: '⬇ Install app' }))
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('button', { name: '⬇ Install app' })).not.toBeInTheDocument()
    unmount()
    const { container } = render(<InstallAppButton variant="drawer" />)
    expect(container).toBeEmptyDOMElement()
  })
})

function fakeWorkbox() {
  const handlers = {}
  return {
    addEventListener: (type, handler) => { (handlers[type] ||= []).push(handler) },
    register: () => Promise.resolve({ update: vi.fn() }),
    messageSkipWaiting: vi.fn(),
    emit(type, data = {}) { (handlers[type] || []).forEach((handler) => handler({ type, ...data })) },
  }
}

describe('UpdateToast', () => {
  let reload
  let locationSpy
  beforeEach(() => {
    reload = vi.fn()
    locationSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
  })
  afterEach(() => locationSpy.mockRestore())

  it('appears when a new worker is waiting and, on Reload, activates it and reloads this tab', async () => {
    const wb = fakeWorkbox()
    await startStaffPwa({ enableServiceWorker: true, createWorkbox: () => wb })
    render(<UpdateToast />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => wb.emit('waiting'))
    expect(screen.getByRole('status')).toHaveTextContent('A new version of AshantiHub Staff is available.')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
    act(() => wb.emit('controlling', { isUpdate: true }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('Later hides it without reloading', async () => {
    const wb = fakeWorkbox()
    await startStaffPwa({ enableServiceWorker: true, createWorkbox: () => wb })
    render(<UpdateToast />)
    act(() => wb.emit('waiting'))
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('when another tab applied the update, says so and reloads only on request', async () => {
    const wb = fakeWorkbox()
    await startStaffPwa({ enableServiceWorker: true, createWorkbox: () => wb })
    render(<UpdateToast />)
    act(() => wb.emit('waiting'))
    act(() => wb.emit('controlling', { isUpdate: true }))
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent("AshantiHub Staff was updated in another tab. Reload when you're ready.")
    expect(screen.queryByText('A new version of AshantiHub Staff is available.')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Later', 'Reload'])
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('Later hides the updated-elsewhere notice without reloading', async () => {
    const wb = fakeWorkbox()
    await startStaffPwa({ enableServiceWorker: true, createWorkbox: () => wb })
    render(<UpdateToast />)
    act(() => wb.emit('controlling', { isUpdate: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('OfflineBanner', () => {
  afterEach(() => { delete navigator.onLine; resetNetworkStatusForTests() })

  it('shows only while the browser is offline', () => {
    let online = true
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => { online = false; window.dispatchEvent(new Event('offline')) })
    expect(screen.getByRole('status')).toHaveTextContent("You're offline — staff actions need a connection.")
    act(() => { online = true; window.dispatchEvent(new Event('online')) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows when an API request fails at the network level even though navigator.onLine is true, and hides on the next response', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    render(<OfflineBanner bleed={12} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => reportApiNetworkFailure())
    expect(screen.getByRole('status')).toHaveTextContent("You're offline — staff actions need a connection.")
    expect(screen.getByRole('status')).toHaveStyle({ margin: '0 -12px' })
    act(() => reportApiResponse())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
