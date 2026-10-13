import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ReportsHubPanel from '../ReportsHubPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

const person = (id, name, role, state, report) => ({ staff: { id, full_name: name, role }, team: role === 'scout' ? 'scouts' : role, manager: 'Ama Boateng', state, due_at: '2026-10-12T19:00:00Z', report })
const report = (id, over = {}) => ({ id, status: 'submitted', is_late: false, submitted_at: '2026-10-12T17:00:00Z', similar_warning: false, similarity: 0, review_note: '', reviewed_at: null, reviewer: null, can_review: true, ...over })

const hub = (over = {}) => ({
  period: 'day', from: '2026-10-12', to: '2026-10-12', due_time: '19:00',
  teams: [{ key: 'scouts', label: 'Scouts', reviewers: ['Ama Boateng'], expected: 3, due: 3, on_time: 1, late: 1, missing: 1, acknowledged: 1, on_time_share: 33 }],
  everyone: { expected: 3, due: 3, on_time: 1, late: 1, missing: 1, acknowledged: 1, on_time_share: 33 },
  kpis: { waiting: 1, today_sent: 1, today_expected: 3, yesterday_on_time: 1, yesterday_due: 3, yesterday_late: 1, yesterday_missing: 1 },
  rows: [
    person(1, 'Kwame Asante', 'scout', 'submitted', report(11)),
    person(2, 'Yaw Owusu', 'scout', 'late', report(12, { is_late: true, can_review: false, similar_warning: true, similarity: 0.84 })),
    person(3, 'Esi Nyarko', 'scout', 'missing', null),
  ],
  role_options: [{ key: 'scouts', label: 'Scouts' }],
  ...over,
})

describe('ReportsHubPanel', () => {
  it('counts every team and flags late, missing and copied reports', async () => {
    server.use(http.get(`${API}/api/insights/reports-hub/`, () => HttpResponse.json(hub())))
    wrap(<ReportsHubPanel />)
    expect(await screen.findByRole('group', { name: 'Waiting for you' })).toHaveTextContent('1')
    expect(screen.getByRole('group', { name: 'Today so far' })).toHaveTextContent('1 of 3')
    const team = screen.getByRole('row', { name: /Scouts Ama Boateng/ })
    expect(within(team).getByText('33%')).toBeInTheDocument()
    expect(within(screen.getByText('Esi Nyarko').closest('tr')).getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText(/Reads like an earlier one \(84%\)/)).toBeInTheDocument()
    expect(screen.getByText('Not submitted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Review Kwame Asante's report" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Open Yaw Owusu's report" })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Esi Nyarko/ })).not.toBeInTheDocument()
  })

  it('acknowledges from the opened report through the reports endpoint', async () => {
    const posts = []
    server.use(
      http.get(`${API}/api/insights/reports-hub/`, () => HttpResponse.json(hub())),
      http.get(`${API}/api/reports/11/`, () => HttpResponse.json({ id: 11, staff: { id: 1, full_name: 'Kwame Asante', role: 'scout' }, period: 'day', period_start: '2026-10-12', status: 'submitted', can_review: true, system: [], system_is_live: false, achievements: 'Visited weavers', blockers: '', plan_next: [], plan_results: [], submitted_at: '2026-10-12T17:00:00Z', similarity: 0 })),
      http.post(`${API}/api/reports/11/acknowledge/`, () => { posts.push('ack'); return HttpResponse.json({ id: 11, status: 'acknowledged' }) }),
    )
    wrap(<ReportsHubPanel />)
    fireEvent.click(await screen.findByRole('button', { name: "Review Kwame Asante's report" }))
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(posts).toEqual(['ack']))
  })

  it('filters by status and person through the server', async () => {
    const seen = []
    server.use(http.get(`${API}/api/insights/reports-hub/`, ({ request }) => { seen.push(Object.fromEntries(new URL(request.url).searchParams)); return HttpResponse.json(hub()) }))
    wrap(<ReportsHubPanel />)
    await screen.findByRole('group', { name: 'Waiting for you' })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'missing' } })
    await waitFor(() => expect(seen.some((q) => q.status === 'missing')).toBe(true))
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'esi' } })
    await waitFor(() => expect(seen.some((q) => q.person === 'esi')).toBe(true))
  })

  it('says nobody owed a report rather than drawing an empty table', async () => {
    server.use(http.get(`${API}/api/insights/reports-hub/`, () => HttpResponse.json(hub({ teams: [], rows: [], everyone: { expected: 0, due: 0, on_time: 0, late: 0, missing: 0, acknowledged: 0, on_time_share: null } }))))
    wrap(<ReportsHubPanel />)
    expect(await screen.findByText('Nobody owed a report for this period.')).toBeInTheDocument()
    expect(screen.getByText('No reports match.')).toBeInTheDocument()
  })
})
