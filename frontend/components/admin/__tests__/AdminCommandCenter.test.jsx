import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => vi.restoreAllMocks())

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

  it('uses the exitLabel prop for the exit button', () => {
    renderShell({ exitLabel: 'Sign out' })
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
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
    expect(labels).toEqual(['📊Overview', '⚖️Disputes', '👥Users', '💬Messaging / Tickets', '☰More'])
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

  it('shows the staffer name and exit action inside the drawer, not the header', () => {
    mm = installMatchMedia(375)
    const onExit = vi.fn()
    renderShell({ onExit })
    expect(screen.queryByText('Akosua Support')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const dialog = screen.getByRole('dialog', { name: 'Staff navigation' })
    expect(within(dialog).getByText('Akosua Support')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '← Exit' }))
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
