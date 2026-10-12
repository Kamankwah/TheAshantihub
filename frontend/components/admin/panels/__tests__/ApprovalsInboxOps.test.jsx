import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ApprovalsPanel from '../ApprovalsPanel.jsx'

const API = 'http://localhost:8000'
const HOUR = 3600 * 1000
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const row = (overrides = {}) => ({
  id: 7, kind: 'business.kyc', kind_label: 'New business (KYC)', title: "Nana's Chop Bar", status: 'pending', stage: 'manager',
  maker: { id: 3, full_name: 'Kwame Asante', role: 'scout' }, assigned_to: { id: 2, full_name: 'Ama Boateng', role: 'operations' },
  target: { type: 'accounts.businessowner', id: '41', label: "Nana's Chop Bar" }, maker_note: 'Food · Asafo · Ghana Card and pin',
  decided_by: null, decided_at: null, decision_note: '', due_at: iso(19 * HOUR), escalation_level: 0, created_at: iso(-5 * HOUR),
  can_decide: true, can_cancel: false, maker_team: { mine: true, manager: 'Ama Boateng' }, escalated: false,
  next_move: { stage: 'pool', label: 'any Operations', at: iso(19 * HOUR) },
  ...overrides,
})
const page = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })
const COUNTS = {
  mine: 2, made: 1, team: 2, decided: 1, escalated_to_me: 1, can_view_all: false,
  makers: [{ id: 3, full_name: 'Kwame Asante' }, { id: 4, full_name: 'Efua Mensah' }],
  kinds: [
    { key: 'business.kyc', label: 'New business (KYC)', response_hours: 24 },
    { key: 'targets.cut', label: 'Target cut', response_hours: 48 },
  ],
}

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApprovalsPanel detailId={null} onOpenDetail={() => {}} {...props} />
    </QueryClientProvider>,
  )
}

