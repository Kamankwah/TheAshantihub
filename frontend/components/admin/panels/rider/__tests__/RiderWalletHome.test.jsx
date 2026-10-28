import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStepUpHandler } from '../../../../../apiClient.js'
import { server } from '../../../../../mocks/server.js'
import RiderWalletHome from '../RiderWalletHome.jsx'

const API = 'http://localhost:8000'
const B = `${API}/api/delivery/rider/wallet`
const summary = (over = {}) => ({
  kind: 'rider', balance: '120.50', reserve: '18.00', reserve_note: 'Held against refunds for now.', commission_bp: 1050,
  company_name: 'Kofi Riders Ltd', awaiting_release: 0, balance_note: null, withdrawals_per_day: 3, withdrawals_today: 1,
  withdrawals_reset_at: '2026-10-21T00:00:00Z', ...over,
})
const dest = (over = {}) => ({
  id: 7, rail: 'momo', institution: 'MTN', account_name: 'Kojo Rider', account_number_masked: '024****567',
  usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false, ...over,
})
const wd = (over = {}) => ({
  id: 1, reference: 'WD-1', amount: '50.00', charge: '1.00', you_receive: '49.00', status: 'processing',
  status_label: 'Processing', destination: dest(), created_at: '2026-10-20T10:05:00Z', settled_at: null, failure_reason: '', ...over,
})
function backend({ dests = [dest()], wds = [] } = {}) {
  server.use(
    http.get(`${B}/destinations/`, () => HttpResponse.json({ results: dests, cooling_hours: 24 })),
    http.get(`${B}/withdrawals/`, () => HttpResponse.json({ count: wds.length, next: null, previous: null, results: wds })),
  )
}
function mount(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const p = { summary: summary(), onNavigate: vi.fn(), onChanged: vi.fn(), ...props }
  render(<QueryClientProvider client={queryClient}><RiderWalletHome {...p} /></QueryClientProvider>)
  return p
}
let unregister = null
afterEach(() => { if (unregister) unregister(); unregister = null })
const type = (v) => fireEvent.change(screen.getByLabelText(/amount to withdraw/i), { target: { value: v } })
const withdrawBtn = () => screen.getByRole('button', { name: /^withdraw$/i })

