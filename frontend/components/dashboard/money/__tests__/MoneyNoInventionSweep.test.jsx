import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import PaymentsPanel from '../../panels/PaymentsPanel.jsx'
import DailySummary from '../DailySummary.jsx'
import FeesPage from '../FeesPage.jsx'
import MoneyOverview from '../MoneyOverview.jsx'
import SalesList from '../SalesList.jsx'
import TextsSettings from '../TextsSettings.jsx'

// Conformance sweep (Plan 4F, Task 13): every owner-only money screen, rendered
// with populated data whose fixtures carry a customer name, must hold the
// money and no-invention rules. Money values are the elements marked
// `data-amount`.

const API = 'http://localhost:8000'
const NAME = 'Yaa Buyer'
const GOLD = /#d4a017/i
const envelope = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })
const wrap = (ui) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
)

const orderRow = {
  kind: 'order', order: 41, reference: 'Order #41', placed_at: '2026-10-12T09:30:00Z',
  items: [{ name: 'Kente scarf', quantity: 2, line_total: '80.00' }],
  item_subtotal: '80.00', refunded: '5.00', platform_fee: '4.00', free_delivery_promo: '2.00', net: '69.00',
  status: 'awaiting_call', status_label: 'Waiting for Support to confirm', handed_over: true, on_hold: false, released_at: null,
  customer: NAME, customer_name: NAME,
}
const bookingRow = (over = {}) => ({
  kind: 'booking', sale: 7, booking_kind: 'service', booking_kind_label: 'Service', reference: 'Booking #7',
  what: 'Hair braiding', placed_at: '2026-10-14T08:00:00Z', item_subtotal: '150.00', refunded: '0.00',
  platform_fee: '7.50', free_delivery_promo: '0.00', net: '142.50', status: 'awaiting_call',
  status_label: 'Waiting for the customer to accept, or the automatic release', on_hold: false,
  customer_accepted: false, release_at: '2026-10-16T14:05:00Z', released_at: null,
  customer: NAME, customer_name: NAME, ...over,
})
const day = (over = {}) => ({
  day: '2026-10-14', orders: 3, sold: '300.00', fees: '15.00', released: '120.00', refunded: '10.00',
  free_delivery_promo: '2.00', withdrawn: '50.00', other: '-5.00', net_change: '-40.50', ...over,
})
const band = (over = {}) => ({ from: '0.00', to: null, percent: '1', flat: null, fee: '1%', ...over })
const category = (key, label) => ({
  category: key, label, applies_to: `${label} sold`, charged: true, in_force_from: '2026-10-06T06:00:00+00:00',
  bands: [band({ to: '100.00', fee: '2%' }), band({ from: '100.00', fee: 'GH₵ 3.00 flat' })], next: null,
})
const text = (over = {}) => ({
  id: 1, kind: 'order_paid', order: 5, day: null, body: 'GHS 50.00 paid for order 5.', status: 'not_sent',
  status_label: 'Not sent: texts are simulated', to: '024 *** 4567', created_at: '2026-10-20T09:05:00Z', simulated: true,
  sent_at: null, ...over,
})

const serveAll = () => server.use(
  http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'vendor', pending: '120.00', available: '48.50' })),
  http.get(`${API}/api/wallet/vendor/`, () => HttpResponse.json({
    pending: '120.00', available: '48.50', withdrawable: '40.00', negative: false, awaiting_call: 3,
    fee_cap: { limit: '500.00', used: '120.00', remaining: '380.00' }, withdrawing: '15.25',
  })),
  http.get(`${API}/api/wallet/vendor/sales/`, () => envelope([orderRow])),
  http.get(`${API}/api/wallet/vendor/bookings/`, () => envelope([
    bookingRow(),
    bookingRow({ sale: 8, reference: 'Booking #8', status: 'on_hold', status_label: 'On hold: a problem was reported', on_hold: true, release_at: null }),
  ])),
  http.get(`${API}/api/wallet/vendor/daily/`, () => HttpResponse.json({
    from: '2026-10-01', to: '2026-10-20', days: [day(), day({ day: '2026-10-12', net_change: '223.00' })], totals: day({ day: undefined, net_change: '182.50' }),
  })),
  http.get(`${API}/api/wallet/vendor/fees/`, ({ request }) => {
    const body = {
      categories: [category('product', 'Products'), category('service', 'Services')],
      fee_base: 'Worked out per order on your items only.',
      fee_cap: { limit: '500.00', used: '120.00', remaining: '380.00' },
    }
    if (new URL(request.url).searchParams.get('amount')) {
      body.quote = { category: 'service', amount: '50.00', fee: '0.50', you_receive: '49.50', charged: true }
    }
    return HttpResponse.json(body)
  }),
  http.get(`${API}/api/wallet/vendor/texts/`, () => HttpResponse.json({
    order_texts: true, daily_digest: true, phone: '024 *** 4567', note: null,
    recent: [text(), text({ id: 2, kind: 'booking_on_hold', order: null, body: 'A problem was reported on a booking; the payment is on hold.', status_label: 'Not sent: texts are simulated' })],
  })),
  http.get(`${API}/api/orders/owner/report/`, () => HttpResponse.json({
    summary: { total_sales: '100.00', order_count: 1, item_count: 1 }, series: [], customer_names: false,
    rows: [{ order_id: 1, date: '2026-10-01T10:00:00Z', item: 'Kente Cloth', kind: 'product', quantity: 1, line_total: '100.00' }],
  })),
  http.get(`${API}/api/events/mine/`, () => HttpResponse.json([])),
)

