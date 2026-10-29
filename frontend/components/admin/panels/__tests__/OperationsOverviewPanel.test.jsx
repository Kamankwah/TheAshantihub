import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import OperationsOverviewPanel, { kpiCards } from '../OperationsOverviewPanel.jsx'

const API = 'http://localhost:8000'
const row = (over) => ({
  id: 1, name: 'Kwame Asante', areas: ['Asafo', 'Bantama'], manager: { id: 2, name: 'Ama' }, mine: true, state: 'working', back_on: null,
  measures: { registrations: { done: 2, target: 3 }, visits: { done: 0, target: 8 }, calls: { done: 0, target: 10 }, listings: { done: 0, target: 1 } },
  month: { done: 14, target: 81, due_by_today: 18, on_pace: false, leave_cut: 0 },
  portfolio: { size: 14, healthy: 11, needs_attention: 1, at_risk: 2, new: 0 },
  check_in: { place: "Nana's Chop Bar", at: '2026-10-07T10:52:00', outside_radius: false, distance_m: 12 }, outside_7d: 0, fraud_case_open: false,
  report: { today: { status: 'not_yet', due: '19:00', late: false, is_late: false }, last: null },
  ...over,
})
const overview = (over = {}) => ({
  period: 'today', today: '2026-10-07', now: '2026-10-07T11:46:00', scout_count: 2, month_label: 'October',
  kpis: {
    registrations: { done: 2, target: 6, planned: 2 }, activations: { count: 3, registered: 7 },
    approvals: { waiting: 2, oldest: { title: 'New business', target_label: "Nana's Chop Bar", created_at: new Date(Date.now() - 5 * 3600e3).toISOString() } },
    checked_in: { count: 1, working: 1, on_leave: ['Kofi Boadu'], flagged: 0 },
    at_risk: { count: 4, needs_attention: 2 }, issues: { total: 1, fraud: 1, support: null, delivery: null },
  },
  scouts: [row(), row({ id: 3, name: 'Kofi Boadu', state: 'leave', back_on: '2026-10-09', check_in: null })],
  totals: { registrations: { done: 2, target: 3 }, visits: { done: 0, target: 8 }, calls: { done: 0, target: 10 }, listings: { done: 0, target: 1 }, visits_flagged: 0 },
  waiting: [{ id: 41, title: "New business · Nana's Chop Bar", kind: 'business.kyc', target_label: "Nana's Chop Bar", maker: 'Kwame Asante', created_at: new Date(Date.now() - 5 * 3600e3).toISOString(), due_at: null, next_move: null }],
  issues: [{ id: 9, type: 'fraud', kind_label: 'Duplicate', business: 'Suame Auto Parts', business_id: 77, what: 'Same MoMo number', account_manager: 'Kwame Asante', opened_at: '2026-10-07T08:00:00Z', open_seconds: 3 * 3600 }],
  issue_total: 1,
  ...over,
})
const auth = { user: { full_name: 'Ama Boateng', role: 'operations' }, hasPermission: () => true }

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><OperationsOverviewPanel auth={auth} {...props} /></QueryClientProvider>)
}

describe('OperationsOverviewPanel', () => {
  it('shows the six counts, the scouts, what waits and the issues from the server', async () => {
    server.use(http.get(`${API}/api/operations/overview/`, () => HttpResponse.json(overview())))
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Operations overview' })).toBeInTheDocument()
    expect(within(await screen.findByRole('group', { name: 'Team registrations today' })).getByText('2 / 6')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Scouts checked in' })).getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText(/Kofi Boadu on leave/)).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'At-risk businesses' })).getByText('4')).toBeInTheDocument()
    expect(screen.getAllByText('Kwame Asante').length).toBeGreaterThan(0)
    expect(screen.getByText('On leave · back Fri 9 Oct')).toBeInTheDocument()
    expect(screen.getByText('Same MoMo number')).toBeInTheDocument()
  })

  it('leaves out the support and delivery counts when the caller may not read them', async () => {
    server.use(http.get(`${API}/api/operations/overview/`, () => HttpResponse.json(overview())))
    renderPanel()
    const issues = within(await screen.findByRole('group', { name: 'Open service issues' }))
    expect(issues.getByText('1')).toBeInTheDocument()
    expect(issues.getByText('1 fraud')).toBeInTheDocument()
    expect(screen.queryByText(/support/)).not.toBeInTheDocument()
  })

  it('shows the real support and dispute counts and lists service issues beside fraud', async () => {
    const data = overview()
    data.kpis.issues = { total: 3, fraud: 1, support: 2, delivery: 4 }
    data.issues.push({ id: 7, type: 'chat', type_label: 'Owner chat', kind_label: 'Owner chat', business: 'Adwoa Fabrics', business_id: 5, what: 'we paid on Saturday', account_manager: 'Kwame Asante', opened_at: '2026-10-07T08:00:00', open_seconds: 10800 })
    data.issue_total = 3
    server.use(http.get(`${API}/api/operations/overview/`, () => HttpResponse.json(data)))
    renderPanel()
    const issues = within(await screen.findByRole('group', { name: 'Open service issues' }))
    expect(issues.getByText('1 fraud · 2 support · 4 open disputes on deliveries')).toBeInTheDocument()
    expect(screen.getByText('Owner chat')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All service issues (2)' })).toBeInTheDocument()
  })

  it('says there is no target rather than showing 0 / 0 when no plan is set', () => {
    const data = overview()
    data.kpis.registrations = { done: 0, target: null, planned: 0 }
    expect(kpiCards(data, 'today').registrations).toMatchObject({ value: '0', sub: 'No targets set yet' })
  })

  it('asks the server for the chosen period', async () => {
    const seen = []
    server.use(http.get(`${API}/api/operations/overview/`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('period')); return HttpResponse.json(overview()) }))
    renderPanel()
    await screen.findByRole('heading', { name: 'Operations overview' })
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    await waitFor(() => expect(seen).toContain('week'))
    expect(await screen.findByRole('group', { name: 'Team registrations this week' })).toBeInTheDocument()
  })

  it('opens a waiting request and a business from the issue list', async () => {
    server.use(http.get(`${API}/api/operations/overview/`, () => HttpResponse.json(overview())))
    const onOpenApproval = vi.fn()
    const onOpenBusiness = vi.fn()
    renderPanel({ onOpenApproval, onOpenBusiness })
    fireEvent.click(await screen.findByRole('button', { name: /Open request/ }))
    expect(onOpenApproval).toHaveBeenCalledWith(41)
    fireEvent.click(screen.getByRole('button', { name: 'Suame Auto Parts' }))
    expect(onOpenBusiness).toHaveBeenCalledWith(77)
  })

  it('has honest empty states', async () => {
    server.use(http.get(`${API}/api/operations/overview/`, () => HttpResponse.json(overview({ scouts: [], waiting: [], issues: [], issue_total: 0, scout_count: 0 }))))
    renderPanel()
    expect(await screen.findByText('Nothing is waiting for your decision.')).toBeInTheDocument()
    expect(screen.getByText(/No scouts report to you yet/)).toBeInTheDocument()
    expect(screen.getByText(/No open fraud cases on your team's businesses/)).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    server.use(http.get(`${API}/api/operations/overview/`, () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the overview")
  })
})
