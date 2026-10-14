import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import { CashPanel, PayoutsPanel } from '../CashPanel.jsx'
import { AutoAssignRulesPanel, DeliveryPricingPanel, TimeLimitsPanel } from '../RulesPanels.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const dm = { user: { full_name: 'Adwoa', role: 'delivery_manager' }, hasPermission: () => true }
const sa = { user: { full_name: 'Simon', role: 'super_admin' }, hasPermission: () => true }

describe('Cash on delivery', () => {
  const cash = (over = {}) => ({ cod: { offered: false, note: 'Cash on delivery is not offered at checkout yet, so riders hold no cash from deliveries.' }, cap: { amount: '500.00', source: 'defaults', version: null }, riders: [{ id: 1, full_name: 'Kofi Appiah', holding: '0.00', over_cap: false, cap: '500.00' }], over_cap: 0, handovers: [], shortfalls: [], bank_matching: 'not_connected', ...over })
  it('says cash is not offered, invents no collected figure and offers no hand-over to count', async () => {
    server.use(http.get(`${API}/api/delivery/cash/`, () => HttpResponse.json(cash())))
    wrap(<CashPanel />)
    expect(await screen.findByText(/Cash on delivery is not offered at checkout yet/)).toBeInTheDocument()
    expect(screen.getByText(/No rider holds cash, so there is nothing to count/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Riders holding cash' })).toHaveTextContent('0')
  })

  it('counts a hand-over and reports the shortfall the server worked out', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/cash/`, () => HttpResponse.json(cash({ cod: { offered: true, note: null }, riders: [{ id: 1, full_name: 'Kofi Appiah', holding: '300.00', over_cap: false }, { id: 2, full_name: 'Esi Owusu', holding: '600.00', over_cap: true }], over_cap: 1 }))),
      http.post(`${API}/api/delivery/cash/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1, expected: '300.00', counted: '250.00', difference: '-50.00' }, { status: 201 }) }),
    )
    wrap(<CashPanel />)
    expect((await screen.findAllByText('Over the cap')).length).toBeGreaterThan(0)
    const form = screen.getByRole('region', { name: 'Count a hand-over' })
    fireEvent.change(within(form).getByLabelText('Rider'), { target: { value: '1' } })
    fireEvent.change(within(form).getByLabelText('Amount you counted (GH₵)'), { target: { value: '250' } })
    fireEvent.change(within(form).getByLabelText(/Note/), { target: { value: 'Customer short-paid' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(body).toEqual({ rider: 1, counted: '250', note: 'Customer short-paid' }))
    expect(await screen.findByText(/short by GH₵ 50.00/)).toBeInTheDocument()
  })
})

describe('Rider payouts', () => {
  it('is a record of pay, not a payment, and does not guess pay for a job that has none', async () => {
    server.use(
      http.get(`${API}/api/delivery/payouts/`, () => HttpResponse.json({ since: '2026-09-29T00:00:00Z', weeks: 2, card: null, riders: [{ staff_id: 4, full_name: 'Kofi Appiah', jobs: 5, jobs_with_pay: 0, earned: null }], payout: { status: 'not_connected', note: 'Payout runs, tax and bank matching arrive with the Accounting phase.' } })),
      http.get(`${API}/api/delivery/payouts/4/`, () => HttpResponse.json({ results: [{ assignment_id: 1, order_id: 8, delivered_at: '2026-10-13T08:00:00Z', pay: null, breakdown: {}, wait_pay_held: false }] })),
    )
    wrap(<PayoutsPanel />)
    expect(await screen.findByText(/Payout runs, tax and bank matching arrive with the Accounting phase/)).toBeInTheDocument()
    expect(screen.getByText(/No rate card is in force/)).toBeInTheDocument()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kofi Appiah' }))
    expect(await screen.findByText(/No rate card was in force/)).toBeInTheDocument()
  })
})

const versions = (current, over = {}) => ({ current, pending: null, history: current ? [{ version: current.version, effective_at: '2026-09-01T08:00:00Z', proposed_by: 'Adwoa', approved_by: 'Simon' }] : [], ...over })