function sweep(container) {
  const html = container.innerHTML
  const text = container.textContent
  expect(container.querySelectorAll('a[href^="tel:"]').length).toBe(0)
  expect(html).not.toMatch(/wa\.me/)
  expect(text).not.toMatch(/whatsapp/i)
  expect(text).not.toContain(NAME)
  expect(text).not.toMatch(/NaN|undefined/)
  const amounts = container.querySelectorAll('[data-amount]')
  amounts.forEach((el) => {
    const style = el.getAttribute('style') || ''
    expect(style, `amount "${el.textContent}" needs tabular-nums`).toMatch(/font-variant-numeric:\s*tabular-nums/i)
    expect(style, `amount "${el.textContent}" must not be gold`).not.toMatch(GOLD)
  })
  return amounts.length
}

const scenarios = [
  ['MoneyOverview', () => <MoneyOverview onOpenPayouts={() => {}} />, 'Can be withdrawn now'],
  ['SalesList (orders and bookings, one on hold)', () => <><SalesList businessKind="product" /><SalesList businessKind="service" /></>, /Booking #8/],
  ['DailySummary', () => <DailySummary />, '2026-10-01 to 2026-10-20'],
  ['TextsSettings', () => <TextsSettings />, 'Texts go to 024 *** 4567.'],
]

describe('money screens conformance sweep', () => {
  describe.each(scenarios)('%s', (_name, ui, ready) => {
    it('holds the money and no-invention rules with populated data', async () => {
      serveAll()
      const { container } = wrap(ui())
      await screen.findByText(ready)
      await waitFor(() => expect(container.textContent.length).toBeGreaterThan(0))
      sweep(container)
    })
  })

  it('SalesList: the Orders view with a customer name in the data', async () => {
    serveAll()
    const { container } = wrap(<SalesList businessKind="service" />)
    await screen.findByText(/Booking #8/)
    expect(screen.getByText('On hold: a problem was reported')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }))
    await screen.findByText('Order #41')
    sweep(container)
  })

  it('FeesPage with a quote holds the rules', async () => {
    serveAll()
    const { container } = wrap(<FeesPage />)
    const input = await screen.findByLabelText('Sale amount (GH₵)')
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'service' } })
    fireEvent.click(screen.getByRole('button', { name: 'Work it out' }))
    await screen.findByText(/platform fee/)
    sweep(container)
  })

  it('Payments Sales Overview with customer_names false shows no customer', async () => {
    serveAll()
    const { container } = wrap(<PaymentsPanel user={{ fullName: 'Abena' }} PaymentComponent={() => null} businessKind="product" />)
    await screen.findByText(/Kente Cloth/)
    expect(screen.queryByText('Customer')).not.toBeInTheDocument()
    sweep(container)
  })

  it('the sweep is not vacuous: money amounts are found', async () => {
    serveAll()
    const { container } = wrap(<><SalesList businessKind="product" /><DailySummary /></>)
    await screen.findByText('Order #41')
    await screen.findByText('2026-10-01 to 2026-10-20')
    expect(sweep(container)).toBeGreaterThanOrEqual(10)
  })

  const FRONTEND = process.cwd()
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    if (f === 'node_modules' || f.startsWith('.')) return []
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

  it('test_no_hour_literals_in_money_components', () => {
    const dir = join(FRONTEND, 'components/dashboard/money')
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsx'))
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/\b(24|48|72)\s*hours?\b/)
    }
  })

  it('test_money_components_are_imported_only_by_the_business_dashboard', () => {
    const money = join(FRONTEND, 'components/dashboard/money')
    const dashboard = join(FRONTEND, 'components/dashboard')
    const offenders = ['components', 'hooks', 'pages', 'utils', 'mocks']
      .map((d) => join(FRONTEND, d))
      .flatMap((d) => { try { return walk(d) } catch { return [] } })
      .concat(readdirSync(FRONTEND).filter((f) => /\.(jsx?|tsx?)$/.test(f)).map((f) => join(FRONTEND, f)))
      .filter((f) => /\.(jsx?|tsx?)$/.test(f) && !f.startsWith(`${dashboard}/`))
      .filter((f) => /dashboard\/money\//.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => relative(FRONTEND, f))).toEqual([])
    expect(money).toBeTruthy()
  })
})
