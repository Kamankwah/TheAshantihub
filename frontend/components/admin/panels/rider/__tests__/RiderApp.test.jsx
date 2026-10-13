import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import { resetRiderTrackingForTests } from '../../../../../lib/riderTracking.js'
import ShiftPanel from '../ShiftPanel.jsx'
import { EarningsScreen, JobsScreen, ReportIssueScreen, RiderCashScreen, RiderDocumentsScreen, RiderMenuScreen } from '../RiderScreens.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const FIX = { coords: { latitude: 6.7, longitude: -1.62, accuracy: 12, speed: null }, timestamp: Date.now() }

beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: vi.fn((ok) => { ok({ ...FIX, timestamp: Date.now() }); return 7 }), clearWatch: vi.fn(), getCurrentPosition: vi.fn((ok) => ok({ ...FIX, timestamp: Date.now() })) },
  })
})
afterEach(() => resetRiderTrackingForTests())

const me = (over = {}) => ({
  rider: { id: 1, full_name: 'Kofi Appiah', vehicle_type: 'motorbike', vehicle: { id: 1, plate: 'AS 4471-22', description: 'Honda CG 125' }, home_zone: 'Adum', job_hold: false, suspended: false, suspension_reason: null, manager: { id: 3, full_name: 'Adwoa Sarpong', phone: '+233244000001' } },
  shift: null, papers: { required: [], missing: [], can_start_shift: true }, active_job_id: null, today: { accepted: 1, delivered: 5, could_not_deliver: 0 }, ...over,
})
const onShift = { id: 1, started_at: '2026-10-13T08:02:00Z', on_break: false, zone: 'Adum', last_lat: 6.7, last_lng: -1.62, last_fix_at: '2026-10-13T08:02:00Z', fix_age_seconds: 8, stale: false }
const base = (extra = []) => [
  ...extra,
  http.post(`${API}/api/delivery/rider/ping/`, () => HttpResponse.json({ ok: true })),
  http.get(`${API}/api/delivery/rider/shifts/`, () => HttpResponse.json({ results: [] })),
  http.get(`${API}/api/delivery/rider/documents/`, () => HttpResponse.json({ required: [], optional: [], missing: [], results: [{ id: 1, kind: 'insurance', kind_label: 'Insurance', status: 'approved', status_label: 'Approved', expires_on: '2026-10-31', days_left: 18 }, { id: 2, kind: 'ghana_card', kind_label: 'Ghana Card', status: 'approved', status_label: 'Approved', expires_on: '2031-06-09', days_left: 1700 }] })),
  http.get(`${API}/api/delivery/rider/offers/`, () => HttpResponse.json({ results: [], acceptance_30d: { accepted: 0, of: 0 } })),
  http.get(`${API}/api/delivery/rider/earnings/`, () => HttpResponse.json({ total: null, results: [], jobs: 0, jobs_without_pay: 0, could_not_deliver: 0, rates: null, payouts: { note: 'Payouts are prepared by Accounting.' } })),
  http.get(`${API}/api/delivery/rider/cash/`, () => HttpResponse.json({ cod: { offered: false, note: 'Cash on delivery is not offered at checkout yet, so you collect no cash and have nothing to hand in.' }, cap: '500.00', holding: null, handovers: [], how: 'Bring the cash to the desk.' })),
  http.get(`${API}/api/delivery/rider/jobs/`, () => HttpResponse.json({ counts: { accepted: 0, delivered: 0, could_not_deliver: 0, flagged: 0 }, results: [] })),
]

