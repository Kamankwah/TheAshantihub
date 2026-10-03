import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InstallAppButton from '../InstallAppButton.jsx'
import UpdateToast from '../UpdateToast.jsx'
import OfflineBanner from '../OfflineBanner.jsx'
import { resetStaffPwaForTests, startStaffPwa } from '../../../../lib/staffPwa.js'

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

describe('UpdateToast', () => {
  it('appears when a new worker is waiting and reloads into it', async () => {
    let needRefresh
    const updateSW = vi.fn()
    await startStaffPwa({ enableServiceWorker: true, register: ({ onNeedRefresh }) => { needRefresh = onNeedRefresh; return updateSW } })
    render(<UpdateToast />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => needRefresh())
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('Later hides it without reloading', async () => {
    let needRefresh
    const updateSW = vi.fn()
    await startStaffPwa({ enableServiceWorker: true, register: ({ onNeedRefresh }) => { needRefresh = onNeedRefresh; return updateSW } })
    render(<UpdateToast />)
    act(() => needRefresh())
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(updateSW).not.toHaveBeenCalled()
  })
})

describe('OfflineBanner', () => {
  afterEach(() => { delete navigator.onLine })

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
})
