import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import WithdrawalsPanel from '../WithdrawalsPanel.jsx'

const LIST = 'http://localhost:8000/api/wallet/staff/withdrawals/'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const envelope = (results, next = null) => HttpResponse.json({ count: results.length, next, previous: null, results })
const manage = { hasPermission: () => true }
const viewOnly = { hasPermission: (c) => c === 'wallets.view' }
const row = (over = {}) => ({
  id: 5, reference: 'WD-0005', amount: '40.00', charge: '1.00', you_receive: '39.00', status: 'sent', status_label: 'Sent to provider',
  destination: { account_number_masked: '024****789', network: 'MTN' }, created_at: '2026-10-20T10:00:00Z', settled_at: null, failure_reason: '',
  holder_type: 'customer', holder_id: 1, holder_name: 'Ama Mensah', provider: 'hubtel', provider_reference: '', submitted_at: '2026-10-20T10:01:00Z', stuck: false, ...over,
})
const stuckRow = () => row({ stuck: true })
const EVIDENCE = 'Hubtel statement shows no payout for WD-0005'

async function openSheet() {
  fireEvent.click(await screen.findByRole('button', { name: /Resolve/ }))
  return screen.findByRole('dialog')
}

describe('Staff withdrawals queue', () => {
  it('test_open_is_the_default_filter', async () => {
    const seen = []
    server.use(http.get(LIST, ({ request }) => { seen.push(new URL(request.url).searchParams.get('status')); return envelope([]) }))
    wrap(<WithdrawalsPanel auth={manage} />)
    await waitFor(() => expect(seen).toEqual(['open']))
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    await waitFor(() => expect(seen).toContain('failed'))
  })

  it('test_staff_withdrawal_rows_show_masked_destination_and_holder_name', async () => {
    server.use(http.get(LIST, () => envelope([row()])))
    wrap(<WithdrawalsPanel auth={manage} />)
    const tr = (await screen.findByText('WD-0005')).closest('tr')
    expect(tr).toHaveTextContent('Ama Mensah')
    expect(tr).toHaveTextContent('Customer')
    expect(tr).toHaveTextContent('024****789')
    expect(tr).toHaveTextContent('GH₵ 40.00')
    expect(tr).toHaveTextContent('GH₵ 1.00')
    expect(tr).toHaveTextContent('Sent to provider')
  })

  it('test_stuck_rows_get_a_text_chip', async () => {
    server.use(http.get(LIST, () => envelope([stuckRow(), row({ id: 6, reference: 'WD-0006' })])))
    wrap(<WithdrawalsPanel auth={manage} />)
    const stuck = (await screen.findByText('WD-0005')).closest('tr')
    expect(within(stuck).getByText('Stuck')).toBeInTheDocument()
    expect(within(screen.getByText('WD-0006').closest('tr')).queryByText('Stuck')).toBeNull()
    expect(within(screen.getByText('WD-0006').closest('tr')).queryByRole('button', { name: /Resolve/ })).toBeNull()
  })

  it('test_never_sent_withdrawal_says_not_sent', async () => {
    server.use(http.get(LIST, () => envelope([row({ id: 9, reference: 'WD-0009', status: 'held', status_label: 'Held', submitted_at: null, stuck: true }), row()])))
    wrap(<WithdrawalsPanel auth={manage} />)
    const held = (await screen.findByText('WD-0009')).closest('tr')
    expect(held).toHaveTextContent('Not sent')
    expect(held).not.toHaveTextContent('2026')
    expect(screen.getByText('WD-0005').closest('tr')).not.toHaveTextContent('Not sent')
  })

  it('test_resolve_submits_a_request_not_a_fail', async () => {
    const posts = []
    server.use(
      http.get(LIST, () => envelope([stuckRow()])),
      http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/resolve/', async ({ request, params }) => { posts.push({ id: params.id, body: await request.json() }); return HttpResponse.json({ approval_id: 12, status: 'pending' }, { status: 201 }) }),
      http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/fail/', () => { posts.push('fail'); return HttpResponse.json({}, { status: 201 }) }),
    )
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    expect(sheet).toHaveTextContent("Failed returns GH₵ 40.00 to the holder's balance.")
    expect(sheet).toHaveTextContent('A second approver must confirm; nothing changes until then.')
    fireEvent.change(within(sheet).getByLabelText(/Evidence/), { target: { value: EVIDENCE } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send for approval' }))
    await screen.findByText(/Sent for approval \(request A-12\)\. A second person must approve it in Approvals\./)
    expect(posts).toEqual([{ id: '5', body: { outcome: 'failed', evidence: EVIDENCE } }])
  })

  it('test_paid_outcome_can_be_chosen', async () => {
    const posts = []
    server.use(
      http.get(LIST, () => envelope([stuckRow()])),
      http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/resolve/', async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({ approval_id: 3, status: 'pending' }, { status: 201 }) }),
    )
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Paid' }))
    fireEvent.change(within(sheet).getByLabelText(/Evidence/), { target: { value: EVIDENCE } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send for approval' }))
    await screen.findByText(/Sent for approval/)
    expect(posts[0].outcome).toBe('paid')
  })

  it('test_evidence_under_ten_characters_is_not_sent', async () => {
    let posted = 0
    server.use(http.get(LIST, () => envelope([stuckRow()])), http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/resolve/', () => { posted += 1; return HttpResponse.json({}, { status: 201 }) }))
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    fireEvent.change(within(sheet).getByLabelText(/Evidence/), { target: { value: 'too short' } })
    expect(sheet).toHaveTextContent('9 / 10')
    const send = within(sheet).getByRole('button', { name: 'Send for approval' })
    expect(send).toBeDisabled()
    fireEvent.click(send)
    await new Promise((r) => setTimeout(r, 30))
    expect(posted).toBe(0)
  })

  it('test_resolve_needs_wallets_manage', async () => {
    server.use(http.get(LIST, () => envelope([stuckRow()])))
    wrap(<WithdrawalsPanel auth={viewOnly} />)
    const tr = (await screen.findByText('WD-0005')).closest('tr')
    expect(within(tr).getByText('Stuck')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resolve/ })).toBeNull()
  })

  it.each([
    ['provider_unreachable', 503, 'We could not reach the provider. Nothing changed.'],
    ['provider_processing', 409, 'The provider is still processing it; it can only be settled as paid.'],
    ['provider_answered', 409, 'The provider has answered for this withdrawal, so its answer settled it.'],
    ['provider_changed', 409, 'The provider now says something different. Check again.'],
    ['amount_case_open', 409, 'An amount case is open for this withdrawal.'],
    ['not_stuck', 409, 'This withdrawal is not stuck.'],
    ['own_withdrawal', 403, 'You cannot resolve your own withdrawal. Ask another member of staff.'],
    ['resolution_pending', 409, 'A request to resolve this withdrawal is already waiting for approval.'],
  ])('test_each_refusal_code_shows_its_server_detail (%s)', async (code, status, detail) => {
    server.use(
      http.get(LIST, () => envelope([stuckRow()])),
      http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/resolve/', () => HttpResponse.json({ detail, code }, { status })),
    )
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    fireEvent.change(within(sheet).getByLabelText(/Evidence/), { target: { value: EVIDENCE } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send for approval' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(detail)
    expect(screen.queryByText(/Sent for approval/)).toBeNull()
  })

  it('test_evidence_required_answer_shows_the_evidence_message', async () => {
    server.use(
      http.get(LIST, () => envelope([stuckRow()])),
      http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/resolve/', () => HttpResponse.json({ evidence: 'Give at least 10 characters of evidence.', code: 'evidence_required' }, { status: 400 })),
    )
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    fireEvent.change(within(sheet).getByLabelText(/Evidence/), { target: { value: EVIDENCE } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send for approval' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Give at least 10 characters of evidence.')
  })

  it('test_success_points_to_the_approvals_screen', async () => {
    server.use(
      http.get(LIST, () => envelope([stuckRow()])),
      http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/resolve/', () => HttpResponse.json({ approval_id: 77, status: 'pending' }, { status: 201 })),
    )
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    fireEvent.change(within(sheet).getByLabelText(/Evidence/), { target: { value: EVIDENCE } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send for approval' }))
    const note = await screen.findByText(/request A-77/)
    expect(note).toHaveTextContent('A second person must approve it in Approvals.')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('test_no_direct_fail_or_approve_button_exists', async () => {
    server.use(http.get(LIST, () => envelope([stuckRow()])))
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    for (const scope of [document.body, sheet]) {
      expect(within(scope).queryByRole('button', { name: /^Approve/ })).toBeNull()
      expect(within(scope).queryByRole('button', { name: /^Fail(?!ed$)/ })).toBeNull()
    }
  })

  it('test_ledger_off_state', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    wrap(<WithdrawalsPanel auth={manage} />)
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
  })

  it('test_load_more_follows_next_and_status_resets_paging', async () => {
    const seen = []
    server.use(http.get(LIST, ({ request }) => {
      const u = new URL(request.url); seen.push(`${u.searchParams.get('status')}:${u.searchParams.get('page')}`)
      return u.searchParams.get('page') === '2' ? envelope([row({ id: 2, reference: 'WD-0002' })]) : envelope([row()], `${LIST}?page=2`)
    }))
    wrap(<WithdrawalsPanel auth={manage} />)
    await screen.findByText('WD-0005')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('WD-0002')
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(seen).toContain('all:1'))
    await waitFor(() => expect(screen.queryByText('WD-0002')).toBeNull())
  })

  it('test_submitted_time_is_shown_in_accra_time', async () => {
    server.use(http.get(LIST, () => envelope([row({ submitted_at: '2026-10-20T23:30:00Z' })])))
    wrap(<WithdrawalsPanel auth={manage} />)
    const tr = (await screen.findByText('WD-0005')).closest('tr')
    expect(tr).toHaveTextContent(/20 Oct 2026/)
    expect(tr).toHaveTextContent(/23:30/)
  })

  it.each(['provider_answered', 'amount_case_open'])('test_a_%s_refusal_refreshes_the_stale_stuck_row', async (code) => {
    let lists = 0
    server.use(
      http.get(LIST, () => { lists += 1; return envelope(lists === 1 ? [stuckRow()] : []) }),
      http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/resolve/', () => HttpResponse.json({ detail: 'Already settled.', code }, { status: 409 })),
    )
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    fireEvent.change(within(sheet).getByLabelText(/Evidence/), { target: { value: EVIDENCE } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send for approval' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Already settled.')
    await waitFor(() => expect(lists).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByText('WD-0005')).toBeNull())
  })

  it('test_evidence_is_capped_at_500_and_counted', async () => {
    server.use(http.get(LIST, () => envelope([stuckRow()])))
    wrap(<WithdrawalsPanel auth={manage} />)
    const sheet = await openSheet()
    const box = within(sheet).getByLabelText(/Evidence/)
    expect(box).toHaveAttribute('maxlength', '500')
    fireEvent.change(box, { target: { value: EVIDENCE } })
    expect(sheet).toHaveTextContent(`${EVIDENCE.length}/500`)
  })

  it('asks for holder_type=staff on the rider tab', async () => {
    const seen = []
    server.use(http.get(LIST, ({ request }) => { seen.push(new URL(request.url).searchParams.get('holder_type')); return envelope([]) }))
    wrap(<WithdrawalsPanel auth={manage} holderType="staff" title="Rider withdrawals" />)
    expect(await screen.findByRole('heading', { name: 'Rider withdrawals' })).toBeInTheDocument()
    await waitFor(() => expect(seen).toEqual(['staff']))
  })

  it('sends no holder_type without one', async () => {
    const seen = []
    server.use(http.get(LIST, ({ request }) => { seen.push(new URL(request.url).searchParams.has('holder_type')); return envelope([]) }))
    wrap(<WithdrawalsPanel auth={manage} />)
    await waitFor(() => expect(seen).toEqual([false]))
  })

  it('rows say Rider for a staff holder', async () => {
    server.use(http.get(LIST, () => envelope([row({ holder_type: 'staff', holder_name: 'Kwesi Rider' }), row({ id: 6, reference: 'WD-0006', holder_type: 'business_owner' })])))
    wrap(<WithdrawalsPanel auth={manage} holderType="staff" title="Rider withdrawals" />)
    const tr = (await screen.findByText('WD-0005')).closest('tr')
    expect(tr).toHaveTextContent('Rider')
    expect(tr).not.toHaveTextContent('staff')
    expect(screen.getByText('WD-0006').closest('tr')).toHaveTextContent('Business')
  })

  it('the rider tab keeps the two-person resolve flow', async () => {
    const posts = []
    server.use(
      http.get(LIST, () => envelope([row({ holder_type: 'staff', holder_name: 'Kwesi Rider', stuck: true })])),
      http.post('http://localhost:8000/api/wallet/staff/withdrawals/:id/resolve/', async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({ approval_id: 3, status: 'pending' }, { status: 201 }) }),
    )
    wrap(<WithdrawalsPanel auth={manage} holderType="staff" title="Rider withdrawals" />)
    const sheet = await openSheet()
    expect(screen.queryByRole('button', { name: /^Fail( withdrawal| now)?$/ })).toBeNull()
    fireEvent.change(within(sheet).getByLabelText(/Evidence/), { target: { value: EVIDENCE } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send for approval' }))
    await screen.findByText(/Sent for approval \(request A-3\)/)
    expect(posts).toEqual([{ outcome: 'failed', evidence: EVIDENCE }])
  })
})