describe('Off shift', () => {
  it('shows papers honestly, warns of an expiring one and goes on shift with the phone location', async () => {
    let body
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me())), http.post(`${API}/api/delivery/rider/shift/start/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(onShift, { status: 201 }) })]))
    wrap(<ShiftPanel />)
    expect(await screen.findByText('Hello, Kofi')).toBeInTheDocument()
    expect(screen.getByText('No shift is planned for today')).toBeInTheDocument() // no rota row, so none is made up
    expect(await screen.findByText('18 days left')).toBeInTheDocument()
    expect(screen.getByText(/An expired document pauses your shifts automatically/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go on shift' }))
    await waitFor(() => expect(body).toEqual({ lat: 6.7, lng: -1.62, accuracy_m: 12 }))
    expect(navigator.geolocation.watchPosition).toHaveBeenCalled()
  })

  it('cannot go on shift with a paper missing, and says which', async () => {
    server.use(http.get(`${API}/api/delivery/rider/documents/`, () => HttpResponse.json({ required: [], missing: ['insurance'], results: [] })), ...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ papers: { required: [], missing: ['insurance'], can_start_shift: false } })))]))
    wrap(<ShiftPanel />)
    expect(await screen.findByText(/You cannot go on shift yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go on shift' })).toBeDisabled()
  })

  it('names a refusal the server gives when papers lapse mid-way', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me())), http.post(`${API}/api/delivery/rider/shift/start/`, () => HttpResponse.json({ detail: 'A paper is missing.', code: 'papers_missing', missing: ['insurance'] }, { status: 409 }))]))
    wrap(<ShiftPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Go on shift' }))
    expect(await screen.findByText('Missing or out of date: insurance.')).toBeInTheDocument()
  })
})

describe('On shift', () => {
  it('shows waiting with real counts and takes a break', async () => {
    let brk
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ shift: onShift }))), http.post(`${API}/api/delivery/rider/shift/break/`, async ({ request }) => { brk = await request.json(); return HttpResponse.json({}) })]))
    wrap(<ShiftPanel />)
    expect(await screen.findByText('Waiting for jobs')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Delivered' })).toHaveTextContent('5')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Earned' })).toHaveTextContent('Not recorded'))
    await waitFor(() => expect(screen.getByRole('group', { name: 'Cash you hold' })).toHaveTextContent('Not applicable'))
    expect(screen.getByRole('group', { name: 'Acceptance · 30 days' })).toHaveTextContent('No data yet')
    fireEvent.click(screen.getByRole('button', { name: 'Take a break' }))
    await waitFor(() => expect(brk).toEqual({ on: true }))
  })

  it('cannot end the shift with a job on the road: the server says so', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ shift: onShift }))), http.post(`${API}/api/delivery/rider/shift/end/`, () => HttpResponse.json({ detail: 'Finish your job first.', code: 'job_in_progress' }, { status: 409 }))]))
    wrap(<ShiftPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Go off shift' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish your job first.')
  })
})

describe('A new offer', () => {
  const offer = (over = {}) => ({ id: 9, order_id: 18, seconds_left: 38, expires_at: '2026-10-13T11:21:00Z', pickup: { business_name: 'Akosua Ntoma Kente', lat: 6.7, lng: -1.62 }, delivery_address: 'Ahodwo', to_pickup_km: 1.4, trip_km: 6.2, payment: { method: 'prepaid', label: 'Paid online (simulated)', cash_due: null }, deadline_at: null, pay: { total: '19.16', lines: [{ label: 'Per job', amount: '8.00' }, { label: 'Distance 6.2 km', amount: '11.16' }] }, items: 1, ...over })
  it('shows the pay from the rate card and accepts', async () => {
    let accepted = false
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ shift: onShift }))), http.get(`${API}/api/delivery/rider/offers/`, () => HttpResponse.json({ results: [offer()], acceptance_30d: { accepted: 11, of: 12 } })), http.post(`${API}/api/delivery/rider/offers/9/accept/`, () => { accepted = true; return HttpResponse.json({}) })]))
    wrap(<ShiftPanel />)
    expect(await screen.findByText('New delivery offer')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('00:38')
    expect(screen.getByText('GH₵ 19.16')).toBeInTheDocument()
    expect(screen.getByText('No limit set')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(accepted).toBe(true))
  })

  it('promises no pay when there is no rate card, and declines', async () => {
    let declined
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ shift: onShift }))), http.get(`${API}/api/delivery/rider/offers/`, () => HttpResponse.json({ results: [offer({ pay: null })], acceptance_30d: { accepted: 0, of: 0 } })), http.post(`${API}/api/delivery/rider/offers/9/decline/`, async ({ request }) => { declined = await request.json(); return HttpResponse.json({ ok: true }) })]))
    wrap(<ShiftPanel />)
    expect(await screen.findByText(/No pay is shown: there is no approved rate card yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(declined).toEqual({ reason: 'declined' }))
  })

  it('shows no offer while on a break', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ shift: { ...onShift, on_break: true } }))), http.get(`${API}/api/delivery/rider/offers/`, () => HttpResponse.json({ results: [offer()], acceptance_30d: { accepted: 0, of: 0 } }))]))
    wrap(<ShiftPanel />)
    expect(await screen.findByText('On a break')).toBeInTheDocument()
    expect(screen.queryByText('New delivery offer')).not.toBeInTheDocument()
  })
})

const step = (done) => ['accepted', 'arrived_pickup', 'picked_up', 'arrived_drop', 'delivered'].map((s, i) => ({ step: s, label: s, done: i < done, event: i < done ? { at: '2026-10-13T11:00:00Z', flagged: false } : null }))
const job = (status, over = {}) => ({
  id: 5, order_id: 18, status, status_label: status, accepted_at: '2026-10-13T11:00:00Z', arrived_pickup_at: '2026-10-13T11:05:00Z', picked_up_at: null, arrived_drop_at: null, delivered_at: null, deadline_at: null,
  customer_name: 'Yaw M.', delivery_address: 'Ahodwo', delivery_lat: 6.69, delivery_lng: -1.62, pickup: { business_name: 'Kente House', lat: 6.7001, lng: -1.62, items: ['Kente Cloth × 1'] },
  payment: { label: 'Paid online (simulated)', cash_due: null }, wait: null, steps: step(1), calls: 0, flagged: false, pickup_attempts_left: 5, drop_attempts_left: 5, ...over,
})
const activeMe = () => me({ shift: onShift, active_job_id: 5 })

describe('A job from pickup to door', () => {
  it('accepts a job that was assigned, without a location', async () => {
    let called = false
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())), http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('assigned'))), http.post(`${API}/api/delivery/rider/jobs/5/accept/`, () => { called = true; return HttpResponse.json(job('accepted')) })]))
    wrap(<ShiftPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this job' }))
    await waitFor(() => expect(called).toBe(true))
  })

  it('offers "I\'ve arrived" within 150 m and stamps the phone location', async () => {
    let body
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())), http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('accepted'))), http.post(`${API}/api/delivery/rider/jobs/5/arrive-pickup/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(job('at_pickup')) })]))
    wrap(<ShiftPanel />)
    const button = await screen.findByRole('button', { name: "I've arrived" })
    expect(screen.getByText(/Showing because you're within 150 m/)).toBeInTheDocument()
    fireEvent.click(button)
    await waitFor(() => expect(body).toEqual({ lat: 6.7, lng: -1.62, accuracy_m: 12 }))
  })

  it('says a tap farther than 150 m is flagged instead of hiding it', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())), http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('accepted', { pickup: { business_name: 'Kente House', lat: 6.75, lng: -1.62, items: [] } })))]))
    wrap(<ShiftPanel />)
    expect(await screen.findByRole('button', { name: "I've arrived: tap anyway (flagged)" })).toBeInTheDocument()
    expect(screen.getByText(/still works but is flagged for your manager/)).toBeInTheDocument()
  })

  it('needs the four-digit pickup code, never shows it, and sends it with the location', async () => {
    let body
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())), http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('at_pickup'))), http.post(`${API}/api/delivery/rider/jobs/5/pickup/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(job('picked_up', { steps: step(3) })) })]))
    wrap(<ShiftPanel />)
    const pick = await screen.findByRole('button', { name: 'Picked up' })
    expect(pick).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Pickup code'), { target: { value: '12a34' } })
    expect(screen.getByLabelText('Pickup code')).toHaveValue('1234')
    fireEvent.click(pick)
    await waitFor(() => expect(body).toEqual({ code: '1234', lat: 6.7, lng: -1.62, accuracy_m: 12 }))
  })

  it('shows the server\'s refusal of a wrong code', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())), http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('at_pickup'))), http.post(`${API}/api/delivery/rider/jobs/5/pickup/`, () => HttpResponse.json({ detail: 'That is not the shop\'s code. 4 tries left.', code: 'wrong_code' }, { status: 400 }))]))
    wrap(<ShiftPanel />)
    fireEvent.change(await screen.findByLabelText('Pickup code'), { target: { value: '0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Picked up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That is not the shop's code. 4 tries left.")
  })

  it('logs a call before dialling and asks how it went', async () => {
    let outcome
    const loc = vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, set href(v) {} })
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())), http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('picked_up', { steps: step(3) }))), http.post(`${API}/api/delivery/rider/jobs/5/call/`, () => HttpResponse.json({ call_id: 4, phone: '+233200882200' }, { status: 201 })), http.post(`${API}/api/delivery/rider/calls/4/outcome/`, async ({ request }) => { outcome = await request.json(); return HttpResponse.json({ ok: true }) })]))
    wrap(<ShiftPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Call Yaw M.' }))
    fireEvent.click(await screen.findByRole('button', { name: 'No answer' }))
    await waitFor(() => expect(outcome).toEqual({ outcome: 'no_answer' }))
    loc.mockRestore()
  })

  it('stamps "I\'m outside", then waits with a timer and delivers only with the customer\'s code', async () => {
    let outside
    let delivered
    let phase = 'picked_up'
    server.use(...base([
      http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())),
      http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(phase === 'picked_up' ? job('picked_up', { steps: step(3) }) : job('at_customer', { steps: step(4), arrived_drop_at: new Date(Date.now() - 160000).toISOString(), wait: { elapsed_seconds: 160, limit_seconds: 600, left_seconds: 440 } }))),
      http.post(`${API}/api/delivery/rider/jobs/5/arrive-drop/`, async ({ request }) => { outside = await request.json(); phase = 'at_customer'; return HttpResponse.json(job('at_customer', { steps: step(4), arrived_drop_at: new Date(Date.now() - 160000).toISOString(), wait: { elapsed_seconds: 160, limit_seconds: 600, left_seconds: 440 } })) }),
      http.post(`${API}/api/delivery/rider/jobs/5/deliver/`, async ({ request }) => { delivered = await request.json(); return HttpResponse.json(job('delivered', { steps: step(5), delivered_at: '2026-10-13T11:54:00Z' })) }),
    ]))
    wrap(<ShiftPanel />)
    fireEvent.click(await screen.findByRole('button', { name: "I'm outside: tap anyway (flagged)" }))
    await waitFor(() => expect(outside).toEqual({ lat: 6.7, lng: -1.62, accuracy_m: 12 }))
    expect(await screen.findByRole('timer')).toHaveTextContent('02:4')
    const deliver = screen.getByRole('button', { name: 'Delivered' })
    expect(deliver).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Delivery code'), { target: { value: '9876' } })
    fireEvent.click(deliver)
    await waitFor(() => expect(delivered).toEqual({ code: '9876', lat: 6.7, lng: -1.62, accuracy_m: 12 }))
  })

  it('blocks "No answer" until the wait is over and two calls are logged', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())), http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('at_customer', { steps: step(4), calls: 1, arrived_drop_at: new Date(Date.now() - 60000).toISOString(), wait: { elapsed_seconds: 60, limit_seconds: 600, left_seconds: 540 } })))]))
    wrap(<ShiftPanel />)
    fireEvent.click(await screen.findByRole('button', { name: "Can't deliver?" }))
    fireEvent.click(await screen.findByLabelText(/No answer/))
    expect(screen.getByText(/needs the full 10:00 wait at the door and 2 logged calls/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Confirm: can't deliver" })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Wrong address/))
    expect(screen.getByRole('button', { name: "Confirm: can't deliver" })).toBeEnabled()
  })

  it('sends the reason and note when the customer refuses', async () => {
    let body
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(activeMe())), http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('at_customer', { steps: step(4), arrived_drop_at: new Date().toISOString(), wait: { elapsed_seconds: 5, limit_seconds: 600, left_seconds: 595 } }))), http.post(`${API}/api/delivery/rider/jobs/5/cant-deliver/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(job('failed')) })]))
    wrap(<ShiftPanel />)
    fireEvent.click(await screen.findByRole('button', { name: "Can't deliver?" }))
    fireEvent.click(await screen.findByLabelText(/Customer refused/))
    fireEvent.change(screen.getByLabelText(/Anything to add/), { target: { value: 'Said it was the wrong item' } })
    fireEvent.click(screen.getByRole('button', { name: "Confirm: can't deliver" }))
    await waitFor(() => expect(body).toEqual({ reason: 'refused', note: 'Said it was the wrong item', lat: 6.7, lng: -1.62, accuracy_m: 12 }))
  })

  it('shows the delivered summary with the pay recorded for the job, or says none was', async () => {
    server.use(...base([
      http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ shift: onShift }))),
      http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job('delivered', { steps: step(5), delivered_at: '2026-10-13T11:54:00Z' }))),
      http.get(`${API}/api/delivery/rider/earnings/`, () => HttpResponse.json({ total: '19.16', results: [{ assignment_id: 5, pay: '19.16', lines: [{ label: 'Per job', amount: '8.00' }, { label: 'Distance 6.2 km', amount: '11.16' }], wait_pay_held: false }], jobs: 1, jobs_without_pay: 0 })),
    ]))
    // the shift screen reaches the summary by a job id that just finished
    const { ActiveJobForTest } = await import('./helpers.jsx')
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText('Delivered')).toBeInTheDocument()
    expect(await screen.findByText('GH₵ 19.16', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/Payments are simulated until Hubtel is connected/)).toBeInTheDocument()
  })
})

