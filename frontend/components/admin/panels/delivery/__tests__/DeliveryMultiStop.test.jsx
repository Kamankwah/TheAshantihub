import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import ActiveDeliveries from '../ActiveDeliveriesPanel.jsx'
import DispatchQueuePanel from '../DispatchQueuePanel.jsx'
import { QueueMap, JobMap } from '../deliveryMaps.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const auth = { user: { full_name: 'Adwoa Sarpong', role: 'delivery_manager' }, hasPermission: () => true }
const stop = (sequence, name, status, over = {}) => ({ id: 70 + sequence, sequence, business_name: name, status, wrong_tries: 0, planned_arrival: null, collected_at: null, skip_note: '', items: [], ...over })
const detail = (over = {}) => ({
  id: 55, order_id: 8, status: 'accepted', status_label: 'Accepted', rider: { id: 1, full_name: 'Kofi Appiah', vehicle: 'Motorbike', plate: 'AS 4471-22' },
  customer: { name: 'Akua B', phone_masked: '•••• 0381' }, payment: { label: 'Paid online (simulated)' }, total_amount: '120.00', deadline_at: null, delivered_at: null,
  timeline: [], codes: { pickup: { matched: false, wrong_tries: 0 }, drop: { matched: false, wrong_tries: 0 } }, wait: null, failed: null, rider_note: '',
  photos: [], calls: [], flag: { decision: '', flagged_steps: [], wait_pay_held: false }, cases: [],
  stops: [stop(1, 'Kente House', 'collected', { collected_at: '2026-10-14T10:02:00Z' }), stop(2, 'Adwoa Beads', 'pending', { wrong_tries: 5 }), stop(3, 'Chop Corner', 'pending')],
  progress: { total: 3, done: 1, skipped: 0, current: 2 },
  route_plan: { planned: true, total_km: 7.2, direct_km: 5, detour_pct: 44, limit_pct: 40, over_limit: true, basis: 'road route' }, ...over,
})

