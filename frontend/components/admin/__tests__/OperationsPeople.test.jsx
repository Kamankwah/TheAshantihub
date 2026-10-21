import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import { installMatchMedia } from '../../../test/matchMedia.js'
import AdminCommandCenter from '../AdminCommandCenter.jsx'

const API = 'http://localhost:8000'
const OPS = [
  'kyc.approve', 'scouts.assign', 'listings.moderate', 'hero_media.approve', 'event.approve', 'reviews.moderate', 'users.view', 'users.manage',
  'orders.manage_delivery', 'site_settings.manage', 'zones.manage', 'contact_messages.manage', 'staff.invite_team', 'activity.view_team',
  'calls.log', 'businesses.register', 'portfolio.manage', 'targets.manage', 'leave.record', 'fraud.manage', 'fraud.flag', 'service_issues.view',
]
const auth = () => ({
  user: { token: 't', account_type: 'staff', id: 2, full_name: 'Ama Boateng', role: 'operations', permissions: OPS },
  hasPermission: (c) => OPS.includes(c), logout: vi.fn(),
})

function Harness({ start }) {
  const [tab, setTab] = useState(start)
  return <AdminCommandCenter auth={auth()} onExit={vi.fn()} activeTab={tab} onTabChange={setTab} />
}
function renderAt(start) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><Harness start={start} /></QueryClientProvider>)
}

beforeEach(() => { installMatchMedia?.(); setStoredAuth({ token: 't', account_type: 'staff', id: 2, full_name: 'Ama Boateng' }) })
afterEach(() => setStoredAuth(null))

describe('Operations People screens in the shell', () => {
  it('opens the real Scouts, Targets, Leave and Invite screens, not placeholders', async () => {
    server.use(
      http.get(`${API}/api/operations/scouts/`, () => HttpResponse.json({ scope: 'team', today: '2026-10-07', month_label: 'October', counts: { team: 0, all: 0 }, totals: { registrations: { done: 0, target: 0 }, visits: { done: 0, target: 0 }, calls: { done: 0, target: 0 }, listings: { done: 0, target: 0 }, visits_flagged: 0 }, scouts: [] })),
      http.get(`${API}/api/targets/plans/`, () => HttpResponse.json({ metrics: [], today: '2026-10-07', limits: [], staff: [] })),
      http.get(`${API}/api/targets/history/`, () => HttpResponse.json([])),
      http.get(`${API}/api/targets/leave/`, () => HttpResponse.json([])),
      http.get(`${API}/api/targets/holidays/`, () => HttpResponse.json([])),
      http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json([])),
      http.get(`${API}/api/accounts/staff/invitable-roles/`, () => HttpResponse.json(['scout', 'support'])),
      http.get(`${API}/api/operations/invites/`, () => HttpResponse.json({ pending: [], joined: [], zones: [], link_days: 7 })),
    )
    for (const [tab, heading] of [['ops-scouts', 'Scouts'], ['targets', 'Targets'], ['leave', 'Leave & calendar'], ['my-team', 'Invite to your team']]) {
      document.body.innerHTML = ''
      renderAt(tab)
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      expect(screen.queryByText('This screen is being built')).not.toBeInTheDocument()
    }
  }, 15000) // four full shell mounts in one test: the 5 s default is too tight now the shell carries the delivery screens

  it("the scoreboard's Open lands on All portfolios filtered to that scout", async () => {
    let scoutParam = null
    server.use(
      http.get(`${API}/api/operations/scouts/`, () => HttpResponse.json({
        scope: 'team', today: '2026-10-07', month_label: 'October', counts: { team: 1, all: 1 },
        totals: { registrations: { done: 0, target: 3 }, visits: { done: 0, target: 8 }, calls: { done: 0, target: 10 }, listings: { done: 0, target: 1 }, visits_flagged: 0 },
        scouts: [{ id: 41, name: 'Kwame Asante', areas: [], manager: { id: 2, name: 'Ama Boateng' }, mine: true, state: 'working', back_on: null,
          measures: { registrations: { done: 0, target: 3 }, visits: { done: 0, target: 8 }, calls: { done: 0, target: 10 }, listings: { done: 0, target: 1 } },
          month: { done: 0, target: 81, due_by_today: 18, on_pace: false, leave_cut: 0 }, portfolio: { size: 0, healthy: 0, needs_attention: 0, at_risk: 0, new: 0 },
          check_in: null, outside_7d: 0, fraud_case_open: false, report: { today: { status: 'not_yet', due: '19:00', late: false, is_late: false }, last: null } }],
      })),
      http.get(`${API}/api/portfolio/businesses/`, ({ request }) => { scoutParam = new URL(request.url).searchParams.get('scout'); return HttpResponse.json({ count: 0, next: null, previous: null, results: [], summary: {} }) }),
    )
    renderAt('ops-scouts')
    fireEvent.click(await screen.findByRole('button', { name: 'Open Kwame Asante' }))
    await waitFor(() => expect(scoutParam).toBe('41'))
  })

  it('other roles still get the original My Team panel', async () => {
    server.use(http.get(`${API}/api/accounts/staff/team/`, () => HttpResponse.json([])), http.get(`${API}/api/accounts/staff/invitable-roles/`, () => HttpResponse.json(['dispatch'])))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const dm = { user: { token: 't', account_type: 'staff', id: 5, full_name: 'Adwoa', role: 'delivery_manager', permissions: ['staff.invite_team'] }, hasPermission: (c) => c === 'staff.invite_team', logout: vi.fn() }
    render(<QueryClientProvider client={queryClient}><AdminCommandCenter auth={dm} onExit={vi.fn()} activeTab="my-team" onTabChange={() => {}} /></QueryClientProvider>)
    expect(await screen.findByText('Invite to your team')).toBeInTheDocument()
    expect(screen.queryByText('Pending invites')).not.toBeInTheDocument()
  })

  it('shows the Operations overview, not the generic KPI page, on Overview', async () => {
    server.use(http.get(`${API}/api/operations/overview/`, () => HttpResponse.json({
      period: 'today', today: '2026-10-07', now: '2026-10-07T11:46:00', scout_count: 0, month_label: 'October',
      kpis: {
        registrations: { done: 0, target: null, planned: 0 }, activations: { count: 0, registered: 0 }, approvals: { waiting: 0, oldest: null },
        checked_in: { count: 0, working: 0, on_leave: [], flagged: 0 }, at_risk: { count: 0, needs_attention: 0 }, issues: { total: 0, fraud: 0, support: null, delivery: null },
      },
      scouts: [], totals: { registrations: { done: 0, target: 0 }, visits_flagged: 0 }, waiting: [], issues: [], issue_total: 0,
    })))
    renderAt('overview')
    expect(await screen.findByRole('heading', { name: 'Operations overview' })).toBeInTheDocument()
    expect(screen.queryByText(/Akwaaba/)).not.toBeInTheDocument()
  })
})