describe('Approvals inbox (Operations)', () => {
  it('lists waiting requests as a table: kind, who made it, how long, and where it moves next', async () => {
    server.use(
      http.get(`${API}/api/approvals/counts/`, () => HttpResponse.json(COUNTS)),
      http.get(`${API}/api/approvals/`, ({ request }) => {
        const box = new URL(request.url).searchParams.get('box')
        return page(box === 'mine' ? [
          row({ id: 8, title: 'Asokwa Bakery', kind: 'business.update', kind_label: 'Info change', escalated: true, escalation_level: 1, maker_note: 'Map pin moved 140 m', created_at: iso(-26 * HOUR), maker_team: { mine: false, manager: 'Kojo Badu' }, next_move: { stage: 'super_admin', label: 'a Super Admin', at: iso(22 * HOUR) } }),
          row(),
        ] : [])
      }),
    )
    renderPanel()
    const table = await screen.findByRole('table', { name: 'Requests' })
    const [first, second] = within(table).getAllByRole('row').slice(1)
    expect(within(first).getByText('Escalated to you')).toBeInTheDocument()
    expect(within(first).getByText('Scout · Kojo Badu\'s team')).toBeInTheDocument()
    expect(within(first).getByText('26 h')).toBeInTheDocument()
    expect(within(first).getByText(/Moves to a Super Admin in 2[12] h/)).toBeInTheDocument()
    expect(within(second).getByText('Scout · your team')).toBeInTheDocument()
    expect(within(second).getByText('5 h')).toBeInTheDocument()
    expect(within(second).getByText(/Moves to any Operations in 1[89] h/)).toBeInTheDocument()
    expect(screen.getByText(/2 waiting for your decision · 1 escalated to you · next to move on in 1[89] h/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decided · 1' })).toBeInTheDocument()
  })

  it('sends the filters to the server and says so when none match', async () => {
    const urls = []
    server.use(
      http.get(`${API}/api/approvals/counts/`, () => HttpResponse.json(COUNTS)),
      http.get(`${API}/api/approvals/`, ({ request }) => { urls.push(new URL(request.url).searchParams); return page([]) }),
    )
    renderPanel()
    const kind = await screen.findByLabelText('Kind')
    await screen.findByRole('option', { name: 'Target cut' })
    fireEvent.change(kind, { target: { value: 'targets.cut' } })
    fireEvent.change(screen.getByLabelText('Made by'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Waiting'), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'newest' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Escalated to me only/ }))
    await waitFor(() => {
      const last = urls[urls.length - 1]
      expect(Object.fromEntries(last)).toMatchObject({ box: 'mine', kind: 'targets.cut', maker: '4', min_wait_hours: '18', ordering: 'newest', escalated: '1' })
    })
    expect(await screen.findByText('No request matches these filters.')).toBeInTheDocument()
  })

  it('shows what I made, with Cancel and no way to approve my own', async () => {
    let cancelled = false
    server.use(
      http.get(`${API}/api/approvals/counts/`, () => HttpResponse.json(COUNTS)),
      http.get(`${API}/api/approvals/`, ({ request }) => {
        const box = new URL(request.url).searchParams.get('box')
        return page(box === 'made' ? [row({ id: 12, kind_label: 'Target cut', title: 'Yaw Owusu', assigned_to: { id: 1, full_name: 'Simon Peter' }, can_cancel: true, can_decide: false })] : [])
      }),
      http.post(`${API}/api/approvals/12/cancel/`, () => { cancelled = true; return HttpResponse.json({}) }),
    )
    renderPanel()
    const section = (await screen.findByRole('heading', { name: 'Made by me' })).closest('section')
    expect(within(section).getByText('Target cut · Yaw Owusu')).toBeInTheDocument()
    expect(within(section).getByText('Sent to Simon Peter for approval')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(within(section).getByText("You can't approve your own requests.")).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: /Cancel the request/ }))
    await waitFor(() => expect(cancelled).toBe(true))
  })

  it('explains how a request moves using the kinds\' real response times, and what I decided today', async () => {
    server.use(
      http.get(`${API}/api/approvals/counts/`, () => HttpResponse.json(COUNTS)),
      http.get(`${API}/api/approvals/stats/`, () => HttpResponse.json({ decided_today: 2, approved_today: 1, returned_today: 1, median_minutes: 130 })),
      http.get(`${API}/api/approvals/`, ({ request }) => {
        const box = new URL(request.url).searchParams.get('box')
        return page(box === 'decided' ? [
          row({ id: 21, status: 'approved', kind_label: 'Photos', title: 'Suame Auto Parts', decided_at: new Date().toISOString(), decision_note: '' }),
          row({ id: 22, status: 'rejected', title: 'Bonwire Kente Looms', decided_at: new Date().toISOString(), decision_note: 'Retake the card photo', maker: { id: 5, full_name: 'Yaw Owusu', role: 'scout' } }),
          row({ id: 23, status: 'approved', title: 'Last week', decided_at: iso(-72 * HOUR) }),
        ] : [])
      }),
    )
    renderPanel()
    const route = (await screen.findByRole('heading', { name: 'How a request moves' })).closest('section')
    expect(await within(route).findByText(/24 h for New business \(KYC\); 48 h for Target cut/)).toBeInTheDocument()
    const decided = (await screen.findByRole('heading', { name: 'You decided today' })).closest('section')
    expect(await within(decided).findByText('Median 2 h')).toBeInTheDocument()
    expect(within(decided).getByText('Photos · Suame Auto Parts')).toBeInTheDocument()
    expect(within(decided).getByText('Note to Yaw Owusu: “Retake the card photo”')).toBeInTheDocument()
    expect(within(decided).queryByText(/Last week/)).not.toBeInTheDocument()
  })
})

describe('Approval detail (Operations)', () => {
  const detail = (overrides = {}) => ({
    ...row(), payload: {}, before: {}, stale: false,
    diff: [{ field: 'Business', before: null, after: "Nana's Chop Bar" }],
    consequences: ['The business is verified and can go live.', "It counts toward Kwame's registrations today."],
    timeline: [
      { at: iso(-5 * HOUR), what: 'Sent by Kwame Asante', done: true, kind: 'sent' },
      { at: iso(13 * HOUR), what: 'Reminder to the person deciding', done: false, kind: 'reminder' },
      { at: iso(19 * HOUR), what: 'Moves to any Operations', done: false, kind: 'move' },
    ],
    ...overrides,
  })

  it('has the decision rail: Approve KYC, what it does, the note, the timeline and the stale rule', async () => {
    server.use(
      http.get(`${API}/api/approvals/7/`, () => HttpResponse.json(detail())),
      http.get(`${API}/api/portfolio/businesses/41/review/`, () => HttpResponse.json({
        owner: {}, business: {}, photos: {}, location: { address_verified_at: null }, checks: {}, flags: [], consent: null, created_at: iso(-HOUR),
      })),
    )
    renderPanel({ detailId: '7' })
    expect(await screen.findByText(/Request A-7 · New business \(KYC\) · made by Kwame Asante, Scout/)).toBeInTheDocument()
    expect(screen.getByText(/Waiting for you · 5 h/)).toBeInTheDocument()
    expect(screen.getByText(/Made by Kwame Asante · you decide as Kwame's lead\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve KYC' })).toBeEnabled()
    const list = screen.getByRole('list', { name: 'What approving does' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['The business is verified and can go live.', "It counts toward Kwame's registrations today."])
    expect(screen.getByRole('button', { name: 'Return with note' })).toBeDisabled()
    expect(screen.getByText('Write a note to return this request.')).toBeInTheDocument()
    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('section')
    expect(within(timeline).getByText('Sent by Kwame Asante')).toBeInTheDocument()
    expect(within(timeline).getByText('Moves to any Operations')).toBeInTheDocument()
    expect(screen.getByText(/Approve is refused with “this changed since it was requested”/)).toBeInTheDocument()
  })

  it('shows no consequences list when the server names none', async () => {
    server.use(http.get(`${API}/api/approvals/7/`, () => HttpResponse.json(detail({ kind: 'business.update', consequences: [] }))))
    renderPanel({ detailId: '7' })
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'What approving does' })).not.toBeInTheDocument()
  })

  it('goes back to the inbox from the header', async () => {
    const onOpenDetail = vi.fn()
    server.use(http.get(`${API}/api/approvals/7/`, () => HttpResponse.json(detail({ kind: 'business.update' }))))
    renderPanel({ detailId: '7', onOpenDetail })
    fireEvent.click(await screen.findByRole('button', { name: '← Approvals' }))
    expect(onOpenDetail).toHaveBeenCalledWith(null)
  })
})
