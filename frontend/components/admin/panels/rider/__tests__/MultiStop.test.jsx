import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import { resetRiderTrackingForTests } from '../../../../../lib/riderTracking.js'
import JobMap from '../JobMap.jsx'
import { ActiveJobForTest } from './helpers.jsx'

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

const STOPS = [
  { id: 1, sequence: 1, business_name: 'Kente House', lat: 6.7001, lng: -1.62, status: 'collected', items: ['Kente × 1'], attempts_left: 5, planned_arrival: null },
  { id: 2, sequence: 2, business_name: 'Adwoa Beads', lat: 6.705, lng: -1.615, status: 'arrived', items: ['Beads × 2'], attempts_left: 3, planned_arrival: null },
  { id: 3, sequence: 3, business_name: 'Chop Corner', lat: 6.71, lng: -1.61, status: 'pending', items: ['Waakye × 1'], attempts_left: 5, planned_arrival: null },
]
const steps = ['accepted', 'arrived_pickup', 'picked_up', 'arrived_drop', 'delivered'].map((s, i) => ({ step: s, label: s, done: i < 2, event: i < 2 ? { at: '2026-10-14T11:00:00Z', flagged: false } : null }))
const job = (over = {}) => ({
  id: 5, order_id: 18, status: 'at_pickup', status_label: 'Arrived at pickup', accepted_at: '2026-10-14T11:00:00Z', arrived_pickup_at: '2026-10-14T11:20:00Z',
  picked_up_at: null, arrived_drop_at: null, delivered_at: null, deadline_at: null, customer_name: 'Yaw M.', delivery_address: 'Ahodwo',
  delivery_lat: 6.69, delivery_lng: -1.62, pickups: STOPS, current_stop: STOPS[1], current_stop_id: 2, pickup: STOPS[1], multi_pickup: true,
  progress: { total: 3, done: 1, skipped: 0, current: 2 }, payment: { label: 'Paid online (simulated)', cash_due: null }, wait: null,
  steps, calls: 0, flagged: false, pickup_attempts_left: 3, drop_attempts_left: 5, failed_reason: '', ...over,
})
const serve = (body, extra = []) => server.use(
  http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json({ rider: { id: 1, manager: null }, shift: null })),
  http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(body)),
  http.get(`${API}/api/orders/dispatch/5/map/`, () => HttpResponse.json({ stage: body.status, pickup: null, pickups: [], drop: null, rider: null, leg: null, route: null })),
  http.post(`${API}/api/delivery/rider/ping/`, () => HttpResponse.json({ ok: true })),
  ...extra,
)

describe('A delivery from several shops', () => {
  it('at a stop: names the shop, says stop 2 of 3, and shows only its items and tries', async () => {
    serve(job())
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText('Order #18 · at pickup · stop 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Beads × 2')).toBeInTheDocument()
    expect(screen.queryByText('Kente × 1')).not.toBeInTheDocument()
    expect(screen.getByText(/3 tries left\./)).toBeInTheDocument()
  })

  it("collects with that shop's code", async () => {
    let body
    serve(job(), [http.post(`${API}/api/delivery/rider/jobs/5/pickup/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(job({ status: 'accepted' })) })])
    wrap(<ActiveJobForTest id={5} />)
    fireEvent.change(await screen.findByLabelText('Pickup code'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Picked up' }))
    await waitFor(() => expect(body).toEqual({ code: '1234', lat: 6.7, lng: -1.62, accuracy_m: 12 }))
  })

  it('skips a shop only with a note', async () => {
    let body
    serve(job(), [http.post(`${API}/api/delivery/rider/jobs/5/skip-stop/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(job({ status: 'accepted' })) })])
    wrap(<ActiveJobForTest id={5} />)
    fireEvent.click(await screen.findByRole('button', { name: "Can't hand over?" }))
    const confirm = screen.getByRole('button', { name: 'Confirm: skip this shop' })
    expect(confirm).toBeDisabled()
    expect(screen.getByText(/AshantiHub Support reviews this shop's items for a refund\. The shop sees only the time and your note; phone numbers and emails are removed/)).toBeInTheDocument()
    expect(screen.getByText(/Your location is sent with this report/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Closed for a funeral' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(body).toEqual({ stop_id: 2, note: 'Closed for a funeral', lat: 6.7, lng: -1.62, accuracy_m: 12 }))
  })

  it('on the way: the next shop is named, then the customer', async () => {
    const heading = [STOPS[0], { ...STOPS[1], status: 'pending' }, STOPS[2]]
    serve(job({ status: 'accepted', pickups: heading, current_stop: heading[1], current_stop_id: 2, pickup: heading[1] }))
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText('Order #18 · to pickup · stop 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Adwoa Beads')).toBeInTheDocument()
    expect(screen.getByText('Chop Corner')).toBeInTheDocument() // "Then to"
  })

  it('a delivery where no shop could hand over says so', async () => {
    serve(job({ status: 'failed', failed_reason: 'all_stops_skipped' }))
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText(/No shop could hand over the items. The order has gone back to your manager/)).toBeInTheDocument()
  })
})

