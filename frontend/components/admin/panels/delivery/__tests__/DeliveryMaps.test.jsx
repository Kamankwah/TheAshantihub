import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import ActiveDeliveries from '../ActiveDeliveriesPanel.jsx'
import DispatchQueuePanel from '../DispatchQueuePanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const auth = { user: { full_name: 'Adwoa Sarpong', role: 'delivery_manager' }, hasPermission: () => true }

const row = { order_id: 7, waiting_minutes: 12, route: { from: 'Kente House', to: 'Ahodwo' }, zone: 'Adum', unzoned: false, returned: false, payment: { label: 'Paid online (simulated)' }, deadline_at: null, minutes_to_spare: 30, offer: null, held_until: null, refusals: 0, suggested: null, eligible: 2, pickup_located: true }
const queue = { results: [row], total: 1, auto_assign: { on: true, rules: {}, updated_at: null }, recent: [], deadlines: 'none', routing: { factor: 1.3 } }
const part = (key) => ({ key, weight: 10, label: key, points: 50 })
const ranking = {
  pickup_located: true,
  eligible: [
    { rider_id: 1, full_name: 'Kojo Mensah', total: 71, vehicle_type: 'motorbike', active_jobs: 0, parts: [part('distance'), part('fairness'), part('idle')] },
    { rider_id: 4, full_name: 'Esi Owusu', total: 60, vehicle_type: 'motorbike', active_jobs: 0, parts: [part('distance'), part('fairness'), part('idle')] },
  ],
  left_out: [{ rider_id: 2, full_name: 'Yaw Boadu', reason: 'Too far' }],
}
const queueMap = (over = {}) => ({
  pickup: { lat: 5.6037, lng: -0.187, name: 'Akosua Ntoma' }, drop: { lat: 5.6, lng: -0.17 },
  trip: { distance_km: 3.2, duration_s: 420, basis: 'road route' }, route: [[5.6037, -0.187], [5.6, -0.17]],
  riders: [
    { rider_id: 1, name: 'Kojo Mensah', lat: 5.605, lng: -0.19, age_s: 30, stale: false, eligible: true, reason: null },
    { rider_id: 4, name: 'Esi Owusu', lat: 5.61, lng: -0.19, age_s: 600, stale: true, eligible: true, reason: null },
    { rider_id: 2, name: 'Yaw Boadu', lat: 5.62, lng: -0.2, age_s: 40, stale: false, eligible: false, reason: 'Too far' },
  ],
  ...over,
})

const openQueue = async (map) => {
  server.use(
    http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queue)),
    http.get(`${API}/api/delivery/queue/7/ranking/`, () => HttpResponse.json(ranking)),
    http.get(`${API}/api/delivery/queue/7/map/`, () => HttpResponse.json(map)),
  )
  wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Choose rider' }))
  return screen.findByRole('region', { name: 'Order #7 detail' })
}

