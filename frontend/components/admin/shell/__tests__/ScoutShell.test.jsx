import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import { installMatchMedia } from '../../../../test/matchMedia.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'

// The scout's shell on a phone (staff WP6): Today at the overview, the canvas
// menu in the drawer, and the profile / devices block.
const API = 'http://localhost:8000'
const PERMS = ['businesses.register', 'businesses.manage_portfolio', 'calls.log', 'scouts.verify', 'commission.view_own']
const session = (id, over = {}) => ({ id, device_label: 'Android, Chrome', ip: '1.2.3.4', created_at: new Date(Date.now() - 3600000).toISOString(), last_seen_at: new Date().toISOString(), is_active: true, is_current: false, two_factor: false, revoked_at: null, ...over })

let mm
const scoutAuth = (over = {}) => ({
  user: {
    token: 't', account_type: 'staff', id: 9, full_name: 'Kwame Asante', role: 'scout', permissions: PERMS,
    areas: ['Asafo', 'Bantama'], portfolio_count: 14, manager: { id: 2, full_name: 'Ama Boateng', role: 'operations' }, ...over,
  },
  hasPermission: (c) => PERMS.includes(c),
})
function renderShell({ auth = scoutAuth(), onExit = vi.fn(), ...props } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><AdminCommandCenter auth={auth} onExit={onExit} onViewSite={vi.fn()} {...props} /></QueryClientProvider>)
  return { onExit }
}
const openMenu = async () => {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Quick navigation' })).getByRole('button', { name: /Menu/ }))
  return screen.findByRole('dialog', { name: 'Staff navigation' })
}

beforeEach(() => {
  localStorage.clear()
  setStoredAuth({ token: 't', account_type: 'staff', id: 9, full_name: 'Kwame Asante' })
  mm = installMatchMedia(375)
})
afterEach(() => { mm?.restore(); setStoredAuth(null); document.documentElement.style.overflow = '' })

