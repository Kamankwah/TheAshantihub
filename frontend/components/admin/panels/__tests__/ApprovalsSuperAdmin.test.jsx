import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ApprovalsPanel from '../ApprovalsPanel.jsx'

const API = 'http://localhost:8000'
const HOUR = 3600 * 1000
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const row = (overrides = {}) => ({
  id: 12, kind: 'test.money', kind_label: 'Money (test)', title: 'October payout', status: 'pending', stage: 'super_admin',
  maker: { id: 5, full_name: 'Kwabena Ofori', role: 'accountant' }, assigned_to: null, amount: '25000.00', requires_sudo: true,
  target: { type: '', id: '', label: '' }, maker_note: '', decided_by: null, decided_at: null, decision_note: '',
  due_at: iso(10 * HOUR), escalation_level: 1, created_at: iso(-30 * HOUR), can_decide: true, can_cancel: false,
  maker_team: { mine: false, manager: null }, escalated: true, next_move: null, ...overrides,
})
const page = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })
const COUNTS = {
  mine: 1, made: 0, team: 0, decided: 0, escalated_to_me: 1, can_view_all: true, all_open: 4, teams: ['accountant', 'scout'], levels: [0, 1],
  makers: [], kinds: [{ key: 'test.money', label: 'Money (test)', response_hours: 24 }],
}

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ApprovalsPanel detailId={null} onOpenDetail={() => {}} {...props} /></QueryClientProvider>)
}

describe('My approvals (Super Admin)', () => {
  it('shows the glance row, the amount column and the open-everywhere count', async () => {
    const urls = []
    server.use(
      http.get(`${API}/api/approvals/counts/`, () => HttpResponse.json(COUNTS)),
      http.get(`${API}/api/approvals/`, ({ request }) => { urls.push(new URL(request.url)); return page([row(), row({ id: 13, title: 'Rename', amount: null, requires_sudo: false, escalation_level: 0, escalated: false })]) }),
    )
    renderPanel()
    const table = await screen.findByRole('table', { name: 'Requests' })
    expect(within(table).getByText('GH₵ 25,000.00')).toBeInTheDocument()
    expect(within(table).getByText('No amount')).toBeInTheDocument()
    expect(within(table).getByText('Level 2 (moved up 1×)')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Open across AshantiHub' })).toHaveTextContent('4')
    expect(screen.getByRole('button', { name: /^Everything · 4$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelled & expired' })).toBeInTheDocument()
    expect(urls.some((u) => u.searchParams.get('box') === 'mine')).toBe(true)
  })

  it('sends the team, level and amount filters, and the closed tab asks for cancelled and expired', async () => {
    const urls = []
    server.use(
      http.get(`${API}/api/approvals/counts/`, () => HttpResponse.json(COUNTS)),
      http.get(`${API}/api/approvals/`, ({ request }) => { urls.push(new URL(request.url)); return page([]) }),
    )
    renderPanel()
    await screen.findByLabelText('Team')
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'accountant' } })
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Amount from (GH₵)'), { target: { value: '20000' } })
    await waitFor(() => {
      const last = urls[urls.length - 1].searchParams
      expect(last.get('team')).toBe('accountant')
      expect(last.get('level')).toBe('1')
      expect(last.get('amount_min')).toBe('20000')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled & expired' }))
    await waitFor(() => {
      const last = urls[urls.length - 1].searchParams
      expect(last.get('box')).toBe('all')
      expect(last.get('status')).toBe('cancelled,expired')
    })
  })

  it('does not show the Super Admin filters to anyone else', async () => {
    server.use(http.get(`${API}/api/approvals/counts/`, () => HttpResponse.json({ ...COUNTS, can_view_all: false, all_open: null, teams: [] })))
    renderPanel()
    await screen.findByLabelText('Kind')
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelled & expired' })).not.toBeInTheDocument()
  })
})

describe('Approval detail for a money request', () => {
  const detail = (over = {}) => ({ ...row(over), payload: {}, before: {}, diff: [], stale: false, timeline: [], consequences: [] })

  it('says what the request holds, warns about the password and returns with a note', async () => {
    const posts = []
    server.use(
      http.get(`${API}/api/approvals/12/`, () => HttpResponse.json(detail())),
      http.post(`${API}/api/approvals/12/reject/`, async ({ request }) => { posts.push(await request.json()); return HttpResponse.json(detail({ status: 'rejected' })) }),
    )
    renderPanel({ detailId: 12 })
    expect(await screen.findByText(/This request carries one amount, GH₵ 25,000.00/)).toBeInTheDocument()
    expect(screen.getByText(/line-by-line pay detail arrives with the Accounting phase/)).toBeInTheDocument()
    expect(screen.getByText(/Approving this asks for your password again/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve with password' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Who signs off' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Return with note' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Note to Kwabena Ofori/), { target: { value: 'Check the lines' } })
    fireEvent.click(screen.getByRole('button', { name: 'Return with note' }))
    await waitFor(() => expect(posts).toEqual([{ note: 'Check the lines' }]))
  })

  it('shows no amount note on a request without one', async () => {
    server.use(http.get(`${API}/api/approvals/12/`, () => HttpResponse.json(detail({ amount: null, requires_sudo: false }))))
    renderPanel({ detailId: 12 })
    await screen.findByRole('heading', { name: 'Your decision' })
    expect(screen.queryByText(/This request carries one amount/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('shows approver 1 of 2 and a waiting co-signer, saying plainly when none is named', async () => {
    const signoff = { required: 2, waiting_on: 'cosigner', cosigner_named: false, signed: [{ slot: 'approver', staff: { id: 1, full_name: 'Simon Peter', role: 'super_admin' }, at: '2026-10-12T10:00:00Z', note: '' }] }
    server.use(http.get(`${API}/api/approvals/12/`, () => HttpResponse.json(detail({ required_approvals: 2, signoff }))))
    renderPanel({ detailId: 12 })
    expect(await screen.findByText('Approver 1 of 2: Simon Peter approved')).toBeInTheDocument()
    expect(screen.getByText(/Co-signer 2 of 2: waiting — no co-signer is named yet, so this cannot be released/)).toBeInTheDocument()
    expect(screen.getByText(/needs two different people \(1 of 2 so far\)/)).toBeInTheDocument()
    expect(screen.getByText(/Now: Waiting for a co-signer \(none named yet\)/)).toBeInTheDocument()
  })

  it('shows no two-approval steps on a single-approval request', async () => {
    server.use(http.get(`${API}/api/approvals/12/`, () => HttpResponse.json(detail({ required_approvals: 1, signoff: { required: 1, waiting_on: 'approver', signed: [], cosigner_named: null } }))))
    renderPanel({ detailId: 12 })
    await screen.findByRole('heading', { name: 'Who signs off' })
    expect(screen.queryByLabelText('Two approvals needed')).not.toBeInTheDocument()
  })
})
