import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
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

const SHOP = { lat: 5.6037, lng: -0.187, name: 'Akosua Ntoma' }
const DROP = { lat: 5.6, lng: -0.17 }
const RIDER = { lat: 5.602, lng: -0.18, age_s: 20, stale: false, name: 'Kofi', vehicle_type: 'motorbike' }
const payload = (over = {}) => ({
  stage: 'assigned', pickup: SHOP, drop: DROP, rider: RIDER,
  leg: { to: 'pickup', distance_km: 1.1, duration_s: 240, basis: 'road route' }, route: [[5.602, -0.18], [5.6037, -0.187]], ...over,
})
const serve = (body, status = 200) => server.use(http.get(`${API}/api/orders/dispatch/:id/map/`, () => HttpResponse.json(body, { status })))
const kinds = () => screen.queryAllByRole('button').map((b) => b.getAttribute('data-kind')).filter(Boolean)

describe('JobMap', () => {
  it('before pickup: shop and rider pins, the route and the time to the shop', async () => {
    serve(payload())
    wrap(<JobMap jobId={5} />)
    const map = await screen.findByTestId('track-map')
    expect(map).toHaveAttribute('data-route-points', '2')
    expect(kinds()).toEqual(expect.arrayContaining(['pickup', 'rider', 'drop']))
    expect(screen.getByText(/To the shop: About 4 min/)).toBeInTheDocument()
    expect(screen.getByText(/Gold: shop/)).toBeInTheDocument()
  })

  it('after pickup: the time to the customer', async () => {
    serve(payload({ stage: 'picked_up', leg: { to: 'drop', distance_km: 1.4, duration_s: 300, basis: 'road route' }, route: [[5.602, -0.18], [5.6, -0.17]] }))
    wrap(<JobMap jobId={5} />)
    expect(await screen.findByText(/To the customer: About 5 min/)).toBeInTheDocument()
    expect(screen.getByText(/Green: customer/)).toBeInTheDocument()
  })

  it('a stale rider is drawn dashed and the time says the location is old', async () => {
    serve(payload({ rider: { ...RIDER, age_s: 600, stale: true } }))
    wrap(<JobMap jobId={5} />)
    expect(await screen.findByText(/Last location 10 min ago/)).toBeInTheDocument()
    expect(kinds()).toContain('stale')
    expect(kinds()).not.toContain('rider')
  })

  it('no rider fix: says so and draws no rider pin or line', async () => {
    serve(payload({ rider: null, leg: null, route: null }))
    wrap(<JobMap jobId={5} />)
    expect(await screen.findByText('Your location has not reached the server yet.')).toBeInTheDocument()
    expect(kinds()).not.toContain('rider')
    expect(kinds()).not.toContain('stale')
    expect(screen.getByTestId('track-map')).toHaveAttribute('data-route-points', '0')
  })

  it('a missing drop pin is named, not drawn and not in the legend', async () => {
    serve(payload({ drop: null, leg: null, route: null }))
    wrap(<JobMap jobId={5} />)
    expect(await screen.findByText(/No map pin for the customer's address, so the route and time cannot be shown/)).toBeInTheDocument()
    expect(kinds()).not.toContain('drop')
    expect(screen.queryByText(/Green: customer/)).not.toBeInTheDocument()
  })

  it('a failed fetch says the map could not be loaded', async () => {
    serve({ detail: 'nope' }, 500)
    wrap(<JobMap jobId={5} />)
    expect(await screen.findByText('The map could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('shows no phone number or code', async () => {
    serve(payload())
    wrap(<JobMap jobId={5} />)
    const group = await screen.findByRole('group', { name: 'Map of this job' })
    expect(within(group).queryByText(/\+233|\bcode\b|\d{4}\b/i)).not.toBeInTheDocument()
  })
})

const step = (done) => ['accepted', 'arrived_pickup', 'picked_up', 'arrived_drop', 'delivered'].map((s, i) => ({ step: s, label: s, done: i < done, event: i < done ? { at: '2026-10-13T11:00:00Z', flagged: false } : null }))
const job = (status) => ({
  id: 5, order_id: 18, status, status_label: status, accepted_at: '2026-10-13T11:00:00Z', arrived_pickup_at: '2026-10-13T11:05:00Z', picked_up_at: null, arrived_drop_at: null, delivered_at: null, deadline_at: null,
  customer_name: 'Yaw M.', delivery_address: 'Ahodwo', delivery_lat: 6.69, delivery_lng: -1.62, pickup: { business_name: 'Kente House', lat: 6.7001, lng: -1.62, items: [] },
  payment: { label: 'Paid online (simulated)', cash_due: null }, wait: null, steps: step(1), calls: 0, flagged: false, pickup_attempts_left: 5, drop_attempts_left: 5,
})

describe('On the job screen', () => {
  it.each(['accepted', 'picked_up'])('shows one map and keeps the Google Maps button when %s', async (status) => {
    server.use(
      http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json({ rider: { id: 1, manager: null }, shift: null })),
      http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(job(status))),
      http.post(`${API}/api/delivery/rider/ping/`, () => HttpResponse.json({ ok: true })),
    )
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findAllByTestId('track-map')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toBeInTheDocument()
  })
})