describe('The other rider screens', () => {
  it('Jobs: counts and flags come from the server; nothing is invented for an empty day', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/jobs/`, () => HttpResponse.json({ counts: { accepted: 2, delivered: 1, could_not_deliver: 1, flagged: 1 }, results: [{ id: 5, order_id: 20, status: 'failed', status_label: 'Failed', failed_reason: 'no_answer', assigned_at: '2026-10-13T12:00:00Z', pickup: { business_name: 'Nana\'s Chop Bar' }, customer_name: 'Akua B.', delivery_address: 'Adum', payment: { label: 'Paid online (simulated)' }, calls: 2, flagged: true, rider_note: 'Met at the junction' }] }))]))
    wrap(<JobsScreen />)
    expect(await screen.findByText('Could not deliver', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Flagged taps' })).toHaveTextContent('1')
    expect(screen.getByText(/Met at the junction/)).toBeInTheDocument()
  })

  it('Earnings: records pay, says payouts are not connected, and shows no total without pay', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/earnings/`, () => HttpResponse.json({ period: 'today', total: null, jobs: 2, jobs_without_pay: 2, could_not_deliver: 1, results: [{ assignment_id: 1, order_id: 18, pay: null, km: null, lines: [], wait_pay_held: false }], rates: null, rate_change_pending: false, payouts: { status: 'not_connected', note: 'Payouts are prepared by Accounting. Payments are simulated until Hubtel is connected, so no money has moved.' } }))]))
    wrap(<EarningsScreen />)
    expect(await screen.findByRole('region', { name: 'Total' })).toHaveTextContent('Not recorded')
    expect(screen.getByText(/No rate card has been approved yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/Payments are simulated until Hubtel/).length).toBeGreaterThan(0)
  })

  it('Cash: says cash on delivery is not offered rather than showing a balance', async () => {
    server.use(...base())
    wrap(<RiderCashScreen />)
    expect(await screen.findByText(/Cash on delivery is not offered at checkout yet/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Holding' })).not.toBeInTheDocument()
  })

  it('Cash: holding, cap and room once a job carries cash', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/cash/`, () => HttpResponse.json({ cod: { offered: true }, cap: '500.00', holding: '180.00', room: '320.00', collected_today: '360.00', remitted_today: '180.00', lines: [], handovers: [], how: 'Bring the cash to the desk.' }))]))
    wrap(<RiderCashScreen />)
    expect(await screen.findByRole('region', { name: 'Holding' })).toHaveTextContent('room for GH₵ 320.00 more')
    expect(screen.getByRole('group', { name: 'Remitted' })).toHaveTextContent('GH₵ 180.00')
  })

  it('Report an issue: goes to the manager with the location, and can pause offers', async () => {
    let body
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me())), http.post(`${API}/api/delivery/rider/issues/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) })]))
    wrap(<ReportIssueScreen />)
    const send = await screen.findByRole('button', { name: 'Send to Adwoa' })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Vehicle problem'))
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Front tyre' } })
    fireEvent.click(screen.getByLabelText(/Pause new offers/))
    fireEvent.click(send)
    await waitFor(() => expect(body).toEqual({ kind: 'vehicle', text: 'Front tyre', lat: 6.7, lng: -1.62, pause_offers: true }))
    expect(await screen.findByText('Sent to Adwoa Sarpong')).toBeInTheDocument()
  })

  it('Documents: uploads a renewal as a file', async () => {
    const append = vi.spyOn(FormData.prototype, 'append')
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me())), http.post(`${API}/api/delivery/rider/documents/`, () => HttpResponse.json({ id: 3 }, { status: 201 }))]))
    wrap(<RiderDocumentsScreen />)
    expect(await screen.findByText('Ghana Card')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Photo or PDF/), { target: { files: [new File(['x'], 'cert.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for checking' }))
    expect(await screen.findByText('Sent for checking.')).toBeInTheDocument()
    expect(append.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['kind', 'file']))
    append.mockRestore()
  })

  it('Menu: profile, the manager line and sign out', async () => {
    const onSignOut = vi.fn()
    const onSelect = vi.fn()
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ shift: onShift }))), http.get(`${API}/api/accounts/staff/sessions/`, () => HttpResponse.json([]))]))
    wrap(<RiderMenuScreen auth={{ user: { full_name: 'Kofi Appiah' } }} onSelect={onSelect} onSignOut={onSignOut} />)
    expect(await screen.findByText('Reports to Adwoa Sarpong, Delivery Manager')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Report an issue/ }))
    expect(onSelect).toHaveBeenCalledWith('dr-issue')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalled()
  })
})