describe('A delivery from several shops (manager)', () => {
  it('lists each shop with its state and warns about the detour', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail())))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const shops = await screen.findByRole('region', { name: 'Shops on this delivery' })
    expect(within(shops).getByRole('group', { name: 'Stop 1: Kente House' })).toHaveTextContent('Collected')
    expect(within(shops).getByText('Planned route 7.2 km through 3 shops (road route).')).toBeInTheDocument()
    expect(within(shops).getByText('Detour 44% (allowance 40%)')).toBeInTheDocument()
    expect(screen.getByText('Customer code: not entered yet')).toBeInTheDocument()
  })

  it('warns about the detour even when the percentage is unknown', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ route_plan: { planned: true, total_km: 7.2, detour_pct: null, limit_pct: 40, over_limit: true, basis: 'road route' } }))))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    expect(await screen.findByText('Longer than going direct (allowance 40%)')).toBeInTheDocument()
  })

  it('says plainly when no route was planned, and names a missing pin only when one is missing', async () => {
    const plan = { planned: false, total_km: null, limit_pct: 40, over_limit: false }
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ route_plan: plan }))))
    const { unmount } = wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    expect(await screen.findByText('No planned route for this order.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('cart order')
    unmount()
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ route_plan: plan, stops: [stop(1, 'Kente House', 'pending', { lat: null, lng: null }), stop(2, 'Adwoa Beads', 'pending')] }))))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    expect(await screen.findByText('No planned route for this order. A shop has no map pin.')).toBeInTheDocument()
  })

  it('says when the detour allowance is the built-in default', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ route_plan: { planned: true, total_km: 7.2, detour_pct: 44, limit_pct: 40, limit_source: 'defaults', over_limit: true, basis: 'road route' } }))))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    expect(await screen.findByText('Detour 44% (allowance 40%, built-in default)')).toBeInTheDocument()
  })

  it('unlocks the code of the shop named, sending its stop', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail())),
      http.post(`${API}/api/delivery/jobs/55/unlock-code/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ which: 'pickup', attempts: 0 }) }),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const beads = await screen.findByRole('group', { name: 'Stop 2: Adwoa Beads' })
    fireEvent.click(within(beads).getByRole('button', { name: 'Unlock code' }))
    fireEvent.change(within(beads).getByLabelText(/Why are you unlocking/), { target: { value: 'Shop confirmed by phone' } })
    fireEvent.click(within(beads).getByRole('button', { name: 'Confirm unlock' }))
    await waitFor(() => expect(body).toEqual({ which: 'pickup', note: 'Shop confirmed by phone', stop: 72 }))
  })

  it('skips a shop that closed only with a reason', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail())),
      http.post(`${API}/api/delivery/jobs/55/stops/73/skip/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ stop: 73, status: 'skipped', assignment_status: 'accepted' }) }),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const chop = await screen.findByRole('group', { name: 'Stop 3: Chop Corner' })
    fireEvent.click(within(chop).getByRole('button', { name: 'Skip this shop' }))
    const confirm = within(chop).getByRole('button', { name: 'Confirm skip' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(chop).getByLabelText(/Why is this shop skipped/), { target: { value: 'Closed for the day' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(body).toEqual({ note: 'Closed for the day' }))
    expect(within(screen.getByRole('group', { name: 'Stop 1: Kente House' })).queryByRole('button', { name: 'Skip this shop' })).not.toBeInTheDocument()
  })

  it('sends the unsaved legacy stop id 0 back as it came', async () => {
    let hit = false
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ stops: [stop(1, 'Kente House', 'pending', { id: 0 }), stop(2, 'Chop Corner', 'pending')] }))),
      http.post(`${API}/api/delivery/jobs/55/stops/0/skip/`, () => { hit = true; return HttpResponse.json({ stop: 71, status: 'skipped', assignment_status: 'accepted' }) }),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const first = await screen.findByRole('group', { name: 'Stop 1: Kente House' })
    fireEvent.click(within(first).getByRole('button', { name: 'Skip this shop' }))
    fireEvent.change(within(first).getByLabelText(/Why is this shop skipped/), { target: { value: 'Closed' } })
    fireEvent.click(within(first).getByRole('button', { name: 'Confirm skip' }))
    await waitFor(() => expect(hit).toBe(true))
  })

  it('never says far from the shop when the distance was not measured, and flags a late shop', async () => {
    const skips = [
      { stop_id: 72, sequence: 2, business_name: 'Adwoa Beads', at: '2026-10-14T10:05:00Z', note: 'Shut', by: 'rider', pinned: true, lat: 6.7, lng: -1.62, accuracy_m: 9, distance_m: null, distance_measured: false, at_shop: false },
      { stop_id: 72, sequence: 2, business_name: 'Adwoa Beads', at: '2026-10-14T10:06:00Z', note: 'Shut again', by: 'rider', pinned: true, lat: 6.7, lng: -1.62, accuracy_m: 9, distance_m: 480, distance_measured: true, at_shop: false },
    ]
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ stops: [stop(1, 'Kente House', 'collected'), stop(2, 'Adwoa Beads', 'pending', { skips, late: true, planned_arrival: '2026-10-14T10:00:00Z' }), stop(3, 'Chop Corner', 'pending')] }))))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const beads = await screen.findByRole('group', { name: 'Stop 2: Adwoa Beads' })
    expect(beads).toHaveTextContent('distance not measured')
    expect(beads).toHaveTextContent('480 m from the shop')
    expect(beads).not.toHaveTextContent('far from the shop')
    expect(beads).toHaveTextContent('running late')
  })

  it('offers no unlock on a skipped shop, no undefined basis, and no stray full stop after a manager note', async () => {
    const skips = [{ stop_id: 72, sequence: 2, business_name: 'Adwoa Beads', at: '2026-10-14T10:05:00Z', note: 'Closed down', by: 'manager', pinned: false, lat: null, lng: null, accuracy_m: null, distance_m: null, distance_measured: false, at_shop: false }]
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({
      stops: [stop(1, 'Kente House', 'collected'), stop(2, 'Adwoa Beads', 'skipped', { wrong_tries: 5, skips }), stop(3, 'Chop Corner', 'pending')],
      route_plan: { planned: true, total_km: 7.2, detour_pct: 10, limit_pct: 40, over_limit: false },
    }))))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const beads = await screen.findByRole('group', { name: 'Stop 2: Adwoa Beads' })
    expect(within(beads).queryByRole('button', { name: 'Unlock code' })).not.toBeInTheDocument()
    expect(within(beads).queryByText('Code locked')).not.toBeInTheDocument()
    expect(beads).toHaveTextContent(/Closed down\.Pickup code/)
    expect(beads).not.toHaveTextContent('Closed down. .')
    expect(screen.getByText('Planned route 7.2 km through 3 shops.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('undefined')
  })

  it('keeps the one-shop layout when there is a single stop', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ stops: [stop(1, 'Kente House', 'pending')], route_plan: null }))))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    await screen.findByText('Customer code: not entered yet')
    expect(screen.queryByRole('region', { name: 'Shops on this delivery' })).not.toBeInTheDocument()
  })
})

