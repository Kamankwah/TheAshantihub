import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CommissionPanel, { bonusNote, statementRange, statusText } from '../CommissionPanel.jsx'

const API = 'http://localhost:8000'
const empty = { amount: '0.00', count: 0, registrations: 0, bonuses: 0 }
const line = (id, over = {}) => ({
  id, business: `Biz ${id}`, business_id: id, kind: 'registration', kind_label: 'Registration', amount: '50.00', status: 'on_hold', status_label: 'On hold',
  earned_at: '2026-10-07T10:00:00Z', hold_until: '2027-01-05T10:00:00Z', reversed_reason: null, reversed_label: null, reversed_at: null, ...over,
})
const statement = (over = {}) => ({
  count: 2, next: null, previous: null,
  results: [
    line(1),
    line(2, { status: 'reversed', status_label: 'Reversed', reversed_reason: 'duplicate', reversed_label: 'duplicate business', reversed_at: '2026-09-22T10:00:00Z' }),
  ],
  statement: { from: '2026-07-01', to: '2026-10-07' },
  totals: {
    on_hold: { amount: '450.00', count: 9, registrations: 9, bonuses: 0 }, payable: { amount: '300.00', count: 3, registrations: 2, bonuses: 1 },
    in_batch: empty, paid: { amount: '250.00', count: 5, registrations: 5, bonuses: 0 },
    reversed: { amount: '50.00', count: 1, registrations: 1, bonuses: 0, reasons: { 'duplicate business': 1 } },
  },
  bonus: [
    { business: 'Adwoa Fabrics', business_id: 7, paid_months: 2, state: { kind: 'overdue', day: 4 } },
    { business: 'Akosua Ntoma Kente', business_id: 8, paid_months: 2, state: { kind: 'next_renewal', date: '2026-11-02T10:00:00Z' } },
    { business: "Nana's Chop Bar", business_id: 9, paid_months: 0, state: { kind: 'trial_until', date: '2026-11-06T10:00:00Z' } },
  ],
  bonus_more: 0,
  policy: { registration: { amount: '50.00', effective_from: '2026-01-01' }, three_paid_months_bonus: { amount: '100.00', effective_from: '2026-01-01' } },
  ...over,
})
function renderPanel(build = () => statement(), seen = []) {
  server.use(http.get(`${API}/api/commission/me/`, ({ request }) => {
    seen.push(new URL(request.url).searchParams.get('page_size'))
    return HttpResponse.json(build())
  }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CommissionPanel /></QueryClientProvider>)
}

describe('CommissionPanel', () => {
  it('shows the header, the statement range and four tiles from the server', async () => {
    renderPanel()
    expect(await screen.findByText('Statement · July to October 2026')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Commission' })).toBeInTheDocument()
    expect(screen.getByText('GH₵ 450.00').parentElement).toHaveTextContent('9 registrations')
    expect(screen.getByText('GH₵ 300.00').parentElement).toHaveTextContent('Approved to pay')
    expect(screen.getByText('GH₵ 250.00').parentElement).toHaveTextContent('5 lines')
    expect(screen.getByText('Reversed', { selector: 'span' }).parentElement).toHaveTextContent('GH₵ 50.00')
    expect(screen.getByText('1 duplicate business')).toBeInTheDocument()
  })

  it('lists lines with their status text and strikes a reversed amount through', async () => {
    renderPanel()
    expect(await screen.findByText('On hold until 5 Jan 2027')).toBeInTheDocument()
    expect(screen.getByText('Registration · KYC approved 7 Oct')).toBeInTheDocument()
    expect(screen.getByText('Reversed · duplicate business')).toBeInTheDocument()
    expect(screen.getByText('Registration · reversed 22 Sep')).toBeInTheDocument()
    const reversed = screen.getByText('Biz 2').closest('div').parentElement
    expect(within(reversed).getByText('GH₵ 50.00')).toHaveStyle({ textDecoration: 'line-through' })
  })

  it('offers All N only when there are more than four lines, and asks for them all', async () => {
    const seen = []
    renderPanel(() => statement({ count: 20 }), seen)
    fireEvent.click(await screen.findByRole('button', { name: 'All 20' }))
    expect(await screen.findByRole('button', { name: 'Show fewer' })).toBeInTheDocument()
    expect(seen).toContain('100')
  })

  it('keeps the button at All N and says how many are shown once past 100', async () => {
    renderPanel(() => statement({ count: 150 }))
    fireEvent.click(await screen.findByRole('button', { name: 'All 150' }))
    expect(await screen.findByText('Showing the latest 100 of 150')).toBeInTheDocument()
  })

  it('draws the bonus bar and a note per business, and warns about an overdue renewal', async () => {
    renderPanel()
    expect(await screen.findByText('3-paid-months bonus · GH₵ 100.00')).toBeInTheDocument()
    expect(screen.getByText('Goes to whoever manages the business when its 3rd month is paid.')).toBeInTheDocument()
    expect(screen.getByText('Renewal overdue · day 4 — paying it would complete the bonus')).toBeInTheDocument()
    expect(screen.getByText('Next renewal 2 November')).toBeInTheDocument()
    expect(screen.getByText('On trial until 6 November · trial months don’t count')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '0 of 3 months paid' })).toBeInTheDocument()
    expect(screen.getAllByText('2 of 3 months')).toHaveLength(2)
  })

  it('says nothing has been earned when no amount is approved, and that payouts are not built', async () => {
    renderPanel(() => statement({
      count: 0, results: [], bonus: [], policy: { registration: null, three_paid_months_bonus: null },
      totals: Object.fromEntries(['on_hold', 'payable', 'in_batch', 'paid', 'reversed'].map((k) => [k, empty])),
    }))
    expect(await screen.findByText('No commission amounts are approved yet, so nothing has been earned.')).toBeInTheDocument()
    expect(screen.getByText(/No commission lines yet/)).toBeInTheDocument()
    expect(screen.getByText('Nothing on hold')).toBeInTheDocument()
    expect(screen.getByText('No bonus amount is approved yet, so none can be earned.')).toBeInTheDocument()
    expect(screen.getByText("Payout batches aren't set up yet, so nothing is paid out from this screen.")).toBeInTheDocument()
  })

  it('carries the canvas explanation word for word', async () => {
    renderPanel()
    const box = await screen.findByLabelText('How commission works')
    expect(box).toHaveTextContent('Scouts never collect cash.')
    expect(box).toHaveTextContent('Owners pay their subscription in the app; you remind them and log the call. Payments are simulated until Hubtel is connected.')
    expect(box).toHaveTextContent('Amounts come from the commission policy Super Admin approved. Each line is held 90 days and reversed if the business proves fake or a duplicate.')
  })

  it('shows an error with a retry', async () => {
    server.use(http.get(`${API}/api/commission/me/`, () => HttpResponse.json({}, { status: 500 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><CommissionPanel /></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your commission.")
  })
})

describe('commission copy helpers', () => {
  it('words the statement range, status and overdue note', () => {
    expect(statementRange({ from: '2026-10-01', to: '2026-10-07' })).toBe('October 2026')
    expect(statementRange({ from: '2025-11-01', to: '2026-02-07' })).toBe('November 2025 to February 2026')
    expect(statusText({ status: 'payable', status_label: 'Approved to pay' })).toBe('Approved to pay')
    expect(bonusNote({ paid_months: 1, state: { kind: 'overdue', day: 2 } })[0]).toBe('Renewal overdue · day 2')
    expect(bonusNote({ paid_months: 0, state: { kind: 'none' } })[0]).toBe('No subscription yet')
  })
})