describe('Auto-assign rules', () => {
  const defaults = { w_distance: 50, w_fairness: 30, w_idle: 20, offer_timeout_s: 45, max_declines: 3, force_slack_min: 10, radius_km: '5.00', max_active_jobs: 2, stale_s: 120, batch_radius_km: '2.00', cash_cap: '500.00' }
  it('labels the rider radius as km (estimate) because the radius is checked against the estimate', async () => {
    server.use(
      http.get(`${API}/api/delivery/rules/auto-assign/`, () => HttpResponse.json(versions(null, { effective: { source: 'defaults', version: null }, defaults, switch: { on: true } }))),
      http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json({ results: [], total: 0, auto_assign: { on: true }, recent: [], deadlines: 'none', routing: { factor: 1.3 } })),
    )
    wrap(<AutoAssignRulesPanel auth={dm} onNavigate={() => {}} />)
    expect(await screen.findByText('Rider radius from the pickup')).toBeInTheDocument()
    expect(screen.getByText('km (estimate)')).toBeInTheDocument()
  })

  it('starts from the built-in defaults, names them as such and sends a change for approval', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/rules/auto-assign/`, () => HttpResponse.json(versions(null, { effective: { source: 'defaults', version: null }, defaults, switch: { on: true } }))),
      http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json({ results: [], total: 0, auto_assign: { on: true }, recent: [], deadlines: 'none', routing: { factor: 1.3 } })),
      http.post(`${API}/api/delivery/rules/auto-assign/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ approval_id: 3, status: 'pending', applied: false }, { status: 201 }) }),
    )
    wrap(<AutoAssignRulesPanel auth={dm} onNavigate={() => {}} />)
    expect(await screen.findByText(/the built-in defaults are running/)).toBeInTheDocument()
    expect(screen.getByText(/the built-in defaults, never approved/)).toBeInTheDocument()
    expect(screen.getByLabelText('Batch drop-offs within').closest('div')).toHaveTextContent('nothing acts on this yet')
    fireEvent.change(screen.getByLabelText('Distance weight'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Fairness weight'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(body.values.w_distance).toBe('60'))
    expect(body.values.w_fairness).toBe('20')
    expect(await screen.findByText(/Sent for approval/)).toBeInTheDocument()
  })

  it('shows a waiting change and lets its maker withdraw it; a Super Admin applies at once', async () => {
    let withdrawn
    server.use(
      http.get(`${API}/api/delivery/rules/auto-assign/`, () => HttpResponse.json(versions({ ...defaults, version: 2, approved_by: 'Simon', effective_at: '2026-09-01T08:00:00Z' }, { pending: { approval_id: 9, values: { w_distance: 60 }, proposed_by: 'Adwoa', created_at: '2026-10-12T09:00:00Z', note: '' }, effective: { source: 'version', version: 2 }, defaults, switch: { on: false } }))),
      http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json({ results: [], total: 0, auto_assign: { on: false }, recent: [], deadlines: 'set', routing: { factor: 1.3 } })),
      http.post(`${API}/api/delivery/rules/withdraw/`, async ({ request }) => { withdrawn = await request.json(); return HttpResponse.json({ ok: true }) }),
    )
    wrap(<AutoAssignRulesPanel auth={sa} onNavigate={() => {}} />)
    expect(await screen.findByText('Version 2 in force · approved by Simon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply now' })).toBeDisabled() // one change at a time
    expect(screen.getByRole('button', { name: 'Switch auto-assign on' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(withdrawn).toEqual({ approval_id: 9 }))
  })
})

