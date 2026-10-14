import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import ActiveDeliveries from '../ActiveDeliveriesPanel.jsx'
import DisputesCases from '../DisputesCasesPanel.jsx'
import DispatchQueuePanel from '../DispatchQueuePanel.jsx'
import LiveOperationsPanel from '../LiveOperationsPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const auth = { user: { full_name: 'Adwoa Sarpong', role: 'delivery_manager' }, hasPermission: () => true }

const live = (over = {}) => ({
  now: '2026-10-13T11:46:00Z',
  kpis: { on_the_road: 3, waiting: 1, late_now: 0, delivered_today: 4, on_time_today: { on_time: 0, of: 0 }, riders: { on_shift: 2, free: 1, on_job: 1, break: 0, stale: 1 } },
  needs_you: [{ kind: 'unassigned', order_id: 7, text: 'Order #7 has waited 12 min for a rider', minutes: 12 }, { kind: 'flag', order_id: 8, text: 'Order #8: Tap 210 m away', assignment_id: 55 }],
  pins: [
    { rider_id: 1, full_name: 'Kofi Appiah', status: 'on_job', lat: 6.69, lng: -1.62, last_fix_at: '2026-10-13T11:45:50Z', age_seconds: 8, stale: false },
    { rider_id: 2, full_name: 'Esi Owusu', status: 'free', lat: null, lng: null, last_fix_at: null, age_seconds: null, stale: false },
  ],
  queue: [{ order_id: 7, waiting_minutes: 12, route: { from: 'Kente House', to: 'Ahodwo' }, zone: 'Adum', unzoned: false, returned: false }],
  disputes: [{ id: 31, order_id: 7, reason: 'delivery_issue', reason_label: 'Delivery problem', status: 'open' }],
  stale_after_seconds: 120, routing: { mode: 'straight_line_estimate', factor: 1.3, note: 'Straight-line estimate. The road route service is not answering, so distances and times are estimates.' },
  ...over,
})
const queueData = (over = {}) => ({ results: [], total: 0, auto_assign: { on: true, rules: {}, updated_at: null }, recent: [], deadlines: 'none', routing: { factor: 1.3 }, ...over })

describe('Live operations', () => {
  it('shows counted figures, the age of each pin, and says no time limits are set', async () => {
    server.use(http.get(`${API}/api/delivery/live/`, () => HttpResponse.json(live())), http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData())))
    wrap(<LiveOperationsPanel auth={auth} onNavigate={() => {}} />)
    expect(await screen.findByRole('group', { name: 'On the road' })).toHaveTextContent('3')
    expect(screen.getByRole('group', { name: 'Delivered today' })).toHaveTextContent('No delivery time limit set yet')
    expect(screen.getByRole('group', { name: 'Stale locations' })).toHaveTextContent('1')
    // The pin with a fix is drawn with its age; the rider with none is named, never put at 0,0.
    expect(screen.getByRole('button', { name: /pin Kofi Appiah · Location 8 s old/ })).toBeInTheDocument()
    expect(screen.getByText(/No location yet: Esi Owusu/)).toBeInTheDocument()
    expect(await screen.findByText(/No delivery time limits are in force/)).toBeInTheDocument()
    expect(screen.getByText('Auto-assign on')).toBeInTheDocument()
  })

  it('opens the delivery behind a flag and the queue behind an unassigned order', async () => {
    server.use(http.get(`${API}/api/delivery/live/`, () => HttpResponse.json(live())), http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData())))
    const onOpenDelivery = vi.fn()
    const onNavigate = vi.fn()
    wrap(<LiveOperationsPanel auth={auth} onNavigate={onNavigate} onOpenDelivery={onOpenDelivery} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open the delivery' }))
    expect(onOpenDelivery).toHaveBeenCalledWith(55)
    fireEvent.click(screen.getAllByRole('button', { name: 'Open dispatch queue' })[1])
    expect(onNavigate).toHaveBeenCalledWith('dm-queue')
  })

  it('switches auto-assign through the server and only for someone who may', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/live/`, () => HttpResponse.json(live())),
      http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData())),
      http.post(`${API}/api/delivery/auto-assign/switch/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ on: false }) }),
    )
    wrap(<LiveOperationsPanel auth={auth} onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to manual' }))
    await waitFor(() => expect(body).toEqual({ on: false }))
  })

  it('hides the switch from someone without delivery.rates', async () => {
    server.use(http.get(`${API}/api/delivery/live/`, () => HttpResponse.json(live())), http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData())))
    wrap(<LiveOperationsPanel auth={{ ...auth, hasPermission: (p) => p !== 'delivery.rates' }} onNavigate={() => {}} />)
    await screen.findByRole('group', { name: 'On the road' })
    expect(screen.queryByRole('button', { name: /Switch/ })).not.toBeInTheDocument()
  })
})

