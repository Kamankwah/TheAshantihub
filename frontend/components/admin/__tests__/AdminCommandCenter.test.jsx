import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_ENDED_EVENT, UNAUTHORIZED_EVENT, apiFetch, setStoredAuth } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import AdminCommandCenter from '../AdminCommandCenter.jsx'
import { installMatchMedia } from '../../../test/matchMedia.js'

const PERMS = ['messaging.manage', 'disputes.flag', 'users.view']
export function makeAuth() {
  return {
    user: { token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support', role: 'support', permissions: PERMS },
    hasPermission: (c) => PERMS.includes(c),
    logout: vi.fn(),
  }
}
export function renderShell(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminCommandCenter auth={makeAuth()} onExit={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}
const panelNav = () => screen.getByRole('navigation', { name: 'Staff panels' })

// The shell signs out on mount without a stored staff session, so every test
// here starts signed in, as the app is.
const STORED = { token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support' }
beforeEach(() => setStoredAuth(STORED))
afterEach(() => { vi.restoreAllMocks(); setStoredAuth(null) })

describe('AdminCommandCenter — a session that is already gone', () => {
  it('signs out ("ended") when it mounts without a stored staff session', () => {
    setStoredAuth(null)
    sessionStorage.removeItem('ashantihub.signedOutReason')
    const onExit = vi.fn()
    renderShell({ onExit })
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('ashantihub.signedOutReason')).toBe('ended')
  })

  it('signs out when a 401 arrives while mounted and no staff session is stored', async () => {
    const onExit = vi.fn()
    renderShell({ onExit })
    expect(onExit).not.toHaveBeenCalled()
    setStoredAuth(null) // gone without a storage event (this same tab)
    server.use(http.get('http://localhost:8000/api/x/', () => new HttpResponse(null, { status: 401 })))
    await expect(apiFetch('/api/x/')).rejects.toMatchObject({ status: 401 })
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('signs out once per mount: a second reason does not call onExit again', () => {
    const onExit = vi.fn()
    renderShell({ onExit })
    act(() => { window.dispatchEvent(new Event(SESSION_ENDED_EVENT)) })
    setStoredAuth(null)
    act(() => { window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)) })
    act(() => { window.dispatchEvent(new Event(SESSION_ENDED_EVENT)) })
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'ashantihub.auth', newValue: null })) })
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('a stale 401 leaves a newer stored staff session signed in', async () => {
    const onExit = vi.fn()
    renderShell({ onExit })
    server.use(http.get('http://localhost:8000/api/x/', () => {
      setStoredAuth({ ...STORED, token: 'newer' })
      return new HttpResponse(null, { status: 401 })
    }))
    await expect(apiFetch('/api/x/')).rejects.toMatchObject({ status: 401 })
    expect(onExit).not.toHaveBeenCalled()
  })
})

describe('AdminCommandCenter — a registration draft on a shared phone', () => {
  const DRAFT = 'ashantihub.registerDraft.1'
  afterEach(() => localStorage.removeItem(DRAFT))

  it('Sign out clears the draft', () => {
    localStorage.setItem(DRAFT, '{"form":{"owner_full_name":"Gifty"}}')
    const onExit = vi.fn()
    renderShell({ onExit })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(DRAFT)).toBeNull()
  })

  it('an idle or ended sign-out keeps it, so the scout can carry on', () => {
    localStorage.setItem(DRAFT, '{"form":{"owner_full_name":"Gifty"}}')
    const onExit = vi.fn()
    renderShell({ onExit })
    act(() => { window.dispatchEvent(new Event(SESSION_ENDED_EVENT)) })
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(DRAFT)).not.toBeNull()
  })
})

describe('AdminCommandCenter — tab control', () => {
  it('uncontrolled: clicking a nav item switches panels and marks it current', () => {
    renderShell()
    fireEvent.click(within(panelNav()).getByRole('button', { name: /Users/ }))
    expect(within(panelNav()).getByRole('button', { name: /Users/ })).toHaveAttribute('aria-current', 'page')
  })

  it('controlled: renders the activeTab prop and reports clicks through onTabChange', () => {
    const onTabChange = vi.fn()
    renderShell({ activeTab: 'users', onTabChange })
    expect(within(panelNav()).getByRole('button', { name: /Users/ })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(panelNav()).getByRole('button', { name: /Messaging/ }))
    expect(onTabChange).toHaveBeenCalledWith('messaging')
  })

  it('controlled: clicking the already-active tab does not call onTabChange (no duplicate history entry)', () => {
    const onTabChange = vi.fn()
    renderShell({ activeTab: 'users', onTabChange })
    fireEvent.click(within(panelNav()).getByRole('button', { name: /Users/ }))
    expect(onTabChange).not.toHaveBeenCalled()
  })

  it('controlled: an unpermitted activeTab renders Overview and asks to replace with overview', () => {
    const onTabChange = vi.fn()
    renderShell({ activeTab: 'kyc', onTabChange })
    expect(screen.getByText(/Akwaaba, Akosua/)).toBeInTheDocument()
    expect(onTabChange).toHaveBeenCalledWith('overview', { replace: true })
  })

  it('scrolls to top on a panel change but not on first mount', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo')
    renderShell()
    expect(scrollTo).not.toHaveBeenCalled()
    fireEvent.click(within(panelNav()).getByRole('button', { name: /Users/ }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  })

  // The header's only way out of the dashboard is a real sign-out, in the
  // browser and the installed app alike (the old browser "← Exit" left the
  // staffer signed in on the marketplace).
  it('always offers Sign out, wired to onExit, and no "← Exit"', () => {
    const onExit = vi.fn()
    renderShell({ onExit })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '← Exit' })).not.toBeInTheDocument()
  })

  it('offers "View site" only when onViewSite is given (the browser, never the installed app)', () => {
    const { unmount } = renderShell()
    expect(screen.queryByRole('button', { name: 'View site' })).not.toBeInTheDocument()
    unmount()
    const onViewSite = vi.fn()
    const onExit = vi.fn()
    renderShell({ onViewSite, onExit })
    fireEvent.click(screen.getByRole('button', { name: 'View site' }))
    expect(onViewSite).toHaveBeenCalledTimes(1)
    expect(onExit).not.toHaveBeenCalled()
  })
})