describe('Delivery time limits', () => {
  it('starts empty, offers suggested values as suggestions only and counts on time from real jobs', async () => {
    server.use(http.get(`${API}/api/delivery/rules/time-limits/`, () => HttpResponse.json(versions(null, { met_30d: { met: 0, of: 0 }, defaults: { promise_standard_min: 90, promise_express_min: 45, opens_at: '07:00', closes_at: '20:00', assign_within_min: 10, pickup_within_min: 30, first_response_hours: 2, dispute_answer_hours: 24 } }))))
    wrap(<TimeLimitsPanel auth={dm} />)
    expect(await screen.findByText('No version in force yet')).toBeInTheDocument()
    expect(screen.getByText(/No delivery has had a deliver-by time yet/)).toBeInTheDocument()
    expect(screen.getByLabelText('Standard promise')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Fill in suggested values' }))
    expect(screen.getByLabelText('Standard promise')).toHaveValue('90')
    expect(screen.getByText(/A starting point, not an approved limit/)).toBeInTheDocument()
  })
})

describe('Delivery pricing', () => {
  const card = { version: 3, customer_base: '5.00', customer_per_km: '2.50', customer_min_fee: '8.00', extra_pickup: '3.00', express_multiplier: '1.30', round_up_to: '0.50', rider_per_job: '8.00', rider_per_km: '1.80', wait_after_min: 10, wait_per_min: '0.20', vehicle_multipliers: { motorbike: '1.00', car: '1.40' }, approved_by: 'Simon', effective_at: '2026-09-01T08:00:00Z' }
  const base = (over = {}) => versions(card, { fee_charging: { enabled: false, note: 'Customers are charged a delivery fee only when delivery fees are switched on.' }, distance_basis: 'straight-line estimate x 1.3', ...over })
  it('shows the delivery limits in force and offers them for change', async () => {
    server.use(http.get(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json(base({ cart_limits: { source: 'defaults', version: null, max_shops_per_delivery: 4, max_food_shops: 2, near_shop_radius_km: '3.00', detour_limit_pct: 40 } }))))
    wrap(<DeliveryPricingPanel auth={dm} />)
    expect(await screen.findByText(/up to 4 shops, 2 food places, nearby within 3\.00 km, detour allowance 40%/)).toBeInTheDocument()
    expect(screen.getByText(/built-in defaults/)).toBeInTheDocument()
    expect(screen.getByLabelText('Shops per delivery (most)')).toBeInTheDocument()
    expect(screen.getByLabelText('Detour allowance')).toBeInTheDocument()
  })
  const withLimits = (over = {}) => base({ cart_limits: { source: 'defaults', version: null, max_shops_per_delivery: 4, max_food_shops: 2, near_shop_radius_km: '3.00', detour_limit_pct: 40 }, ...over })
  it('starts the limit fields from the limits in force when no card was approved', async () => {
    server.use(http.get(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json(withLimits({ current: null, history: [] }))))
    wrap(<DeliveryPricingPanel auth={dm} />)
    expect(await screen.findByLabelText('Shops per delivery (most)')).toHaveValue('4')
    expect(screen.getByLabelText('Detour allowance')).toHaveValue('40')
    expect(screen.getByText(/built-in defaults/)).toBeInTheDocument()
  })

  it.each([
    ['Shops per delivery (most)', '0', 'Enter a number from 1 to 6.'],
    ['Shops per delivery (most)', '7', 'Enter a number from 1 to 6.'],
    ['Food places per delivery (most)', '7', 'Enter a number from 0 to 6.'],
    ['Food places per delivery (most)', '3', 'Food places cannot be more than the shops allowed per delivery.', ['Shops per delivery (most)', '2']],
    ['Nearby shop distance', '0.4', 'Enter a distance from 0.5 to 20 km.'],
    ['Nearby shop distance', '21', 'Enter a distance from 0.5 to 20 km.'],
    ['Detour allowance', '301', 'Enter a number from 0 to 300.'],
  ])('blocks %s = %s with an inline message', async (label, value, message, pre) => {
    let posted = false
    server.use(
      http.get(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json(withLimits())),
      http.post(`${API}/api/delivery/rules/rate-card/`, () => { posted = true; return HttpResponse.json({ applied: false }) }),
    )
    wrap(<DeliveryPricingPanel auth={dm} />)
    const input = await screen.findByLabelText(label)
    if (pre) fireEvent.change(screen.getByLabelText(pre[0]), { target: { value: pre[1] } })
    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: /Send for approval|Apply now/ }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('names the limit the server refused', async () => {
    server.use(
      http.get(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json(withLimits())),
      http.post(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json({ detail: 'Enter a distance from 0.50 to 20 km.', field: 'near_shop_radius_km' }, { status: 400 })),
    )
    wrap(<DeliveryPricingPanel auth={dm} />)
    await screen.findByLabelText('Nearby shop distance')
    fireEvent.click(screen.getByRole('button', { name: /Send for approval|Apply now/ }))
    expect((await screen.findAllByText(/Nearby shop distance: Enter a distance from 0\.50 to 20 km\./))[0]).toBeInTheDocument()
  })

  it('says fees are switched off, and tries a route under the proposed values', async () => {
    let quote
    server.use(
      http.get(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json(base())),
      http.post(`${API}/api/delivery/rules/rate-card/quote/`, async ({ request }) => { quote = await request.json(); return HttpResponse.json({ source: 'proposed', customer: { total: '21.00', lines: [{ label: 'Base', amount: '5.00' }], distance_km: '6.2', distance_basis: 'straight-line estimate x 1.3' }, rider: { total: '19.16', lines: [] } }) }),
    )
    wrap(<DeliveryPricingPanel auth={dm} />)
    expect(await screen.findByText(/Delivery fees are switched off/)).toBeInTheDocument()
    expect(screen.getByText(/No VAT is charged on delivery fees/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Customer per km'), { target: { value: '3.00' } })
    fireEvent.change(screen.getByLabelText('Road distance (km)'), { target: { value: '6.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Work out with the values above' }))
    await waitFor(() => expect(quote.values.customer_per_km).toBe('3.00'))
    expect(quote.values.vehicle_multipliers.car).toBe('1.40')
    expect(await screen.findByText(/customer pays/)).toHaveTextContent('GH₵ 21.00')
  })

  it('cannot try a route under the card in force when none is in force', async () => {
    server.use(http.get(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json(base({ current: null, history: [] }))))
    wrap(<DeliveryPricingPanel auth={dm} />)
    expect(await screen.findByText('No version in force yet')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Road distance (km)'), { target: { value: '5' } })
    expect(screen.queryByRole('button', { name: 'Work out with the card in force' })).not.toBeInTheDocument()
  })

  it('prints the server distance basis and no hardcoded route-service claim', async () => {
    server.use(http.get(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json(base({ distance_basis: 'road route' }))))
    wrap(<DeliveryPricingPanel auth={dm} />)
    expect(await screen.findByText('Distance basis: road route.')).toBeInTheDocument()
    expect(screen.queryByText(/not connected/i)).toBeNull()
  })

})
