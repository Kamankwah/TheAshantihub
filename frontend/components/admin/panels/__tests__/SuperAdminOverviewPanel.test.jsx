import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SuperAdminOverviewPanel from '../SuperAdminOverviewPanel.jsx'

const API = 'http://localhost:8000'
const overview = (over = {}) => ({
  now: '2026-10-13T11:46:00',
  kpis: {
    decisions: { waiting: 2, escalated: 1, open_everywhere: 5 }, staff_online: { online: 3, active: 20 }, fraud_open: 0,
    reports_today: { submitted: 4 }, at_risk: { count: 6, needs_attention: 2 }, service_issues: 7,
  },
  waiting: [
    { id: 41, title: 'October payout', kind: 'x', kind_label: 'Payout', target_label: '', maker: 'Kwabena Ofori', maker_role: 'accountant', amount: '25000.00', requires_sudo: true, created_at: new Date(Date.now() - 5 * 3600e3).toISOString(), due_at: null, escalation_level: 1 },
    { id: 42, title: 'Rename Esi', kind: 'y', kind_label: 'Rename', target_label: '', maker: 'Kwame Asante', maker_role: 'scout', amount: null, requires_sudo: false, created_at: new Date(Date.now() - 3600e3).toISOString(), due_at: null, escalation_level: 0 },
  ],
  teams: [
    { role: 'operations', label: 'Operations & scouts', step_in: 'step-in-operations', staff: 5, online: 2, work: ['1 of 3 scouts checked in'], flag: '1 visit(s) outside the radius' },
    { role: 'marketing', label: 'Marketing', step_in: 'step-in-marketing', staff: 1, online: 0, work: [], flag: null },
  ],
  platform: [
    { key: 'database', name: 'Database', state: 'ok', detail: 'Answering' },
    { key: 'payments', name: 'Payments', state: 'simulated', detail: 'Simulated until Hubtel is connected' },
    { key: 'sms', name: 'SMS', state: 'not_connected', detail: 'Not connected' },
  ],
  not_tracked: ['Service time limits missed', 'Payouts waiting', 'SMS balance'],
  ...over,
})

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SuperAdminOverviewPanel auth={{ user: { full_name: 'Simon Peter' } }} {...props} /></QueryClientProvider>)
}

describe('SuperAdminOverviewPanel', () => {
  it('shows real counts, the decisions waiting and an honest platform strip', async () => {
    server.use(http.get(`${API}/api/operations/superadmin-overview/`, () => HttpResponse.json(overview())))
    const onOpenApproval = vi.fn()
    renderPanel({ onOpenApproval })
    expect(screen.getByRole('heading', { name: 'Command center' })).toBeInTheDocument()
    expect(within(await screen.findByRole('group', { name: 'Decisions waiting for you' })).getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Decisions waiting for you' })).toHaveTextContent('1 escalated to you · 5 open across AshantiHub')
    expect(screen.getByRole('group', { name: 'Staff online' })).toHaveTextContent('3 / 20')
    expect(screen.getByText(/GH₵ 25,000.00/)).toBeInTheDocument()
    expect(screen.getByText('Asks for your password')).toBeInTheDocument()
    expect(screen.getByText('Simulated')).toBeInTheDocument()
    expect(screen.getAllByText('Not connected')).toHaveLength(2)
    expect(screen.getByText(/Not tracked yet: service time limits missed, payouts waiting, sms balance/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review: October payout' }))
    expect(onOpenApproval).toHaveBeenCalledWith(41)
  })

  it('draws each team with what is real and steps in', async () => {
    server.use(http.get(`${API}/api/operations/superadmin-overview/`, () => HttpResponse.json(overview())))
    const onNavigate = vi.fn()
    renderPanel({ onNavigate })
    const ops = await screen.findByRole('group', { name: 'Operations & scouts' })
    expect(ops).toHaveTextContent('2 of 5 online')
    expect(ops).toHaveTextContent('1 of 3 scouts checked in')
    expect(ops).toHaveTextContent('1 visit(s) outside the radius')
    expect(screen.getByRole('group', { name: 'Marketing' })).toHaveTextContent('No work figures for this team yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Step in: Operations & scouts' }))
    expect(onNavigate).toHaveBeenCalledWith('step-in-operations')
  })

  it('says nothing is waiting instead of inventing rows, and reports a load failure', async () => {
    server.use(http.get(`${API}/api/operations/superadmin-overview/`, () => HttpResponse.json(overview({ waiting: [] }))))
    renderPanel()
    expect(await screen.findByText('Nothing is waiting for your decision.')).toBeInTheDocument()
  })

  it('offers a retry when the overview cannot load', async () => {
    server.use(http.get(`${API}/api/operations/superadmin-overview/`, () => new HttpResponse(null, { status: 500 })))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the command center")
  })

  it("offers a General Manager the same figures without the Super Admin-only step-in links", async () => {
    server.use(http.get(`${API}/api/operations/superadmin-overview/`, () => HttpResponse.json(overview())))
    const onNavigate = vi.fn()
    renderPanel({ onNavigate, auth: { user: { full_name: 'Esi Manu', role: 'general_manager' } } })
    expect(await screen.findByRole('group', { name: 'Operations & scouts' })).toHaveTextContent('2 of 5 online')
    expect(screen.queryByRole('button', { name: /Step in/ })).toBeNull()
    expect(screen.queryByText(/Open a team to see its workspace/)).toBeNull()
  })
})