describe('Dispatch queue', () => {
  const row = { order_id: 7, waiting_minutes: 12, route: { from: 'Kente House', to: 'Ahodwo' }, zone: 'Adum', unzoned: false, returned: false, payment: { label: 'Paid online (simulated)' }, deadline_at: null, minutes_to_spare: 6, offer: null, held_until: null, refusals: 0, suggested: { rider_id: 1, full_name: 'Kofi Appiah', total: 71.5, km: 1.2 }, eligible: 2, pickup_located: true }
  const ranking = { pickup_located: true, eligible: [{ rider_id: 1, full_name: 'Kofi Appiah', km: 1.2, total: 71.5, vehicle_type: 'motorbike', active_jobs: 0, parts: [{ key: 'distance', weight: 50, label: '1.2 km away (estimate)', points: 90 }, { key: 'fairness', weight: 30, label: '0 jobs today', points: 100 }, { key: 'idle', weight: 20, label: 'Free for 30 min', points: 50 }] }, { rider_id: 2, full_name: 'Ama Kyei', km: 3, total: 40, vehicle_type: 'motorbike', active_jobs: 1, parts: [] }], left_out: [{ rider_id: 3, full_name: 'Fiifi Tetteh', reason: 'Location is stale' }] }

  it('lists the order, then offers to the best rider and names who was left out', async () => {
    let offer
    server.use(
      http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData({ results: [row], total: 1 }))),
      http.get(`${API}/api/delivery/queue/7/ranking/`, () => HttpResponse.json(ranking)),
      http.post(`${API}/api/delivery/queue/7/offer/`, async ({ request }) => { offer = await request.json(); return HttpResponse.json({ offer_id: 9 }, { status: 201 }) }),
    )
    wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
    expect(await screen.findByText('No delivery time limits are in force, so orders have no deliver-by time. They are listed by how long they have waited.')).toBeInTheDocument()
    expect(screen.getByText(/Under 10 minutes|6 min to spare/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose rider' }))
    const region = await screen.findByRole('region', { name: 'Order #7 detail' })
    expect(await within(region).findByText('Best')).toBeInTheDocument()
    expect(within(region).getByText(/Fiifi Tetteh: Location is stale/)).toBeInTheDocument()
    expect(within(region).getByText(/Time is short/)).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: 'Offer to Kofi Appiah' }))
    await waitFor(() => expect(offer).toEqual({ rider: 1 }))
  })

  it('force-assigns the rider chosen, not the best one, when the manager picks another', async () => {
    let forced
    server.use(
      http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData({ results: [row], total: 1 }))),
      http.get(`${API}/api/delivery/queue/7/ranking/`, () => HttpResponse.json(ranking)),
      http.post(`${API}/api/delivery/queue/7/force-assign/`, async ({ request }) => { forced = await request.json(); return HttpResponse.json({ assignment_id: 3, mode: 'forced' }, { status: 201 }) }),
    )
    wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose rider' }))
    const region = await screen.findByRole('region', { name: 'Order #7 detail' })
    fireEvent.change(await within(region).findByLabelText('Rider'), { target: { value: '2' } })
    fireEvent.click(within(region).getByRole('button', { name: 'Force-assign now' }))
    await waitFor(() => expect(forced).toEqual({ rider: 2 }))
  })

  it('says so when nothing is waiting', async () => {
    server.use(http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData({ deadlines: 'set' }))))
    wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
    expect(await screen.findByText('No order is waiting for a rider.')).toBeInTheDocument()
  })

  const EST = 'straight-line estimate x 1.3'
  const roadStatus = { mode: 'road', factor: 1.3, healthy: true, configured: true }
  const queueNote = 'Rider distances here are straight-line estimates (x 1.3), not road routes. Road routes are not used to rank riders yet.'
  const openRanking = async (routing, distance_basis) => {
    server.use(
      http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json(queueData({ results: [row], total: 1, routing }))),
      http.get(`${API}/api/delivery/queue/7/ranking/`, () => HttpResponse.json({ ...ranking, distance_basis })),
    )
    wrap(<DispatchQueuePanel auth={auth} onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose rider' }))
    return screen.findByRole('region', { name: 'Order #7 detail' })
  }

  it('prints the ranking\'s own basis and never says road routes, even when the road service is up', async () => {
    const region = await openRanking({ ...roadStatus, distance_basis: EST, note: queueNote }, EST)
    expect(await within(region).findByText(/Rider distances are a straight-line estimate x 1\.3\./)).toBeInTheDocument()
    expect(screen.getByText(queueNote)).toBeInTheDocument()
    expect(screen.queryByText(/are road routes/i)).toBeNull()
    expect(screen.queryByText(/not connected/i)).toBeNull()
  })

  it('says nothing about how distances were measured when the ranking does not say', async () => {
    const region = await openRanking({ ...roadStatus, note: queueNote }, undefined)
    await within(region).findByText(/Score is the sum of each part/)
    expect(within(region).queryByText(/Rider distances are/)).toBeNull()
  })
})