describe('Dispatch queue', () => {
  const queue = (row) => server.use(http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json({ results: [row], total: 1, auto_assign: { on: true, rules: {}, updated_at: null }, recent: [], deadlines: 'none', routing: { factor: 1.3 } })))
  const base = { order_id: 7, waiting_minutes: 12, route: { from: 'Kente House', to: 'Ahodwo' }, zone: 'Adum', unzoned: false, returned: false, payment: { label: 'Paid online (simulated)' }, deadline_at: null, minutes_to_spare: 30, offer: null, held_until: null, refusals: 0, suggested: null, eligible: 2, pickup_located: true }

  it('shows how many shops an order has and the detour warning', async () => {
    queue({ ...base, stops: 3, detour_warning: 'Planned route is 52% longer than going direct from the first shop (allowance 40%).' })
    wrap(<DispatchQueuePanel auth={auth} />)
    expect(await screen.findByText('3 shops')).toBeInTheDocument()
    expect(screen.getByText(/52% longer than going direct/)).toBeInTheDocument()
  })

  it('shows an order sent back because every shop was skipped, with each rider report and pin', async () => {
    queue({ ...base, order_id: 9, returned: true, returned_reason: 'all_stops_skipped', stops: 2, detour_warning: null,
      skips: [
        { stop_id: 71, sequence: 1, business_name: 'Kente House', at: '2026-10-14T10:02:00Z', note: 'Door locked', by: 'rider', pinned: true, lat: 6.7001, lng: -1.62, accuracy_m: 9, distance_m: 12, distance_measured: true, at_shop: true },
        { stop_id: 72, sequence: 2, business_name: 'Adwoa Beads', at: '2026-10-14T10:04:00Z', note: 'Shut', by: 'rider', pinned: true, lat: 6.71, lng: -1.63, accuracy_m: 30, distance_m: null, distance_measured: false, at_shop: false },
        { stop_id: 73, sequence: 3, business_name: 'Chop Corner', at: '2026-10-14T10:05:00Z', note: 'Closed down', by: 'manager', pinned: false, lat: null, lng: null, accuracy_m: null, distance_m: null, distance_measured: false, at_shop: false },
      ] })
    wrap(<DispatchQueuePanel auth={auth} />)
    expect(await screen.findByText(/Every shop skipped, sent back to you/)).toBeInTheDocument()
    expect(screen.getByText(/Kente House: Door locked/)).toBeInTheDocument()
    expect(screen.getByText(/Pin 6.70010, -1.62000/)).toBeInTheDocument()
    expect(screen.getByText(/Adwoa Beads: Shut.*distance not measured/)).toBeInTheDocument()
    expect(screen.queryByText(/far from the shop/)).not.toBeInTheDocument()
    expect(screen.getByText(/Chop Corner: Closed down.*skipped by a manager/)).toBeInTheDocument()
  })

  it('still renders a legacy row with no multi-stop fields', async () => {
    queue(base)
    wrap(<DispatchQueuePanel auth={auth} />)
    expect(await screen.findByText('#7')).toBeInTheDocument()
    expect(screen.queryByText(/shops$/)).not.toBeInTheDocument()
  })
})

describe('Delivery maps with several shops', () => {
  it('names the shops that have no map pin on the job map', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/map/`, () => HttpResponse.json({
      pickup: { lat: 6.7, lng: -1.6, name: 'Kente House' }, drop: { lat: 6.71, lng: -1.61 }, rider: null, route: null, leg: null,
      pickups: [{ sequence: 1, name: 'Kente House', lat: 6.7, lng: -1.6, status: 'pending' }, { sequence: 2, name: 'Adwoa Beads', lat: null, lng: null, status: 'pending' }],
    })))
    wrap(<JobMap jobId="55" riderName="Kofi" />)
    expect(await screen.findByText(/No map pin for: Adwoa Beads/)).toBeInTheDocument()
  })
})