describe('Dispatch queue map', () => {
  it('draws the pickup, drop, route and one button per rider, and highlights the clicked rider row', async () => {
    const region = await openQueue(queueMap())
    expect(await within(region).findByTestId('track-map')).toHaveAttribute('data-route-points', '2')
    expect(within(region).getByRole('button', { name: /pin Akosua Ntoma/ })).toHaveAttribute('data-kind', 'pickup')
    expect(within(region).getAllByRole('button').filter((b) => b.dataset.kind === 'drop')).toHaveLength(1)
    expect(within(region).getByRole('button', { name: 'pin Kojo Mensah' })).toHaveAttribute('data-kind', 'rider')
    expect(within(region).getByRole('button', { name: 'pin Esi Owusu' })).toHaveAttribute('data-kind', 'stale')
    expect(within(region).getByRole('button', { name: /pin Yaw Boadu/ })).toHaveAttribute('data-kind', 'candidate')
    expect(within(region).getByText(/About 7 min · 3\.2 km · road route/)).toBeInTheDocument()
    expect(within(region).getByText(/Dashed: location out of date/)).toBeInTheDocument()
    const rowOf = (name) => within(region).getByText(name, { selector: 'td' }).closest('tr')
    expect(rowOf('Kojo Mensah')).not.toHaveAttribute('aria-current')
    fireEvent.click(within(region).getByRole('button', { name: 'pin Kojo Mensah' }))
    expect(rowOf('Kojo Mensah')).toHaveAttribute('aria-current', 'true')
    expect(rowOf('Esi Owusu')).not.toHaveAttribute('aria-current')
  })

  it('puts the reason for a left-out rider in the marker label', async () => {
    const region = await openQueue(queueMap())
    expect(await within(region).findByRole('button', { name: 'pin Yaw Boadu: Too far' })).toBeInTheDocument()
  })

  it('says the route is a straight-line estimate when there is no road route, and draws no line', async () => {
    const region = await openQueue(queueMap({ route: null, trip: { distance_km: 2.5, duration_s: 600, basis: 'straight-line estimate x 1.3' } }))
    expect(await within(region).findByTestId('track-map')).toHaveAttribute('data-route-points', '0')
    expect(within(region).getByText(/straight-line estimate/)).toBeInTheDocument()
  })

  it('shows the empty state and no map when the business has no pin, and says when no rider has a location', async () => {
    const region = await openQueue(queueMap({ pickup: null, drop: null, route: null, trip: null, riders: [] }))
    expect(await within(region).findByText(/No map pin for this pickup/)).toBeInTheDocument()
    expect(within(region).queryByTestId('track-map')).toBeNull()
    expect(within(region).getByText('No rider has shared a location recently.')).toBeInTheDocument()
  })
})

describe('Active job map', () => {
  const detail = {
    id: 55, order_id: 8, status: 'picked_up', status_label: 'Picked up', rider: { id: 1, full_name: 'Kofi Appiah', vehicle: 'Motorbike', plate: 'AS 4471-22' }, customer: { name: 'Akua B', phone_masked: '•••• 0381' },
    payment: { label: 'Paid online (simulated)' }, total_amount: '120.00', deadline_at: null, delivered_at: null, timeline: [],
    codes: { pickup: { matched: true, wrong_tries: 0 }, drop: { matched: false, wrong_tries: 0 } }, wait: null, failed: null, rider_note: '',
    photos: [], calls: [], flag: { decision: '', flagged_steps: [], wait_pay_held: false }, cases: [],
  }

  it('draws the stops, the rider and the leg with its own basis', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail)))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    expect(await screen.findByTestId('track-map')).toHaveAttribute('data-route-points', '2')
    expect(screen.getByRole('button', { name: /pin Akosua Ntoma/ })).toHaveAttribute('data-kind', 'pickup')
    expect(screen.getByRole('button', { name: /pin Kofi Appiah/ })).toHaveAttribute('data-kind', 'rider')
    expect(screen.getByText(/About 5 min · 1\.4 km · road route/)).toBeInTheDocument()
  })

  it('marks a stale rider and says so', async () => {
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail)),
      http.get(`${API}/api/delivery/jobs/55/map/`, () => HttpResponse.json({
        stage: 'picked_up', pickup: null, drop: { lat: 5.6, lng: -0.17 }, rider: { lat: 5.602, lng: -0.18, age_s: 600, stale: true, name: 'Kofi Appiah' },
        leg: { to: 'drop', distance_km: 1.4, duration_s: 300, basis: 'straight-line estimate x 1.3' }, route: null,
      })),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    expect(await screen.findByRole('button', { name: /pin Kofi Appiah/ })).toHaveAttribute('data-kind', 'stale')
    expect(screen.getByText(/Last location 10 min ago/)).toBeInTheDocument()
    expect(screen.getByText(/straight-line estimate/)).toBeInTheDocument()
  })
})
