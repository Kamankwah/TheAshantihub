import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminCommandCenter from '../AdminCommandCenter.jsx'

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