describe('Skipping a shop, edge cases', () => {
  const skipIt = async () => {
    fireEvent.click(await screen.findByRole('button', { name: "Can't hand over?" }))
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Closed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: skip this shop' }))
  }
  it('a retry that finds the shop already done reloads the job without an error', async () => {
    let loads = 0
    serve(job(), [http.post(`${API}/api/delivery/rider/jobs/5/skip-stop/`, () => HttpResponse.json({ detail: 'That shop is already done.', code: 'stop_done' }, { status: 409 }))])
    server.use(http.get(`${API}/api/delivery/rider/jobs/5/`, () => { loads += 1; return HttpResponse.json(job()) }))
    wrap(<ActiveJobForTest id={5} />)
    await skipIt()
    await waitFor(() => expect(loads).toBeGreaterThan(1))
    expect(await screen.findByRole('button', { name: 'Picked up' })).toBeInTheDocument()
    expect(screen.queryByLabelText('What happened')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('shows the server message when the location is missing', async () => {
    serve(job(), [http.post(`${API}/api/delivery/rider/jobs/5/skip-stop/`, () => HttpResponse.json({ detail: 'Location is needed for this step. Allow location and try again.', code: 'location_needed' }, { status: 400 }))])
    wrap(<ActiveJobForTest id={5} />)
    await skipIt()
    expect(await screen.findByRole('alert')).toHaveTextContent('Location is needed for this step')
  })
  it('a shop that is running late says so', async () => {
    const late = [STOPS[0], { ...STOPS[1], status: 'pending', late: true }, STOPS[2]]
    serve(job({ status: 'accepted', pickups: late, current_stop: late[1], current_stop_id: 2, pickup: late[1] }))
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText('Running late for this shop')).toBeInTheDocument()
  })
})

describe('Double tap', () => {
  it('two rapid clicks on skip send one request', async () => {
    let posts = 0
    serve(job(), [http.post(`${API}/api/delivery/rider/jobs/5/skip-stop/`, async () => { posts += 1; await new Promise((r) => setTimeout(r, 100)); return HttpResponse.json(job({ status: 'accepted' })) })])
    wrap(<ActiveJobForTest id={5} />)
    fireEvent.click(await screen.findByRole('button', { name: "Can't hand over?" }))
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Closed' } })
    const confirm = screen.getByRole('button', { name: 'Confirm: skip this shop' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(posts).toBe(1))
    await new Promise((r) => setTimeout(r, 200))
    expect(posts).toBe(1)
  })
})

describe('A job from before multi-stop delivery', () => {
  it('shows no stop count, the one shop and the delivery address', async () => {
    const shop = { business_name: 'Kente House', lat: 6.7001, lng: -1.62, items: ['Kente × 1'], attempts_left: 5 }
    serve(job({ status: 'accepted', pickups: undefined, current_stop: undefined, current_stop_id: undefined, progress: undefined, multi_pickup: undefined, pickup: shop }))
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText('Order #18 · to pickup')).toBeInTheDocument()
    expect(screen.getByText('Kente House')).toBeInTheDocument()
    expect(screen.getByText('Ahodwo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "Can't hand over?" })).not.toBeInTheDocument()
  })
})

describe('JobMap with several shops', () => {
  it('draws the shop being worked in gold and later shops ringed, never a collected one', async () => {
    server.use(http.get(`${API}/api/orders/dispatch/5/map/`, () => HttpResponse.json({
      stage: 'at_pickup', pickup: { lat: 6.705, lng: -1.615, name: 'Adwoa Beads' },
      pickups: STOPS.map((s) => ({ id: s.id, sequence: s.sequence, name: s.business_name, lat: s.lat, lng: s.lng, status: s.status })),
      drop: { lat: 6.69, lng: -1.62 }, rider: { lat: 6.704, lng: -1.616, age_s: 10, stale: false }, leg: null, route: null,
    })))
    wrap(<JobMap jobId={5} />)
    await screen.findByTestId('track-map')
    const kinds = screen.getAllByRole('button').map((b) => b.getAttribute('data-kind')).filter(Boolean)
    expect(kinds).toEqual(['pickup', 'stop', 'drop', 'rider'])
    expect(screen.queryByText(/pin 1\. Kente House/)).not.toBeInTheDocument()
    expect(screen.getByText(/Ringed: later shops/)).toBeInTheDocument()
  })
})
