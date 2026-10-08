import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { installMatchMedia } from '../../../../test/matchMedia.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import ScoutBottomBar from '../ScoutBottomBar.jsx'

const REGISTER = { id: 'register-business', icon: '➕', label: 'Register a business' }
const CALLS = { id: 'calls', icon: '📞', label: 'Call Log' }
const TASKS = { id: 'tasks', icon: '✅', label: 'Tasks' }
// Task 13 adds the real Portfolio item; the bar must already know its slot.
const PORTFOLIO = { id: 'portfolio', icon: '🏪', label: 'Portfolio' }
const groupsOf = (items) => [{ id: 'g', label: 'G', items }]

function renderBar(props = {}) {
  const onSelect = vi.fn()
  const onMenu = vi.fn()
  render(
    <ScoutBottomBar navGroups={groupsOf([REGISTER, CALLS, TASKS])} activeTab="register-business"
      onSelect={onSelect} onMenu={onMenu} badgeFor={() => 0} roleColor="#2C1810" {...props} />,
  )
  return { onSelect, onMenu }
}
const bar = () => screen.getByRole('navigation', { name: 'Quick navigation' })
const labels = () => within(bar()).getAllByRole('button').map((b) => b.textContent)

describe('ScoutBottomBar', () => {
  it('shows Register, Calls and Menu while the scout has no Portfolio yet', () => {
    renderBar()
    expect(labels()).toEqual(['➕Register', '📞Calls', '☰Menu'])
  })

  it('leads with Businesses once Portfolio is in the menu', () => {
    renderBar({ navGroups: groupsOf([PORTFOLIO, REGISTER, CALLS]) })
    expect(labels()).toEqual(['🏪Businesses', '➕Register', '📞Calls', '☰Menu'])
  })

  it('leaves out a slot the scout may not open', () => {
    renderBar({ navGroups: groupsOf([CALLS]) })
    expect(labels()).toEqual(['📞Calls', '☰Menu'])
  })

  it('marks the open slot current, opens a panel and opens the drawer', () => {
    const { onSelect, onMenu } = renderBar()
    expect(within(bar()).getByRole('button', { name: /Register/ })).toHaveAttribute('aria-current', 'page')
    expect(within(bar()).getByRole('button', { name: /Menu/ })).not.toHaveAttribute('aria-current')
    fireEvent.click(within(bar()).getByRole('button', { name: /Calls/ }))
    expect(onSelect).toHaveBeenCalledWith('calls')
    fireEvent.click(within(bar()).getByRole('button', { name: /Menu/ }))
    expect(onMenu).toHaveBeenCalledTimes(1)
  })

  it('reads as Menu when the open panel is not on the bar', () => {
    renderBar({ activeTab: 'tasks' })
    expect(within(bar()).getByRole('button', { name: /Menu/ })).toHaveAttribute('aria-current', 'page')
  })

  it('announces pending work on a slot', () => {
    renderBar({ badgeFor: (id) => (id === 'calls' ? 2 : 0) })
    expect(within(bar()).getByRole('button', { name: /Calls\s*, 2 pending/ })).toBeInTheDocument()
  })
})

describe('ScoutBottomBar in the staff shell', () => {
  const PERMS = ['businesses.register', 'calls.log', 'scouts.verify']
  const scoutAuth = () => ({
    user: { token: 't', account_type: 'staff', id: 9, full_name: 'Kwame Asante', role: 'scout', permissions: PERMS },
    hasPermission: (c) => PERMS.includes(c),
    logout: vi.fn(),
  })
  let mm
  beforeEach(() => {
    localStorage.clear()
    setStoredAuth({ token: 't', account_type: 'staff', id: 9, full_name: 'Kwame Asante' })
  })
  afterEach(() => { mm?.restore(); setStoredAuth(null); document.documentElement.style.overflow = '' })
  const renderShell = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><AdminCommandCenter auth={scoutAuth()} onExit={vi.fn()} /></QueryClientProvider>)
  }

  it("gives a scout's phone Register · Calls · Menu, and Menu opens the drawer", () => {
    mm = installMatchMedia(375)
    renderShell()
    expect(within(bar()).getAllByRole('button').map((b) => b.textContent)).toEqual(['➕Register', '📞Calls', '☰Menu'])
    fireEvent.click(within(bar()).getByRole('button', { name: /Menu/ }))
    expect(screen.getByRole('dialog', { name: 'Staff navigation' })).toBeInTheDocument()
  })

  it('opens Register a business from the bar', async () => {
    mm = installMatchMedia(375)
    renderShell()
    fireEvent.click(within(bar()).getByRole('button', { name: /Register/ }))
    expect(await screen.findByLabelText("Owner's full name (as on Ghana Card)")).toBeInTheDocument()
  })
})