describe('Active deliveries and the delivery record', () => {
  const active = (results) => ({ pipeline: { assigned: 0, accepted: 0, at_pickup: 0, picked_up: 1, at_customer: 0, delivered_today: 2, delivered_today_on_time: 0, delivered_today_with_deadline: 0, could_not_deliver_today: 0 }, counts: { all: 1, at_customer: 0, flagged: 1, stale: 0, cash: 0 }, filter: 'all', results, cash_on_delivery: 'not_offered' })
  const job = { id: 55, order_id: 8, route: { from: 'Kente House', to: 'Ahodwo' }, rider: { id: 1, staff_id: 4, full_name: 'Kofi Appiah' }, vehicle: 'Motorbike', status: 'picked_up', status_label: 'Picked up', step_note: '', last_stamp: { at: '2026-10-13T11:31:00Z', label: 'Picked up', distance_m: 25, flagged: false }, location_age_seconds: 9, stale: false, deadline_at: null, minutes_to_spare: null, payment: { label: 'Paid online (simulated)' }, flag: { kind: 'location', label: 'Tap 210 m away', decision: '' } }

  it('lists jobs, filters by what the server counts and opens one', async () => {
    const seen = []
    server.use(http.get(`${API}/api/delivery/active/`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('filter')); return HttpResponse.json(active([job])) }))
    const onOpenDetail = vi.fn()
    wrap(<ActiveDeliveries detailId={null} onOpenDetail={onOpenDetail} />)
    expect(await screen.findByText('Tap 210 m away')).toBeInTheDocument()
    expect(screen.getByText('None set')).toBeInTheDocument()
    expect(screen.getByText('No delivery time limit set yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Flagged · 1' }))
    await waitFor(() => expect(seen).toContain('flagged'))
    fireEvent.click(screen.getByRole('button', { name: '#8' }))
    expect(onOpenDetail).toHaveBeenCalledWith(55)
  })

  const detail = (over = {}) => ({
    id: 55, order_id: 8, status: 'delivered', status_label: 'Delivered', rider: { id: 1, full_name: 'Kofi Appiah', vehicle: 'Motorbike', plate: 'AS 4471-22' }, customer: { name: 'Akua B', phone_masked: '•••• 0381' },
    payment: { label: 'Paid online (simulated)' }, total_amount: '120.00', deadline_at: null, delivered_at: '2026-10-13T10:44:00Z',
    timeline: [{ id: 1, step: 'arrived_drop', label: 'Arrived at customer', at: '2026-10-13T10:31:00Z', distance_m: 210, accuracy_m: 12, flagged: true, note: '' }],
    codes: { pickup: { matched: true, wrong_tries: 0 }, drop: { matched: true, wrong_tries: 1 } }, wait: null, failed: null, rider_note: '',
    photos: [], calls: [], flag: { decision: '', flagged_steps: ['arrived_drop'], wait_pay_held: false }, cases: [], ...over,
  })

  it('shows what was stamped, never invents a fee, and records a flag decision', async () => {
    let decision
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail())),
      http.post(`${API}/api/delivery/jobs/55/flag-decision/`, async ({ request }) => { decision = await request.json(); return HttpResponse.json({ decision: 'upheld', wait_pay_held: true }) }),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    expect(await screen.findByText('210 m from the stop · accuracy 12 m')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Delivery fee' })).toHaveTextContent('Not recorded')
    expect(screen.getByText(/1 wrong try/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Uphold the flag/))
    fireEvent.click(screen.getByLabelText(/Hold the waiting pay/))
    expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled() // an upheld flag needs a reason
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Stood at the junction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save decision' }))
    await waitFor(() => expect(decision).toEqual({ decision: 'upheld', note: 'Stood at the junction', hold_wait_pay: true }))
  })

  it('logs a call to the rider and offers the number as a tel link', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ flag: { decision: 'cleared', decided_by: { full_name: 'Adwoa' }, decided_at: '2026-10-13T11:00:00Z', note: 'ok', flagged_steps: ['arrived_drop'] } }))), http.post(`${API}/api/delivery/jobs/55/call-rider/`, () => HttpResponse.json({ call_id: 1, phone: '+233240000001' }, { status: 201 })))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Call Kofi (logged)' }))
    expect(await screen.findByRole('link', { name: '+233240000001' })).toHaveAttribute('href', 'tel:+233240000001')
    expect(screen.getByText(/Flag cleared/)).toBeInTheDocument()
  })

  it('shows a locked code and unlocks it only with a note, then refetches the job', async () => {
    let body
    let reads = 0
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => { reads += 1; return HttpResponse.json(detail({ status: 'at_pickup', codes: { pickup: { matched: false, wrong_tries: reads > 1 ? 0 : 5 }, drop: { matched: false, wrong_tries: 2 } } })) }),
      http.post(`${API}/api/delivery/jobs/55/unlock-code/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ which: 'pickup', attempts: 0 }) }),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    expect(await screen.findByText('Code locked')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Unlock code' })).toHaveLength(1) // the drop step has 2 wrong tries: not locked
    fireEvent.click(screen.getByRole('button', { name: 'Unlock code' }))
    const confirm = screen.getByRole('button', { name: 'Confirm unlock' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Why are you unlocking/), { target: { value: 'Shop confirmed the rider' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(body).toEqual({ which: 'pickup', note: 'Shop confirmed the rider' }))
    await waitFor(() => expect(screen.queryByText('Code locked')).not.toBeInTheDocument())
    expect(reads).toBeGreaterThan(1)
  })

  it('offers no unlock control when no code is locked', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail())))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    await screen.findByText(/1 wrong try/)
    expect(screen.queryByText('Code locked')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock code' })).not.toBeInTheDocument()
  })

  it('shows the server message when the unlock is refused, and reloads the job', async () => {
    let reads = 0
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => { reads += 1; return HttpResponse.json(detail({ status: 'at_pickup', codes: { pickup: { matched: false, wrong_tries: 5 }, drop: { matched: false, wrong_tries: 0 } } })) }),
      http.post(`${API}/api/delivery/jobs/55/unlock-code/`, () => HttpResponse.json({ detail: 'This code is not locked.', code: 'not_locked' }, { status: 409 })),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock code' }))
    fireEvent.change(screen.getByLabelText(/Why are you unlocking/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unlock' }))
    expect(await screen.findByText('This code is not locked.')).toBeInTheDocument()
    await waitFor(() => expect(reads).toBeGreaterThan(1))
  })
  
})

describe('Disputes and returns', () => {
  const list = { results: [{ id: 31, order_id: 7, case_type: 'not_received', case_type_label: 'Not received', status: 'open', status_label: 'Open', customer: 'Akua B', rider: 'Fiifi Tetteh', created_at: '2026-10-13T09:00:00Z', answer_due_at: null, minutes_left: null, overdue: false }], counts: { not_received: 1, damaged: 0, wrong_item: 0, unreachable: 0, return: 0 }, open: 1, overdue: null, closed_7d: 0, answer_limit: 'none', patterns: [{ kind: 'rider', text: 'Fiifi Tetteh is on 2 delivery cases in 30 days' }] }
  it('lists open cases, says no answer time is set, and counts patterns from the cases', async () => {
    const seen = []
    server.use(http.get(`${API}/api/delivery/cases/`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('type')); return HttpResponse.json(list) }))
    const onOpenDetail = vi.fn()
    wrap(<DisputesCases detailId={null} onOpenDetail={onOpenDetail} />)
    expect(await screen.findByText('No answer time set')).toBeInTheDocument()
    expect(screen.getByText('No answer time is set')).toBeInTheDocument()
    expect(screen.getByText(/Fiifi Tetteh is on 2 delivery cases/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not received · 1' }))
    await waitFor(() => expect(seen).toContain('not_received'))
    fireEvent.click(screen.getByRole('button', { name: 'Case #31' }))
    expect(onOpenDetail).toHaveBeenCalledWith(31)
  })

  const caseData = () => ({
    case: { id: 31, order_id: 7, case_type: 'not_received', case_type_label: 'Not received', status: 'open', status_label: 'Open', created_at: '2026-10-13T09:00:00Z', answer_due_at: '2026-10-13T13:00:00Z', minutes_left: 40, overdue: false },
    description: 'Customer says nothing arrived', reason: 'delivery_issue', order: { id: 7, total: '120.00', address: 'Ahodwo' },
    evidence: { assignment_id: 55, status: 'delivered', timeline: [{ id: 1, label: 'Delivered', at: '2026-10-13T08:00:00Z', distance_m: 180, accuracy_m: 9, flagged: true }], speeds: [], flagged: ['delivered'], photos: [], calls: [], code_tries: { pickup: 0, drop: 0 }, failed: null, rider_note: '' },
    rider: { id: 1, staff_id: 4, full_name: 'Fiifi Tetteh', other_cases: 1 }, decision: null, refund: null,
    outcomes: { refund: 'Refund the customer', no_refund: 'No refund', redeliver: 'Deliver again', return_to_shop: 'Return to the business' }, faults: { rider: 'Rider', business: 'Business', customer: 'Customer', none: 'No one' },
    payments: 'Payments are simulated until a payment provider is connected: a refund is recorded and approved, no money moves.',
  })
  it('shows the evidence and records a refund decision with the amount, fault and note', async () => {
    let body
    server.use(http.get(`${API}/api/delivery/cases/31/`, () => HttpResponse.json(caseData())), http.post(`${API}/api/delivery/cases/31/decide/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 31, status: 'resolved', refund_approval_id: 5 }) }))
    wrap(<DisputesCases detailId="31" onOpenDetail={() => {}} />)
    expect(await screen.findByText('180 m')).toBeInTheDocument()
    expect(screen.getByText(/No photo was taken|No photo/)).toBeInTheDocument()
    const record = screen.getByRole('button', { name: 'Record decision' })
    expect(record).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Refund the customer'))
    fireEvent.change(screen.getByLabelText(/Refund amount/), { target: { value: '120.00' } })
    fireEvent.click(screen.getByLabelText('Rider'))
    fireEvent.click(screen.getByLabelText(/Send to Operations as possible fraud/))
    fireEvent.change(screen.getByLabelText(/Note \(required/), { target: { value: 'Code entered away from the door' } })
    fireEvent.click(record)
    await waitFor(() => expect(body).toEqual({ outcome: 'refund', fault: 'rider', note: 'Code entered away from the door', refund_amount: '120.00', stop_rider_jobs: false, send_to_operations: true }))
  })

  it('shows a recorded decision instead of the form', async () => {
    const c = caseData()
    c.decision = { outcome: 'no_refund', outcome_label: 'No refund', fault: 'none', note: 'Customer found it', decided_at: '2026-10-13T10:00:00Z', decided_by: { full_name: 'Adwoa Sarpong' }, refund_amount: null }
    server.use(http.get(`${API}/api/delivery/cases/31/`, () => HttpResponse.json(c)))
    wrap(<DisputesCases detailId="31" onOpenDetail={() => {}} />)
    expect(await screen.findByText('Decision recorded')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument()
  })

})
