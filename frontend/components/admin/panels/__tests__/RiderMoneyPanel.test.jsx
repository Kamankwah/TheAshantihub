import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import RiderMoneyPanel from '../RiderMoneyPanel.jsx'

const API = 'http://localhost:8000'
const WALLETS = `${API}/api/wallet/staff/wallets/`
const COMMISSION = `${API}/api/delivery/rider-commission/`
const auth = { user: { token: 't', account_type: 'staff', id: 1, role: 'accountant' }, hasPermission: () => true }
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui, qc = client()) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
const envelope = (results, next = null) => HttpResponse.json({ count: results.length, next, previous: null, results })
const rider = (o = {}) => ({ holder_id: 7, rider_id: 3, name: 'Kwesi Rider', company_name: 'Swift Co', employment: 'third_party', balance: '12.00', reserve: '3.00', ...o })

const summary = {
  kind: 'rider', balance: '12.00', balance_note: 'Includes 2.00 still to be released.', reserve: '3.00', reserve_note: 'Held against returns.',
  commission_bp: 1050, company_name: 'Swift Co', awaiting_release: 0,
}
const detail = (o = {}) => ({
  rider: { id: 3, staff_id: 9, name: 'Kwesi Rider', employment: 'third_party', company_name: 'Swift Co', third_party_since: '2026-09-01T08:00:00Z' },
  ...summary,
  earnings: [
    { id: 1, order: 501, kind: 'delivery', delivered_at: '2026-10-18T10:00:00Z', gross: '10.00', commission_bp: 1000, commission: '1.00', you_got: '9.00', status: 'paid', status_label: 'Paid to wallet' },
  ],
  days: [{ day: '2026-10-18', deliveries: 2, gross: '20.00', commission: '2.00', net: '18.00', given_back: '0.00' }],
  withdrawals: [
    { id: 4, reference: 'WD-0004', amount: '50.00', charge: '1.00', you_receive: '49.00', status: 'paid', status_label: 'Paid', destination: { account_number_masked: '******4321' } },
  ],
  ...o,
})
const riderWallet = (body, status = 200) => http.get(`${API}/api/delivery/riders/3/wallet/`, () => HttpResponse.json(body, { status }))
const openRider = async (body) => {
  server.use(http.get(WALLETS, () => envelope([rider()])), riderWallet(body))
  wrap(<RiderMoneyPanel auth={auth} />)
  fireEvent.click(await screen.findByRole('button', { name: /Open/ }))
}