describe('AdminCommandCenter — phone', () => {
  let mm
  afterEach(() => { mm?.restore(); document.documentElement.style.overflow = '' })

  it('replaces the sidebar with a bottom bar of Overview, three panels and More', () => {
    mm = installMatchMedia(375)
    renderShell()
    expect(screen.queryByRole('navigation', { name: 'Staff panels' })).not.toBeInTheDocument()
    const bar = screen.getByRole('navigation', { name: 'Quick navigation' })
    const labels = within(bar).getAllByRole('button').map((b) => b.textContent)
    // The support menu leads with Inbox (Messaging) per the approved staff design.
    expect(labels).toEqual(['📊Overview', '💬Messaging / Tickets', '⚖️Disputes', '👥Users', '☰More'])
  })

  it('opens the drawer from the header, locks scroll, and closes + restores focus on selection', () => {
    mm = installMatchMedia(375)
    renderShell()
    const menu = screen.getByRole('button', { name: 'Open navigation' })
    menu.focus()
    fireEvent.click(menu)
    const dialog = screen.getByRole('dialog', { name: 'Staff navigation' })
    expect(document.documentElement.style.overflow).toBe('hidden')
    fireEvent.click(within(dialog).getByRole('button', { name: /Users/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('')
    expect(menu).toHaveFocus()
  })

  it('opens the drawer from More and closes it on Escape and on backdrop tap', () => {
    mm = installMatchMedia(375)
    renderShell()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Quick navigation' })).getByRole('button', { name: /More/ }))
    expect(screen.getByRole('dialog', { name: 'Staff navigation' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    fireEvent.click(screen.getByTestId('staff-drawer-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the staffer name and the Sign out / View site actions inside the drawer, not the header', () => {
    mm = installMatchMedia(375)
    const onExit = vi.fn()
    const onViewSite = vi.fn()
    renderShell({ onExit, onViewSite })
    expect(screen.queryByText('Akosua Support')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const dialog = screen.getByRole('dialog', { name: 'Staff navigation' })
    expect(within(dialog).getByText('Akosua Support')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'View site' }))
    expect(onViewSite).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Staff navigation' })).getByRole('button', { name: 'Sign out' }))
    expect(onExit).toHaveBeenCalled()
  })

  it('closes the drawer when activeTab changes underneath it (Android back with the drawer open)', () => {
    mm = installMatchMedia(375)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const auth = makeAuth()
    const tree = (activeTab) => (
      <QueryClientProvider client={queryClient}>
        <AdminCommandCenter auth={auth} onExit={vi.fn()} activeTab={activeTab} onTabChange={vi.fn()} />
      </QueryClientProvider>
    )
    const { rerender } = render(tree('users'))
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('dialog', { name: 'Staff navigation' })).toBeInTheDocument()
    rerender(tree('messaging'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('returns focus to the menu button when the opener was never focused (iOS taps do not focus buttons)', () => {
    mm = installMatchMedia(375)
    renderShell()
    document.body.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' })) // click without focus, as on iOS
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus()
  })

  it('closes the drawer and unlocks scroll when the viewport grows to desktop', () => {
    mm = installMatchMedia(375)
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => mm.resize(1440))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('')
    expect(screen.getByRole('navigation', { name: 'Staff panels' })).toBeInTheDocument()
  })
})

describe('AdminCommandCenter — tablet', () => {
  let mm
  afterEach(() => mm?.restore())

  it('shows a collapsed icon rail with labelled buttons and a menu button, no bottom bar', () => {
    mm = installMatchMedia(1024)
    renderShell()
    const rail = screen.getByRole('navigation', { name: 'Staff panels' })
    expect(within(rail).getByRole('button', { name: 'Users' })).toHaveAttribute('title', 'Users')
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Quick navigation' })).not.toBeInTheDocument()
    expect(screen.queryByText('← Collapse')).not.toBeInTheDocument()
  })
})

describe('AdminCommandCenter — desktop (default)', () => {
  it('keeps the full sidebar, collapse control, and header identity with no menu button', () => {
    renderShell()
    expect(screen.getByText('← Collapse')).toBeInTheDocument()
    expect(screen.getByText('AshantiHub Staff')).toBeInTheDocument()
    expect(screen.getByText('Akosua Support')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
  })
})

describe('AdminCommandCenter — phone baseline CSS', () => {
  it('ships the phone touch-target, input-zoom and wrapping rules', () => {
    renderShell()
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n')
    expect(css).toMatch(/\.staff-shell\[data-bp="phone"\] \.staff-content button \{ min-height: 44px; \}/)
    expect(css).toMatch(/min-height: 44px; max-width: 100%/)
    expect(css).toMatch(/overflow-wrap: anywhere/)
  })
})