describe("a scout's shell", () => {
  it('opens on Today, titled Today, with the Today slot current', async () => {
    renderShell()
    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Kwame$/ })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Today')
    expect(within(screen.getByRole('navigation', { name: 'Quick navigation' })).getByRole('button', { name: /Today/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText(/Akwaaba/)).not.toBeInTheDocument()
  })

  it('shows the profile block: initials, role, areas, businesses and who they report to', async () => {
    renderShell()
    const drawer = await openMenu()
    expect(within(drawer).getByText('KA')).toBeInTheDocument()
    expect(within(drawer).getByText('Kwame Asante')).toBeInTheDocument()
    expect(within(drawer).getByText('scout')).toBeInTheDocument()
    expect(within(drawer).getByText('Asafo & Bantama · 14 businesses')).toBeInTheDocument()
    expect(within(drawer).getByText('Reports to Ama Boateng (Operations)')).toBeInTheDocument()
  })

  it('leaves the lead out when /me has none, and the areas out when there are none', async () => {
    renderShell({ auth: scoutAuth({ manager: null, areas: [], portfolio_count: 0 }) })
    const drawer = await openMenu()
    expect(within(drawer).queryByText(/Reports to/)).not.toBeInTheDocument()
    expect(within(drawer).getByText('0 businesses')).toBeInTheDocument()
  })

  it('lists the canvas groups and the Today row', async () => {
    renderShell()
    const drawer = await openMenu()
    const nav = within(drawer).getByRole('navigation', { name: 'Staff panels' })
    expect(within(nav).getByRole('button', { name: /Today/ })).toBeInTheDocument()
    for (const label of ['Pipeline', 'My businesses', 'Activity', 'Performance', 'Reports', 'Account']) expect(within(nav).getByText(label)).toBeInTheDocument()
    for (const label of ['Follow-ups', 'Sent for approval', 'Calls', 'Day, week & month', 'Profile & sign out', 'My activity']) expect(within(nav).getByText(label, { selector: 'span' })).toBeInTheDocument()
  })

  it('opens Sent for approval on the Made by me box', async () => {
    renderShell()
    const drawer = await openMenu()
    fireEvent.click(within(within(drawer).getByRole('navigation', { name: 'Staff panels' })).getByText('Sent for approval', { selector: 'span' }))
    expect(await screen.findByRole('button', { name: /Made by me/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('puts a neutral "Due 19:00" on Reports while today\'s report is unsubmitted', async () => {
    const due = new Date(); due.setHours(19, 0, 0, 0)
    server.use(http.get(`${API}/api/notifications/staff-badges/`, () => HttpResponse.json({ tasks_overdue: 0, approvals_waiting: 0, report_due_at: due.toISOString() })))
    renderShell()
    const drawer = await openMenu()
    expect(await within(drawer).findByText('Due 19:00')).toBeInTheDocument()
  })

  it('shows no due note once the report is in', async () => {
    server.use(http.get(`${API}/api/notifications/staff-badges/`, () => HttpResponse.json({ tasks_overdue: 0, approvals_waiting: 0, report_due_at: null })))
    renderShell()
    const drawer = await openMenu()
    expect(within(drawer).queryByText(/^Due /)).not.toBeInTheDocument()
  })

  it('lists the devices signed in, marks this one, and signs the others out', async () => {
    let ended = null
    let others = false
    server.use(
      http.get(`${API}/api/accounts/staff/sessions/`, () => HttpResponse.json([session(1, { device_label: 'This phone · Android, Chrome', is_current: true }), session(2, { device_label: 'Laptop · Windows, Chrome' })])),
      http.post(`${API}/api/accounts/staff/sessions/2/end/`, () => { ended = 2; return HttpResponse.json({}) }),
      http.post(`${API}/api/accounts/staff/sessions/end-others/`, () => { others = true; return HttpResponse.json({}) }),
    )
    renderShell()
    const drawer = await openMenu()
    const devices = await within(drawer).findByRole('region', { name: 'Signed in on' })
    expect(await within(devices).findByText('This phone · Android, Chrome')).toBeInTheDocument()
    expect(within(devices).getByText('This device')).toBeInTheDocument()
    expect(within(devices).getByText(/^Since /)).toBeInTheDocument()
    expect(within(devices).getByText(/^Last used /)).toBeInTheDocument()
    expect(within(devices).getAllByRole('button', { name: /^Sign out (?!all)/ })).toHaveLength(1)
    fireEvent.click(within(devices).getByRole('button', { name: 'Sign out Laptop · Windows, Chrome' }))
    await waitFor(() => expect(ended).toBe(2))
    fireEvent.click(within(devices).getByRole('button', { name: 'Sign out all other devices' }))
    await waitFor(() => expect(others).toBe(true))
    expect(within(devices).getByText("For safety you're signed out after 30 minutes without use, and after 12 hours.")).toBeInTheDocument()
  })

  it('offers no sign-out-others when this is the only device', async () => {
    server.use(http.get(`${API}/api/accounts/staff/sessions/`, () => HttpResponse.json([session(1, { is_current: true })])))
    renderShell()
    const drawer = await openMenu()
    await within(drawer).findByText('This device')
    expect(within(drawer).queryByRole('button', { name: 'Sign out all other devices' })).not.toBeInTheDocument()
  })

  it('keeps View site and Sign out', async () => {
    const onViewSite = vi.fn()
    const { onExit } = renderShell({ onViewSite })
    const drawer = await openMenu()
    fireEvent.click(within(drawer).getByRole('button', { name: 'View site' }))
    expect(onViewSite).toHaveBeenCalled()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Sign out' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('opens the check-in screen from Today', async () => {
    const onTabChange = vi.fn()
    renderShell({ activeTab: 'overview', onTabChange })
    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }))
    expect(onTabChange).toHaveBeenCalledWith('visits/check-in')
  })
})

describe("other roles' shells are unchanged", () => {
  it('keeps Overview, Akwaaba and the Overview / More bar for an Operations lead', async () => {
    const OPS = ['approvals.decide']
    const auth = { user: { token: 't', account_type: 'staff', id: 2, full_name: 'Ama Boateng', role: 'operations', permissions: OPS }, hasPermission: (c) => OPS.includes(c) }
    renderShell({ auth })
    expect(await screen.findByText(/Akwaaba, Ama!/)).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Overview')
    expect(within(screen.getByRole('navigation', { name: 'Quick navigation' })).getByRole('button', { name: /Overview/ })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Quick navigation' })).getByRole('button', { name: /More/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Staff navigation' })
    expect(within(drawer).queryByText(/Reports to/)).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('region', { name: 'Signed in on' })).not.toBeInTheDocument()
  })
})