describe('Rider money: wallets', () => {
  it('lists riders with company, works for, balance and commission held', async () => {
    server.use(http.get(WALLETS, ({ request }) => {
      expect(new URL(request.url).searchParams.get('kind')).toBe('rider')
      return envelope([rider(), rider({ holder_id: 8, rider_id: 4, name: 'Ama Back', employment: 'ashantihub', company_name: '' })])
    }))
    wrap(<RiderMoneyPanel auth={auth} />)
    const row = (await screen.findByText('Kwesi Rider')).closest('tr')
    expect(row).toHaveTextContent('Swift Co')
    expect(row).toHaveTextContent('Third-party')
    expect(row).toHaveTextContent('GH₵ 12.00')
    expect(row).toHaveTextContent('GH₵ 3.00')
    expect(screen.getByText('Ama Back').closest('tr')).toHaveTextContent('AshantiHub (switched back)')
    expect(screen.getByRole('heading', { name: 'Rider money' })).toBeInTheDocument()
  })

  it('flags a balance below zero in words', async () => {
    server.use(http.get(WALLETS, () => envelope([rider({ balance: '-13.50' }), rider({ holder_id: 8, name: 'Fine Rider', balance: '0.00' })])))
    wrap(<RiderMoneyPanel auth={auth} />)
    const row = (await screen.findByText('Kwesi Rider')).closest('tr')
    expect(row).toHaveTextContent('−GH₵ 13.50')
    expect(within(row).getByText('Below zero')).toBeInTheDocument()
    expect(within(screen.getByText('Fine Rider').closest('tr')).queryByText('Below zero')).toBeNull()
  })

  it('opens one rider\'s wallet with earnings, days and withdrawals', async () => {
    await openRider(detail())
    expect(await screen.findByRole('heading', { name: 'Kwesi Rider' })).toBeInTheDocument()
    expect(screen.getByText('Order #501').closest('tr')).toHaveTextContent('GH₵ 9.00')
    expect(screen.getByText('Paid to wallet')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Days' })).toHaveTextContent('GH₵ 18.00')
    const wd = screen.getByText('WD-0004').closest('tr')
    expect(within(wd).getAllByRole('cell')[2]).toHaveTextContent('GH₵ 1.00')
    expect(within(wd).getAllByRole('cell')[3]).toHaveTextContent('GH₵ 49.00')
    expect(screen.getByText('Includes 2.00 still to be released.')).toBeInTheDocument()
    expect(screen.getByText('Held against returns.')).toBeInTheDocument()
    expect(screen.getByText(/10\.5%/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByText('Kwesi Rider')).toBeInTheDocument()
  })

  it('shows the withdrawal count line only when the server sends the counts', async () => {
    await openRider(detail({ withdrawals_per_day: 3, withdrawals_today: 2, withdrawals_reset_at: '2026-10-20T00:00:00Z' }))
    expect(await screen.findByText(/Withdrawals today: 2 of 3\. The count starts again at 00:00 on/)).toBeInTheDocument()
  })

  it('withdrawal rows show the amount and only a masked destination', async () => {
    await openRider(detail())
    const row = (await screen.findByText('WD-0004')).closest('tr')
    expect(row).toHaveTextContent('GH₵ 50.00')
    expect(row).toHaveTextContent('******4321')
    expect(row).not.toHaveTextContent(/\d{7,}/)
  })

  it('a re-delivery earning reads as a re-delivery of the order', async () => {
    await openRider(detail({ earnings: [{ id: 2, order: 777, kind: 'redelivery', delivered_at: '2026-10-18T10:00:00Z', gross: '15.00', commission: '1.50', you_got: '13.50', status: 'paid', status_label: 'Paid to wallet' }] }))
    expect(await screen.findByText('Re-delivery of order #777')).toBeInTheDocument()
  })

  it('a switched-back rider below zero says nothing collects it', async () => {
    await openRider(detail({ balance: '-4.00', rider: { id: 3, staff_id: 9, name: 'Kwesi Rider', employment: 'ashantihub', company_name: '', third_party_since: null } }))
    expect(await screen.findByText("This rider is now AshantiHub's own: nothing in the app collects a balance below zero.")).toBeInTheDocument()
  })

  it('no such sentence for a third-party rider below zero', async () => {
    await openRider(detail({ balance: '-4.00' }))
    await screen.findByRole('heading', { name: 'Kwesi Rider' })
    expect(screen.queryByText(/nothing in the app collects/)).toBeNull()
  })

  it('wallet_disabled shows the server text', async () => {
    server.use(http.get(WALLETS, () => envelope([rider()])), riderWallet({ detail: 'This rider has never had wallet money.', code: 'wallet_disabled' }, 409))
    wrap(<RiderMoneyPanel auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: /Open/ }))
    expect(await screen.findByText('This rider has never had wallet money.')).toBeInTheDocument()
  })

  it('a rider whose balance moves between pages shows once and none goes missing', async () => {
    const A = rider({ holder_id: 1, name: 'Rider A', balance: '30.00' })
    const B = rider({ holder_id: 2, name: 'Rider B', balance: '20.00' })
    const C = rider({ holder_id: 3, name: 'Rider C', balance: '10.00' })
    const D = rider({ holder_id: 4, name: 'Rider D', balance: '5.00' })
    let moved = false
    server.use(http.get(WALLETS, ({ request }) => {
      const p = new URL(request.url).searchParams.get('page')
      if (!moved) return p === '2' ? envelope([C, D]) : envelope([A, B], `${WALLETS}?kind=rider&page=2`)
      // B has dropped below C: B now sits on page 2.
      return p === '2' ? envelope([{ ...B, balance: '7.00' }, D]) : envelope([A, C], `${WALLETS}?kind=rider&page=2`)
    }))
    const qc = client()
    wrap(<RiderMoneyPanel auth={auth} />, qc)
    await screen.findByText('Rider A')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Rider D')
    moved = true
    await qc.invalidateQueries({ queryKey: ['staff-wallets'] })
    // The list starts again from page 1; load the rest.
    await waitFor(() => expect(screen.queryByText('Rider D')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await screen.findByText('Rider D')
    for (const n of ['Rider A', 'Rider B', 'Rider C', 'Rider D']) expect(screen.getAllByText(n)).toHaveLength(1)
  })

  it('ledger_off renders the fallback', async () => {
    server.use(http.get(WALLETS, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    wrap(<RiderMoneyPanel auth={auth} fallback={<div>The old shell</div>} />)
    expect(await screen.findByText('The old shell')).toBeInTheDocument()
  })

  it('ledger_off without a fallback says wallets are not switched on', async () => {
    server.use(http.get(WALLETS, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    wrap(<RiderMoneyPanel auth={auth} />)
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
  })

  it('embedded hides the title', async () => {
    server.use(http.get(WALLETS, () => envelope([rider()])))
    wrap(<RiderMoneyPanel auth={auth} embedded />)
    await screen.findByText('Kwesi Rider')
    expect(screen.queryByRole('heading', { name: 'Rider money' })).toBeNull()
  })
})

describe('Rider money: daily commission', () => {
  const totals = { deliveries: 3, gross: '30.00', commission: '3.00', net: '27.00', given_back: '0.00' }
  const row = (o = {}) => ({ rider_id: 3, name: 'Kwesi Rider', company_name: 'Swift Co', deliveries: 3, gross: '30.00', commission: '3.00', net: '27.00', given_back: '0.00', posted_at: '2026-10-19T00:05:00Z', ...o })
  const open = async () => {
    server.use(http.get(WALLETS, () => envelope([])))
    wrap(<RiderMoneyPanel auth={auth} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Daily commission' }))
  }

  it("daily commission defaults to the server's day and shows totals", async () => {
    let asked
    server.use(http.get(COMMISSION, ({ request }) => { asked = new URL(request.url).searchParams.has('day'); return HttpResponse.json({ day: '2026-10-19', results: [row()], totals }) }))
    await open()
    expect(await screen.findByRole('heading', { name: 'Commission posted for 2026-10-19' })).toBeInTheDocument()
    expect(asked).toBe(false)
    const r = screen.getByText('Kwesi Rider').closest('tr')
    expect(r).toHaveTextContent('Swift Co')
    expect(r).toHaveTextContent('GH₵ 30.00')
    expect(r).toHaveTextContent('GH₵ 27.00')
    expect(screen.getByRole('row', { name: /Total/ })).toHaveTextContent('GH₵ 27.00')
    expect(screen.getByText(/Each day's commission is taken after midnight, Accra time\. A missed night is caught up by the next run\./)).toBeInTheDocument()
  })

  it('choosing a day asks for that day', async () => {
    const days = []
    server.use(http.get(COMMISSION, ({ request }) => {
      const d = new URL(request.url).searchParams.get('day')
      days.push(d)
      return HttpResponse.json({ day: d || '2026-10-19', results: [], totals })
    }))
    await open()
    fireEvent.change(await screen.findByLabelText('Day'), { target: { value: '2026-10-15' } })
    expect(await screen.findByRole('heading', { name: 'Commission posted for 2026-10-15' })).toBeInTheDocument()
    expect(days).toEqual([null, '2026-10-15'])
    expect(screen.getByText('No commission was posted for 2026-10-15.')).toBeInTheDocument()
  })

  it('given back appears only when not zero', async () => {
    server.use(http.get(COMMISSION, () => HttpResponse.json({ day: '2026-10-19', results: [row()], totals })))
    await open()
    await screen.findByText('Kwesi Rider')
    expect(screen.queryByRole('columnheader', { name: 'Given back' })).toBeNull()
    server.use(http.get(COMMISSION, () => HttpResponse.json({ day: '2026-10-19', results: [row({ given_back: '1.50' })], totals: { ...totals, given_back: '1.50' } })))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('columnheader', { name: 'Given back' })).toBeInTheDocument()
    expect(screen.getByText('Kwesi Rider').closest('tr')).toHaveTextContent('GH₵ 1.50')
  })

  it('no edit controls', async () => {
    server.use(http.get(WALLETS, () => envelope([rider()])), http.get(COMMISSION, () => HttpResponse.json({ day: '2026-10-19', results: [row()], totals })))
    wrap(<RiderMoneyPanel auth={auth} />)
    await screen.findByText('Kwesi Rider')
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /edit|adjust|set|credit|debit|save/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Daily commission' }))
    await screen.findByRole('heading', { name: /Commission posted/ })
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /edit|adjust|set|credit|debit|save/i })).toBeNull()
  })
})