describe('RiderWalletHome', () => {
  it("shows balance, commission held with the server's note, the rate and the company", async () => {
    backend()
    mount()
    expect(screen.getByText('Your balance')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 120.50')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 18.00')).toBeInTheDocument()
    expect(screen.getByText('Held against refunds for now.')).toBeInTheDocument()
    expect(screen.getByText(/commission on orders paid now: 10\.5% of each delivery fee\./)).toBeInTheDocument()
    expect(screen.getByText('Rider company: Kofi Riders Ltd')).toBeInTheDocument()
    expect(screen.getByText(/Money goes only to a payout number in your own name, once your Ghana Card is approved\./)).toBeInTheDocument()
    await screen.findAllByText(/024\*+567/)
  })

  it("explains a balance below zero with the server's note", () => {
    backend()
    mount({ summary: summary({ balance: '-13.50', balance_note: 'You are GH₵ 13.50 below zero after a refund.' }) })
    expect(screen.getByText('−GH₵ 13.50')).toBeInTheDocument()
    expect(screen.getByText('You are GH₵ 13.50 below zero after a refund.')).toBeInTheDocument()
  })

  it("says how many delivered orders wait for Support's call", () => {
    backend()
    mount({ summary: summary({ awaiting_release: 2 }) })
    expect(screen.getByText(/2 delivered orders wait for Support's call to the customer\. You are paid for each once Support confirms it\./)).toBeInTheDocument()
  })

  it('hides that line at 0', () => {
    backend()
    mount()
    expect(screen.queryByText(/wait.* for Support's call/)).toBeNull()
  })

  it("shows today's withdrawal count and when it starts again, from the server", () => {
    backend()
    mount()
    const line = screen.getByText(/Withdrawals today:/)
    expect(line.textContent).toBe('Withdrawals today: 1 of 3. The count starts again at 00:00 on Wed 21 Oct (Accra time).')
  })

  it('shows no count line without the server\'s count fields', () => {
    backend()
    mount({ summary: summary({ withdrawals_per_day: undefined, withdrawals_today: undefined, withdrawals_reset_at: undefined }) })
    expect(screen.queryByText(/Withdrawals today/)).toBeNull()
  })

  it("replaces the withdraw form with the reset time once today's withdrawals are used", async () => {
    backend()
    mount({ summary: summary({ withdrawals_today: 3 }) })
    expect(screen.getByText(/You have made today's 3 withdrawals\. You can withdraw again from 00:00 on Wed 21 Oct \(Accra time\)\./)).toBeInTheDocument()
    await screen.findAllByText(/024\*+567/)
    expect(screen.queryByLabelText(/amount to withdraw/i)).toBeNull()
  })

  it('withdraws through the rider base path with one request id', async () => {
    backend()
    const bodies = []
    server.use(http.post(`${B}/withdrawals/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(wd(), { status: 201 }) }))
    mount()
    await screen.findByLabelText(/amount to withdraw/i)
    type('50')
    fireEvent.click(withdrawBtn())
    await screen.findByText('You receive')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({ destination: 7, amount: '50', request_id: expect.any(String) })
    expect(bodies[0].request_id.length).toBeGreaterThan(8)
  })

  it('goes through the step-up retry for a rider', async () => {
    backend()
    const tokens = []
    server.use(http.post(`${B}/withdrawals/`, ({ request }) => {
      const tok = request.headers.get('X-Step-Up-Token')
      tokens.push(tok)
      return tok ? HttpResponse.json(wd(), { status: 201 })
        : HttpResponse.json({ detail: 'Enter a code.', code: 'step_up_required', action: 'withdrawal' }, { status: 403 })
    }))
    const handler = vi.fn().mockResolvedValue({ token: 'tok-1', expiresIn: 300 })
    unregister = setStepUpHandler(handler)
    mount()
    await screen.findByLabelText(/amount to withdraw/i)
    type('50')
    fireEvent.click(withdrawBtn())
    await screen.findByText('You receive')
    expect(handler).toHaveBeenCalledWith('withdrawal')
    expect(tokens).toEqual([null, 'tok-1'])
  })

  it("a daily_count_limit refusal shows the server's text", async () => {
    backend()
    const detail = 'You can make 3 withdrawals a day and have made 3. Try again after 00:00 (Accra) tomorrow.'
    server.use(http.post(`${B}/withdrawals/`, () => HttpResponse.json({ detail, code: 'daily_count_limit', limit: 3 }, { status: 409 })))
    mount()
    await screen.findByLabelText(/amount to withdraw/i)
    type('50')
    fireEvent.click(withdrawBtn())
    expect(await screen.findByText(detail)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open documents/i })).toBeNull()
  })

  it('an id_required refusal offers the documents screen', async () => {
    backend()
    server.use(http.post(`${B}/withdrawals/`, () => HttpResponse.json(
      { detail: 'Your Ghana Card must be approved, and in date, before money can be paid out to you. Ask your delivery manager.', code: 'id_required' }, { status: 409 })))
    const p = mount()
    await screen.findByLabelText(/amount to withdraw/i)
    type('50')
    fireEvent.click(withdrawBtn())
    expect(await screen.findByText(/Your Ghana Card must be approved/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Documents & vehicle' }))
    expect(p.onNavigate).toHaveBeenCalledWith('dr-documents')
  })

  it('adding a payout number posts to the rider path and never offers registered payout details', async () => {
    backend()
    const bodies = []
    server.use(http.post(`${B}/destinations/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(dest({ id: 8 }), { status: 201 }) }))
    const p = mount()
    await screen.findByLabelText(/amount to withdraw/i)
    expect(screen.queryByText(/registered payout details/i)).toBeNull()
    fireEvent.change(screen.getByLabelText('Mobile money number'), { target: { value: '0241234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add destination' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ rail: 'momo', institution: 'MTN', account_number: '0241234567' })
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled())
  })

  it('refreshes the summary after a withdrawal or a cancel', async () => {
    backend({ wds: [wd({ id: 5 })] })
    server.use(
      http.post(`${B}/withdrawals/`, () => HttpResponse.json(wd({ id: 6 }), { status: 201 })),
      http.post(`${B}/withdrawals/5/cancel/`, () => HttpResponse.json(wd({ id: 5, status: 'cancelled', status_label: 'Cancelled' }))),
    )
    const p = mount()
    await screen.findByLabelText(/amount to withdraw/i)
    type('50')
    fireEvent.click(withdrawBtn())
    await waitFor(() => expect(p.onChanged).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await screen.findByText('Cancelled')
    expect(p.onChanged).toHaveBeenCalledTimes(2)
  })

  it('every amount is tabular and never gold', async () => {
    backend({ wds: [wd()] })
    mount()
    const amounts = [screen.getByText('GH₵ 120.50'), screen.getByText('GH₵ 18.00')]
    for (const el of amounts) {
      expect(el.style.fontVariantNumeric).toBe('tabular-nums')
      expect(el.style.color).not.toBe('')
    }
    await screen.findByText('Processing')
    const gold = screen.getByText('GH₵ 120.50').style.color
    const btn = screen.getByRole('button', { name: /^withdraw$/i })
    expect(btn.style.background || btn.style.backgroundColor).not.toBe(gold)
    for (const el of document.querySelectorAll('[style*="tabular-nums"]')) expect(el.style.color).not.toBe(btn.style.backgroundColor)
  })
})
